import difflib
from fastapi import APIRouter, HTTPException, Depends, Query
from app.auth import get_current_user
from app.database import get_db
from app.services.search import rebuild_search_index
from app.services.wikilink import parse_and_update_backlinks
from app.routers.activity import log_activity

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
    user=Depends(get_current_user),
):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    offset = (page - 1) * per_page
    count_row = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM page_versions WHERE page_id = ?", (page_id,)
    )
    total = count_row[0]["cnt"]

    versions = await db.execute_fetchall(
        """SELECT v.id, v.version_num, v.title, v.edited_by, v.edited_at, u.username
           FROM page_versions v
           LEFT JOIN users u ON u.id = v.edited_by
           WHERE v.page_id = ?
           ORDER BY v.version_num DESC
           LIMIT ? OFFSET ?""",
        (page_id, per_page, offset),
    )
    return {
        "versions": [dict(v) for v in versions],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{slug}/versions/{num}")
async def get_version(slug: str, num: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    version = await db.execute_fetchall(
        """SELECT v.*, u.username FROM page_versions v
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
    user=Depends(get_current_user),
):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

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
async def revert_to_version(slug: str, num: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    current = dict(rows[0])

    version = await db.execute_fetchall(
        "SELECT title, content_md FROM page_versions WHERE page_id = ? AND version_num = ?",
        (current["id"], num),
    )
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current state as a new version before reverting
    await save_version(db, current["id"], current["title"], current["content_md"], user["id"])

    # Revert
    await db.execute(
        """UPDATE pages SET title = ?, content_md = ?, updated_at = CURRENT_TIMESTAMP
           WHERE slug = ?""",
        (version[0]["title"], version[0]["content_md"], slug),
    )
    await rebuild_search_index(db, current["id"], version[0]["title"], version[0]["content_md"])
    await parse_and_update_backlinks(db, current["id"], version[0]["content_md"])
    await log_activity(
        db, user["id"], "reverted", "page", current["id"],
        {"title": version[0]["title"], "slug": slug, "to_version": num},
    )
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    return dict(rows[0])
