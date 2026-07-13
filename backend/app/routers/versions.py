import difflib
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from app.auth import get_current_user
from app.database import get_db, write_transaction
from app.services.acl import PageAccess, page_dep
from app.services.search import rebuild_search_index
from app.services.wikilink import parse_and_update_backlinks
from app.services.media_ref import parse_and_update_media_refs
from app.services.notifications import notify_page_updated
from app.services.mention import notify_mentions
from app.routers.activity import log_activity


class RevertRequest(BaseModel):
    base_version: int | None = None  # for optimistic locking, mirrors PUT /pages/{slug}

router = APIRouter(prefix="/api/pages", tags=["versions"])


async def save_version(db, page_id: int, title: str, content_md: str, user_id: int):
    """Save the current page state as a new version. Call before updating."""
    # Atomic version numbering via INSERT...SELECT to prevent race conditions
    cursor = await db.execute(
        """INSERT INTO page_versions (page_id, title, content_md, edited_by, version_num)
           SELECT ?, ?, ?, ?, COALESCE(MAX(version_num), 0) + 1
           FROM page_versions WHERE page_id = ?""",
        (page_id, title, content_md, user_id, page_id),
    )
    row = await db.execute_fetchall(
        "SELECT version_num FROM page_versions WHERE id = ?", (cursor.lastrowid,)
    )
    return row[0]["version_num"]


@router.get("/{slug}/versions")
async def list_versions(
    slug: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    ctx: PageAccess = Depends(page_dep("read")),
):
    db = await get_db()
    page_id = ctx.page["id"]

    offset = (page - 1) * per_page
    count_row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM page_versions WHERE page_id = ?", (page_id,)
    )
    total = count_row[0]["cnt"]

    versions = await db.execute_fetchall(
        """SELECT v.id, v.version_num, v.title, v.edited_by, v.edited_at, u.username, u.display_name
           FROM page_versions v
           LEFT JOIN users u ON u.id = v.edited_by
           WHERE v.page_id = ?
           ORDER BY v.version_num DESC
           LIMIT ? OFFSET ?""",
        (page_id, per_page, offset),
    )
    # Carry the page's current version number so the revert UI can pass
    # base_version back without an extra round-trip.
    page_version_row = await db.execute_fetchall(
        "SELECT version FROM pages WHERE id = ?", (page_id,)
    )
    return {
        "versions": [dict(v) for v in versions],
        "page_version": page_version_row[0]["version"] if page_version_row else None,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{slug}/versions/{num}")
async def get_version(slug: str, num: int, ctx: PageAccess = Depends(page_dep("read"))):
    db = await get_db()
    page_id = ctx.page["id"]

    version = await db.execute_fetchall(
        """SELECT v.*, u.username, u.display_name FROM page_versions v
           LEFT JOIN users u ON u.id = v.edited_by
           WHERE v.page_id = ? AND v.version_num = ?""",
        (page_id, num),
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return dict(version[0])


@router.get("/{slug}/diff")
async def diff_versions(
    slug: str,
    v1: int = Query(..., description="Older version number"),
    v2: int = Query(..., description="Newer version number"),
    ctx: PageAccess = Depends(page_dep("read")),
):
    db = await get_db()
    page_id = ctx.page["id"]

    ver1 = await db.execute_fetchall(
        "SELECT title, content_md FROM page_versions WHERE page_id = ? AND version_num = ?",
        (page_id, v1),
    )
    ver2 = await db.execute_fetchall(
        "SELECT title, content_md FROM page_versions WHERE page_id = ? AND version_num = ?",
        (page_id, v2),
    )
    if not ver1 or not ver2:
        raise HTTPException(status_code=404, detail="Version not found")

    old_lines = ver1[0]["content_md"].splitlines(keepends=True)
    new_lines = ver2[0]["content_md"].splitlines(keepends=True)
    diff = list(difflib.unified_diff(old_lines, new_lines, fromfile=f"v{v1}", tofile=f"v{v2}"))

    return {
        "v1": {"num": v1, "title": ver1[0]["title"], "content_md": ver1[0]["content_md"]},
        "v2": {"num": v2, "title": ver2[0]["title"], "content_md": ver2[0]["content_md"]},
        "diff": "".join(diff),
    }


@router.post("/{slug}/revert/{num}")
async def revert_to_version(
    slug: str,
    num: int,
    body: RevertRequest = RevertRequest(),
    ctx: PageAccess = Depends(page_dep("write")),
):
    db = await get_db()
    user = ctx.user
    current = ctx.page

    # Optimistic lock — same contract as PUT /pages/{slug}. Reverting always
    # changes content, so the client MUST pin to a known base_version (no
    # silent fallback, matching update_page). If someone else edited the page
    # between the user opening the versions list and clicking revert, we 409
    # instead of clobbering.
    if body.base_version is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "base_version_required",
                "message": "base_version is required to revert.",
                "current_version": current["version"],
            },
        )

    version = await db.execute_fetchall(
        "SELECT title, content_md FROM page_versions WHERE page_id = ? AND version_num = ?",
        (current["id"], num),
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    old_content = current["content_md"]
    async with write_transaction(db):
        # Save current state as a new version before reverting
        await save_version(db, current["id"], current["title"], current["content_md"], user["id"])

        # Revert with an ATOMIC optimistic lock: guard the write with
        # `AND version = base_version` so the check and the write are a single
        # statement. A concurrent writer that already bumped the version makes
        # this match 0 rows → 409, closing the TOCTOU the pre-read check had.
        new_version = current["version"] + 1
        cursor = await db.execute(
            """UPDATE pages SET title = ?, content_md = ?, version = ?,
               updated_at = CURRENT_TIMESTAMP WHERE slug = ? AND version = ?""",
            (version[0]["title"], version[0]["content_md"], new_version, slug, body.base_version),
        )
        if cursor.rowcount == 0:
            latest = await db.execute_fetchall(
                "SELECT version FROM pages WHERE slug = ?", (slug,)
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "This page was modified by someone else. Reload the versions list and try again.",
                    "current_version": latest[0]["version"] if latest else None,
                    "your_version": body.base_version,
                },
            )
        await rebuild_search_index(db, current["id"], version[0]["title"], version[0]["content_md"])
        await parse_and_update_backlinks(db, current["id"], version[0]["content_md"])
        await parse_and_update_media_refs(db, current["id"], version[0]["content_md"])
        await log_activity(
            db, user["id"], "reverted", "page", current["id"],
            {"title": version[0]["title"], "slug": slug, "to_version": num},
        )

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    updated = dict(rows[0])

    # A revert changes content like any edit, so watchers and @mentions in the
    # reverted-to content must be notified (previously skipped).
    await notify_page_updated(
        db, updated, user, {"title_changed": True, "content_changed": True}
    )
    await notify_mentions(
        db,
        content_md=version[0]["content_md"],
        page_id=current["id"],
        actor=user,
        old_content_md=old_content,
    )

    return updated
