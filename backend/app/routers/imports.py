"""Bulk import of Markdown content (folder zip, Obsidian vault, HackMD notes,
Wiki.js storage dump).

The conversion itself lives in ``services/md_import.py`` and is pure; this
router owns the side effects: writing media files, inserting pages/tags/media
in a single transaction, indexing, and cleaning up on failure.
"""
import asyncio
from pathlib import Path

import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.auth import require_admin
from app.config import settings
from app.database import get_db, write_transaction
from app.routers.activity import log_activity
from app.services import site_settings
from app.services.acl import invalidate_readable_cache
from app.services.md_import import ImportFailed, ImportSource, convert
from app.services.media_ref import parse_and_update_media_refs
from app.services.page_slug import new_page_slug
from app.services.search import rebuild_search_index
from app.services.wikilink import parse_and_update_backlinks

router = APIRouter(prefix="/api/import", tags=["import"])

MAX_IMPORT_BYTES = 200 * 1024 * 1024


# Raises the app-wide request body cap (main.MAX_REQUEST_BODY) for this route;
# a little headroom over MAX_IMPORT_BYTES for multipart overhead.
@router.post("", max_body_size=MAX_IMPORT_BYTES + 5 * 1024 * 1024)
async def import_markdown(
    file: UploadFile = File(...),
    source: str = Form("auto"),
    parent_slug: str | None = Form(None),
    user=Depends(require_admin),
):
    """Import a .zip of Markdown files (or a single .md) as pages.

    Admin-only, like backup restore: it creates many pages and media in one
    go. Imported pages are created by the caller; per-page notifications and
    webhooks are not fired (a single `imported` activity entry is logged).
    """
    content = await file.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="Import file too large (max 200 MB)")

    db = await get_db()

    parent_id = None
    if parent_slug:
        rows = await db.execute_fetchall(
            "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (parent_slug,)
        )
        if not rows:
            raise HTTPException(status_code=400, detail="Parent page not found")
        parent_id = rows[0]["id"]

    # Slugs are unique across live *and* trashed pages.
    taken = {r["slug"] for r in await db.execute_fetchall("SELECT slug FROM pages")}

    def allocate_slug() -> str:
        while True:
            slug = new_page_slug()
            if slug not in taken:
                taken.add(slug)
                return slug

    max_asset_bytes = await site_settings.get_int("max_upload_mb") * 1024 * 1024

    def plan():
        src = ImportSource.from_upload(file.filename or "", content)
        return convert(src, source, new_slug=allocate_slug, max_asset_bytes=max_asset_bytes)

    try:
        result = await asyncio.to_thread(plan)
    except ImportFailed as e:
        raise HTTPException(status_code=400, detail=str(e))

    media_dir = Path(settings.MEDIA_DIR)
    written: list[Path] = []

    def write_media():
        media_dir.mkdir(parents=True, exist_ok=True)
        for m in result.media:
            path = media_dir / m.filename
            path.write_bytes(m.data)
            written.append(path)

    try:
        await asyncio.to_thread(write_media)
        page_ids: dict[str, int] = {}
        async with write_transaction(db):
            for m in result.media:
                await db.execute(
                    """INSERT INTO media (filename, original_name, filepath, mime_type, size_bytes, uploaded_by)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (m.filename, m.original_name, str(media_dir / m.filename),
                     m.mime_type, len(m.data), user["id"]),
                )

            # result.pages is ordered parents-first, so parent ids exist.
            for p in result.pages:
                cursor = await db.execute(
                    """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, version, created_by)
                       VALUES (?, ?, ?, ?, ?, 1, ?)""",
                    (p.slug, p.title, p.content_md,
                     page_ids[p.parent_key] if p.parent_key else parent_id,
                     p.sort_order, user["id"]),
                )
                page_ids[p.key] = cursor.lastrowid

            # Second pass once every page exists, so backlinks resolve.
            tag_ids: dict[str, int] = {}
            for p in result.pages:
                pid = page_ids[p.key]
                await rebuild_search_index(db, pid, p.title, p.content_md)
                await parse_and_update_backlinks(db, pid, p.content_md)
                await parse_and_update_media_refs(db, pid, p.content_md)
                for name in p.tags:
                    if name not in tag_ids:
                        await db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
                        rows = await db.execute_fetchall("SELECT id FROM tags WHERE name = ?", (name,))
                        tag_ids[name] = rows[0]["id"]
                    await db.execute(
                        "INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)",
                        (pid, tag_ids[name]),
                    )

            roots = [p for p in result.pages if p.parent_key is None]
            await log_activity(
                db, user["id"], "imported", "page", page_ids[roots[0].key],
                {"title": roots[0].title, "slug": roots[0].slug,
                 "pages": len(result.pages), "source": result.flavor},
            )
    except aiosqlite.IntegrityError:
        _cleanup(written)
        raise HTTPException(status_code=409, detail="Import conflicted with a concurrent change; please retry")
    except BaseException:
        _cleanup(written)
        raise

    invalidate_readable_cache()

    return {
        "source": result.flavor,
        "pages_created": len(result.pages),
        "media_imported": len(result.media),
        "root_pages": [{"slug": p.slug, "title": p.title} for p in roots],
        "warnings": result.warnings,
        "warnings_truncated": result.warnings_truncated,
    }


def _cleanup(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except OSError:
            pass
