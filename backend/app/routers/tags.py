from fastapi import APIRouter, HTTPException, Depends
from app.auth import get_current_user, require_real_user
from app.database import get_db
from app.services.acl import (
    list_readable_page_ids,
    require_page_read,
    require_page_write,
)

router = APIRouter(prefix="/api", tags=["tags"])


@router.get("/tags")
async def list_tags(user=Depends(get_current_user)):
    db = await get_db()
    # Filter tag counts by readability so the global tag list doesn't leak
    # how many private pages carry each tag (e.g. `confidential`, `legal`).
    # Admins (and admin-bypass) read everything.
    readable = await list_readable_page_ids(db, user)
    if not readable:
        # No readable pages → every count would be 0; still return tag names
        # if any have at least one live page (admin only path is above, so
        # for a viewer with no readable pages we just return an empty list).
        return []

    placeholders = ",".join("?" * len(readable))
    rows = await db.execute_fetchall(
        f"""SELECT t.id, t.name, COUNT(p.id) as page_count
           FROM tags t
           LEFT JOIN page_tags pt ON pt.tag_id = t.id
           LEFT JOIN pages p
                  ON p.id = pt.page_id
                 AND p.deleted_at IS NULL
                 AND p.id IN ({placeholders})
           GROUP BY t.id, t.name
           HAVING COUNT(p.id) > 0
           ORDER BY t.name""",
        list(readable),
    )
    return [dict(r) for r in rows]


@router.get("/pages/{slug}/tags")
async def get_page_tags(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    page = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]
    # 404 (not 403) on deny so the existence of a restricted page isn't probed.
    await require_page_read(db, user, page_id)

    rows = await db.execute_fetchall(
        """SELECT t.id, t.name FROM tags t
           JOIN page_tags pt ON pt.tag_id = t.id
           WHERE pt.page_id = ?
           ORDER BY t.name""",
        (page_id,),
    )
    return [dict(r) for r in rows]


@router.post("/pages/{slug}/tags")
async def add_tag_to_page(slug: str, body: dict, user=Depends(require_real_user)):
    db = await get_db()
    page = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]
    # Tagging counts as a content edit; require write on the target page so
    # viewers (and the synthetic guest, double-belted by require_real_user)
    # can't graffiti private pages they happen to know the slug of.
    await require_page_write(db, user, page_id)

    tag_name = body.get("name", "").strip()
    if not tag_name:
        raise HTTPException(status_code=400, detail="Tag name required")

    # Get or create tag
    existing = await db.execute_fetchall("SELECT id FROM tags WHERE name = ?", (tag_name,))
    if existing:
        tag_id = existing[0]["id"]
    else:
        cursor = await db.execute("INSERT INTO tags (name) VALUES (?)", (tag_name,))
        tag_id = cursor.lastrowid

    # Link tag to page (ignore if already exists)
    await db.execute(
        "INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)",
        (page_id, tag_id),
    )
    await db.commit()

    return {"id": tag_id, "name": tag_name}


@router.delete("/pages/{slug}/tags/{tag_name}")
async def remove_tag_from_page(slug: str, tag_name: str, user=Depends(require_real_user)):
    db = await get_db()
    page = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]
    await require_page_write(db, user, page_id)

    tag = await db.execute_fetchall("SELECT id FROM tags WHERE name = ?", (tag_name,))
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag_id = tag[0]["id"]

    await db.execute(
        "DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?",
        (page_id, tag_id),
    )
    await db.commit()

    # Clean up orphan tags (tags with no pages)
    await db.execute(
        "DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM page_tags WHERE tag_id = ?)",
        (tag_id, tag_id),
    )
    await db.commit()

    return {"ok": True}
