import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from app.schemas import MediaResponse, MediaListItem
from app.auth import get_current_user, require_admin, ALGORITHM
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/api/media", tags=["media"])

ALLOWED_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf", "text/plain", "text/markdown",
}

MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/upload", response_model=MediaResponse, status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    ext = Path(file.filename or "file").suffix
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = Path(settings.MEDIA_DIR) / filename

    content = await file.read()
    size = len(content)
    if size > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024*1024)} MB")
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
    """List all uploaded media with reference counts and linked pages.

    Any authenticated user can browse the library (same permission level as
    uploading), but only admins can delete entries.
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
    for r in ref_rows:
        refs_by_media.setdefault(r["media_id"], []).append(
            {"id": r["id"], "slug": r["slug"], "title": r["title"]}
        )

    items: list[dict] = []
    for r in rows:
        item = dict(r)
        item["referenced_pages"] = refs_by_media.get(item["id"], [])
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


def _request_is_authenticated(request: Request) -> bool:
    """Best-effort credential check without raising.

    Lets this route stay open for public-page readers while still serving
    authenticated editors regardless of what the media references.
    """
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("token")
    if not token:
        return False
    try:
        jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return True
    except JWTError:
        return False


# logo.png ships with the install and is referenced from the login page and
# the default welcome content, so it must be fetchable without auth.
_ALWAYS_PUBLIC_FILENAMES = {"logo.png"}


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

    # Authenticated users can fetch any media in the library.
    # Anonymous users can only fetch files that are either bundled (logo) or
    # referenced by at least one live, public page, so private uploads aren't
    # exposed via UUID guessing or enumeration.
    if not _request_is_authenticated(request):
        if filename not in _ALWAYS_PUBLIC_FILENAMES:
            db = await get_db()
            if not await _media_is_public(db, filename):
                raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(filepath)
