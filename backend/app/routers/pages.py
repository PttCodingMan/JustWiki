import re
import unicodedata
from fastapi import APIRouter, HTTPException, Depends, Query
from app.schemas import PageCreate, PageUpdate, PageResponse, PageListResponse, PageMoveRequest
from app.auth import get_current_user
from app.database import get_db
from app.services.search import rebuild_search_index, remove_from_search_index
from app.services.wikilink import parse_and_update_backlinks
from app.routers.activity import log_activity
from app.routers.versions import save_version

router = APIRouter(prefix="/api/pages", tags=["pages"])


def slugify(title: str, existing_slug: str | None = None) -> str:
    """Generate a URL-friendly slug from title. Supports Chinese via pypinyin."""
    if existing_slug:
        return existing_slug

    try:
        from pypinyin import lazy_pinyin

        parts = lazy_pinyin(title)
        text = "-".join(parts)
    except ImportError:
        text = title

    text = unicodedata.normalize("NFKD", text)
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    text = text.strip("-")
    return text or "untitled"


async def unique_slug(db, slug: str) -> str:
    base = slug
    counter = 1
    while True:
        rows = await db.execute_fetchall(
            "SELECT id FROM pages WHERE slug = ?", (slug,)
        )
        if not rows:
            return slug
        slug = f"{base}-{counter}"
        counter += 1


@router.get("", response_model=PageListResponse)
async def list_pages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    parent_id: int | None = None,
    user=Depends(get_current_user),
):
    db = await get_db()
    offset = (page - 1) * per_page

    where = ""
    params: list = []
    if parent_id is not None:
        where = "WHERE parent_id = ?"
        params.append(parent_id)

    count_row = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM pages {where}", params
    )
    total = count_row[0]["cnt"]

    rows = await db.execute_fetchall(
        f"SELECT * FROM pages {where} ORDER BY sort_order, updated_at DESC LIMIT ? OFFSET ?",
        params + [per_page, offset],
    )
    pages = [dict(r) for r in rows]
    return {"pages": pages, "total": total, "page": page, "per_page": per_page}


@router.get("/tree")
async def page_tree(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, slug, title, parent_id, sort_order FROM pages ORDER BY sort_order, title"
    )
    all_pages = [dict(r) for r in rows]

    def build_tree(parent_id):
        children = [p for p in all_pages if p["parent_id"] == parent_id]
        for child in children:
            child["children"] = build_tree(child["id"])
        return children

    return build_tree(None)


@router.get("/graph")
async def page_graph(user=Depends(get_current_user)):
    db = await get_db()
    pages = await db.execute_fetchall("SELECT id, slug, title FROM pages")
    nodes = [{"id": p["id"], "slug": p["slug"], "title": p["title"]} for p in pages]

    backlinks = await db.execute_fetchall("SELECT source_page_id, target_page_id FROM backlinks")
    links = [{"source": b["source_page_id"], "target": b["target_page_id"]} for b in backlinks]

    return {"nodes": nodes, "links": links}


@router.post("", response_model=PageResponse, status_code=201)
async def create_page(body: PageCreate, user=Depends(get_current_user)):
    db = await get_db()

    content = body.content_md
    if body.template_id:
        tmpl = await db.execute_fetchall(
            "SELECT content_md FROM templates WHERE id = ?", (body.template_id,)
        )
        if tmpl:
            content = tmpl[0]["content_md"]

    slug = await unique_slug(db, slugify(body.title, body.slug))

    cursor = await db.execute(
        """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, created_by)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (slug, body.title, content, body.parent_id, body.sort_order, user["id"]),
    )
    page_id = cursor.lastrowid

    # Update search index
    await rebuild_search_index(db, page_id, body.title, content)
    # Parse wikilinks → update backlinks
    await parse_and_update_backlinks(db, page_id, content)
    # Log activity
    await log_activity(db, user["id"], "created", "page", page_id, {"title": body.title, "slug": slug})
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE id = ?", (page_id,))
    return dict(rows[0])


@router.get("/{slug}", response_model=PageResponse)
async def get_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.*, CASE WHEN u.display_name IS NOT NULL AND u.display_name != '' THEN u.display_name ELSE u.username END AS author_name
           FROM pages p
           LEFT JOIN users u ON u.id = p.created_by
           WHERE p.slug = ?""",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    # Increment view count
    await db.execute(
        "UPDATE pages SET view_count = view_count + 1 WHERE slug = ?", (slug,)
    )
    await db.commit()

    page = dict(rows[0])
    page["view_count"] += 1
    return page


@router.put("/{slug}", response_model=PageResponse)
async def update_page(slug: str, body: PageUpdate, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    current = dict(rows[0])
    title = body.title if body.title is not None else current["title"]
    content = body.content_md if body.content_md is not None else current["content_md"]
    parent_id = body.parent_id if "parent_id" in body.model_fields_set else current["parent_id"]
    sort_order = body.sort_order if body.sort_order is not None else current["sort_order"]

    # Save current state as a version before updating
    await save_version(db, current["id"], current["title"], current["content_md"], user["id"])

    await db.execute(
        """UPDATE pages SET title = ?, content_md = ?, parent_id = ?, sort_order = ?,
           updated_at = CURRENT_TIMESTAMP WHERE slug = ?""",
        (title, content, parent_id, sort_order, slug),
    )

    # Update search index
    await rebuild_search_index(db, current["id"], title, content)
    # Parse wikilinks → update backlinks
    await parse_and_update_backlinks(db, current["id"], content)
    # Log activity
    await log_activity(db, user["id"], "updated", "page", current["id"], {"title": title, "slug": slug})
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    return dict(rows[0])


@router.get("/{slug}/children")
async def get_children(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]
    children = await db.execute_fetchall(
        "SELECT * FROM pages WHERE parent_id = ? ORDER BY sort_order, title",
        (page_id,),
    )
    return [dict(c) for c in children]


@router.get("/{slug}/backlinks")
async def get_backlinks(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]
    backlinks = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.title
           FROM backlinks b
           JOIN pages p ON p.id = b.source_page_id
           WHERE b.target_page_id = ?
           ORDER BY p.title""",
        (page_id,),
    )
    return [dict(b) for b in backlinks]


@router.patch("/{slug}/move")
async def move_page(slug: str, body: PageMoveRequest, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    updates = []
    params = []
    if "parent_id" in body.model_fields_set:
        updates.append("parent_id = ?")
        params.append(body.parent_id)
    if "sort_order" in body.model_fields_set:
        updates.append("sort_order = ?")
        params.append(body.sort_order)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(slug)
    await db.execute(f"UPDATE pages SET {', '.join(updates)} WHERE slug = ?", params)
    await db.commit()
    return {"ok": True}


@router.delete("/{slug}")
async def delete_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id, title, created_by FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    # Only admin or page creator can delete
    if user["role"] != "admin" and rows[0]["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the page creator or an admin can delete this page")

    page_id = rows[0]["id"]
    page_title = rows[0]["title"]

    # Remove from search index
    await remove_from_search_index(db, page_id)
    # Log activity
    await log_activity(db, user["id"], "deleted", "page", page_id, {"title": page_title, "slug": slug})

    await db.execute("DELETE FROM pages WHERE slug = ?", (slug,))
    await db.commit()
    return {"ok": True}
