import re
import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from app.schemas import MediaResponse, MediaListItem
from app.auth import get_current_user, require_admin, get_optional_user
from app.config import settings
from app.database import get_db
from app.services.acl import can_read_media, list_readable_page_ids

router = APIRouter(prefix="/api/media", tags=["media"])

ALLOWED_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf", "text/plain", "text/markdown",
}

MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB

# SVG can carry embedded scripts. We keep SVG uploads in the allow-list for
# diagrams/icons but refuse anything that contains executable markup — and we
# still force `Content-Disposition: attachment` + `X-Content-Type-Options:
# nosniff` when serving SVG, so a crafted file can never run as HTML in the
# app's origin even if it slips through this filter.
#   - <script>, <foreignObject>, <iframe>: direct script injection
#   - <use>: can pull external SVG via xlink:href / href
#   - <animate>, <set>: can mutate href to javascript: at runtime
#   - on*= attributes: inline event handlers
#   - javascript: URI in any attribute (covers <a href="javascript:...">)
_SVG_SCRIPT_RE = re.compile(
    rb"<\s*(?:script|use|animate|set|foreignObject|iframe)[\s>/]"
    rb"|on[a-z]+\s*=|javascript:",
    re.IGNORECASE,
)


def _sniff_mime(content: bytes) -> str | None:
    """Return a best-effort MIME type inferred from the first bytes.

    We don't pull in `python-magic` (libmagic C dep) — a short header table
    covers the types in ALLOWED_TYPES. Returns None when we can't tell, in
    which case the caller falls back to trust the client header only for
    plain-text formats. The goal is to catch obvious content-type lies
    (PNG header declared as `image/jpeg`; shell script declared as
    `image/png`), not to be exhaustive.
    """
    if not content:
        return None
    head = content[:32]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    # SVG: skip a BOM/whitespace and check for '<svg' or an XML prolog that
    # contains '<svg'.
    lead = content[:512].lstrip().lower()
    if lead.startswith(b"<?xml"):
        lead = lead.split(b"?>", 1)[-1].lstrip()
    if lead.startswith(b"<svg"):
        return "image/svg+xml"
    # text/plain and text/markdown have no reliable magic; leave as None.
    return None


@router.post("/upload", response_model=MediaResponse, status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot upload media")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    content = await file.read()
    size = len(content)
    if size > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024*1024)} MB")

    # Client-declared Content-Type is untrusted — verify against magic bytes
    # for formats we can recognise. Mismatches almost always indicate a
    # polyglot / mislabelled upload trying to dodge the allow-list.
    sniffed = _sniff_mime(content)
    if sniffed is not None and sniffed != file.content_type:
        raise HTTPException(
            status_code=400,
            detail=f"File contents do not match declared type {file.content_type}",
        )

    # SVG is an XML format that can carry <script> / event handlers. We still
    # store it (diagrams use SVG), but refuse anything that contains
    # executable markup. The serve path additionally forces an attachment
    # disposition + nosniff so the browser never parses it as active content.
    if file.content_type == "image/svg+xml" and _SVG_SCRIPT_RE.search(content):
        raise HTTPException(
            status_code=400,
            detail="SVG upload contains scripting or event handlers",
        )

    ext = Path(file.filename or "file").suffix
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = Path(settings.MEDIA_DIR) / filename

    filepath.write_bytes(content)

    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO media (filename, original_name, filepath, mime_type, size_bytes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (filename, file.filename, str(filepath), file.content_type, size, user["id"]),
    )
    await db.commit()

    return {
        "id": cursor.lastrowid,
        "filename": filename,
        "original_name": file.filename or "",
        "filepath": str(filepath),
        "mime_type": file.content_type or "",
        "size_bytes": size,
        "uploaded_by": user["id"],
        "url": f"/api/media/{filename}",
    }


@router.get("", response_model=list[MediaListItem])
async def list_media(user=Depends(get_current_user)):
    """List uploaded media visible to the current user.

    Admins see everything. Other users see media that is either (a)
    uploaded by them (handles orphan media) or (b) referenced by at least
    one live page they can read. Only admins can delete entries.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT m.id, m.filename, m.original_name, m.mime_type, m.size_bytes,
                  m.uploaded_by, m.uploaded_at,
                  CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                       THEN u.display_name ELSE u.username END AS uploaded_by_name,
                  (SELECT COUNT(*) FROM media_references r
                                    JOIN pages p ON p.id = r.page_id
                                    WHERE r.media_id = m.id AND p.deleted_at IS NULL) AS reference_count
           FROM media m
           LEFT JOIN users u ON u.id = m.uploaded_by
           ORDER BY m.uploaded_at DESC"""
    )

    # Single grouped query for referenced pages across all media, keyed by media_id.
    ref_rows = await db.execute_fetchall(
        """SELECT mr.media_id, p.id, p.slug, p.title
           FROM media_references mr
           JOIN pages p ON p.id = mr.page_id
           WHERE p.deleted_at IS NULL
           ORDER BY p.title"""
    )
    refs_by_media: dict[int, list[dict]] = {}
    refs_page_ids_by_media: dict[int, set[int]] = {}
    for r in ref_rows:
        refs_by_media.setdefault(r["media_id"], []).append(
            {"id": r["id"], "slug": r["slug"], "title": r["title"]}
        )
        refs_page_ids_by_media.setdefault(r["media_id"], set()).add(r["id"])

    is_admin = user.get("role") == "admin"
    readable_ids: set[int] = set()
    if not is_admin:
        readable_ids = await list_readable_page_ids(db, user)

    items: list[dict] = []
    for r in rows:
        item = dict(r)
        media_id = item["id"]
        referenced = refs_by_media.get(media_id, [])
        if not is_admin:
            ref_ids = refs_page_ids_by_media.get(media_id, set())
            if ref_ids:
                # Referenced media: must intersect with readable pages.
                if not (ref_ids & readable_ids):
                    continue
                # Hide referenced-page entries the user can't read.
                referenced = [p for p in referenced if p["id"] in readable_ids]
            else:
                # Orphan: only uploader sees it.
                if item["uploaded_by"] != user["id"]:
                    continue
        item["referenced_pages"] = referenced
        item["url"] = f"/api/media/{item['filename']}"
        items.append(item)
    return items


@router.delete("/{media_id}", status_code=204)
async def delete_media(media_id: int, user=Depends(require_admin)):
    """Delete an uploaded media file. Refuses if any live page still references it."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT filename, filepath FROM media WHERE id = ?", (media_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Media not found")

    ref_rows = await db.execute_fetchall(
        """SELECT COUNT(*) AS cnt
           FROM media_references mr
           JOIN pages p ON p.id = mr.page_id
           WHERE mr.media_id = ? AND p.deleted_at IS NULL""",
        (media_id,),
    )
    if ref_rows[0]["cnt"] > 0:
        raise HTTPException(
            status_code=409,
            detail="Media is referenced by one or more pages and cannot be deleted",
        )

    # Remove the file on disk. Guard against path traversal and missing files.
    media_dir = Path(settings.MEDIA_DIR).resolve()
    filepath = (media_dir / rows[0]["filename"]).resolve()
    if filepath.is_relative_to(media_dir) and filepath.exists():
        try:
            filepath.unlink()
        except OSError:
            pass  # Row deletion still proceeds; orphan file can be cleaned later.

    await db.execute("DELETE FROM media WHERE id = ?", (media_id,))
    await db.commit()


# logo.png ships with the install and is referenced from the login page and
# the default welcome content, so it must be fetchable without auth.
_ALWAYS_PUBLIC_FILENAMES = {"logo.png"}


def _safe_media_response(filepath: Path) -> FileResponse:
    """FileResponse hardened against browsers inferring active-content from SVG.

    SVG is the only format in the allow-list that can execute script; even
    after upload-time filtering we serve it as an attachment with nosniff so
    a polyglot slip-through can never run inline in the app's origin.
    """
    headers = {"X-Content-Type-Options": "nosniff"}
    if filepath.suffix.lower() in {".svg", ".svgz"}:
        headers["Content-Disposition"] = f'attachment; filename="{filepath.name}"'
    return FileResponse(filepath, headers=headers)


async def _media_is_public(db, filename: str) -> bool:
    """True if at least one live, public page references this media file."""
    rows = await db.execute_fetchall(
        """SELECT 1
           FROM media m
           JOIN media_references mr ON mr.media_id = m.id
           JOIN pages p ON p.id = mr.page_id
           WHERE m.filename = ?
             AND p.is_public = 1
             AND p.deleted_at IS NULL
           LIMIT 1""",
        (filename,),
    )
    return bool(rows)


@router.get("/{filename}")
async def get_media(filename: str, request: Request):
    media_dir = Path(settings.MEDIA_DIR).resolve()
    filepath = (media_dir / filename).resolve()

    # Prevent path traversal: resolved path must be inside MEDIA_DIR
    if not filepath.is_relative_to(media_dir):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Bundled-with-install files (e.g. logo.png) are always fetchable.
    if filename in _ALWAYS_PUBLIC_FILENAMES:
        return _safe_media_response(filepath)

    db = await get_db()
    user = await get_optional_user(request)

    if user is None:
        # When ANONYMOUS_READ is on, fall through to the synthetic guest so
        # media on open-default pages renders for visitors. Without this,
        # demo-mode pages with images look broken — every <img src> 404s
        # because get_optional_user returns None even when /api/pages/{slug}
        # would have served the page to the same visitor as a guest viewer.
        from app.config import settings as app_settings
        from app.auth import anonymous_user
        if app_settings.ANONYMOUS_READ:
            user = anonymous_user()
        else:
            # Flag off → fall back to the legacy is_public path so existing
            # share-a-public-page deployments keep working. This is the
            # asymmetric piece: /api/pages/{slug} returns 401 for the same
            # unauthenticated request, but a public page is served by
            # routers/public.py which embeds <img src="/api/media/...">,
            # and those tags must resolve without a session. Keep the two
            # paths aligned on what counts as "public": only media that
            # lives on a page with is_public=1.
            if not await _media_is_public(db, filename):
                raise HTTPException(status_code=404, detail="File not found")
            return _safe_media_response(filepath)

    # Authenticated: admin short-circuits, otherwise run the ACL check.
    if user.get("role") == "admin":
        return _safe_media_response(filepath)

    media_rows = await db.execute_fetchall(
        "SELECT id FROM media WHERE filename = ?", (filename,)
    )
    if not media_rows:
        # File exists on disk but not in DB — treat as not found for safety.
        raise HTTPException(status_code=404, detail="File not found")

    if not await can_read_media(db, user, media_rows[0]["id"]):
        raise HTTPException(status_code=404, detail="File not found")

    return _safe_media_response(filepath)
