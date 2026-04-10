from fastapi import APIRouter, HTTPException, Depends
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api", tags=["tags"])


@router.get("/tags")
async def list_tags(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT t.id, t.name, COUNT(pt.page_id) as page_count
           FROM tags t
           LEFT JOIN page_tags pt ON pt.tag_id = t.id
           GROUP BY t.id, t.name
           ORDER BY t.name"""
    )
    return [dict(r) for r in rows]


@router.get("/pages/{slug}/tags")
async def get_page_tags(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    page = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]

    rows = await db.execute_fetchall(
        """SELECT t.id, t.name FROM tags t
           JOIN page_tags pt ON pt.tag_id = t.id
           WHERE pt.page_id = ?
           ORDER BY t.name""",
        (page_id,),
    )
    return [dict(r) for r in rows]


@router.post("/pages/{slug}/tags")
async def add_tag_to_page(slug: str, body: dict, user=Depends(get_current_user)):
    db = await get_db()
    page = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]

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
async def remove_tag_from_page(slug: str, tag_name: str, user=Depends(get_current_user)):
    db = await get_db()
    page = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]

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
