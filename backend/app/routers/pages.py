import re
import unicodedata
from fastapi import APIRouter, HTTPException, Depends, Query
from app.schemas import PageCreate, PageUpdate, PageResponse, PageListResponse
from app.auth import get_current_user
from app.database import get_db
from app.services.search import rebuild_search_index, remove_from_search_index
from app.routers.activity import log_activity

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
    # Log activity
    await log_activity(db, user["id"], "created", "page", page_id, {"title": body.title, "slug": slug})
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE id = ?", (page_id,))
    return dict(rows[0])


@router.get("/{slug}", response_model=PageResponse)
async def get_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
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
    parent_id = body.parent_id if body.parent_id is not None else current["parent_id"]
    sort_order = body.sort_order if body.sort_order is not None else current["sort_order"]

    await db.execute(
        """UPDATE pages SET title = ?, content_md = ?, parent_id = ?, sort_order = ?,
           updated_at = CURRENT_TIMESTAMP WHERE slug = ?""",
        (title, content, parent_id, sort_order, slug),
    )

    # Update search index
    await rebuild_search_index(db, current["id"], title, content)
    # Log activity
    await log_activity(db, user["id"], "updated", "page", current["id"], {"title": title, "slug": slug})
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    return dict(rows[0])


@router.delete("/{slug}")
async def delete_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id, title FROM pages WHERE slug = ?", (slug,))
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    page_id = rows[0]["id"]
    page_title = rows[0]["title"]

    # Remove from search index
    await remove_from_search_index(db, page_id)
    # Log activity
    await log_activity(db, user["id"], "deleted", "page", page_id, {"title": page_title, "slug": slug})

    await db.execute("DELETE FROM pages WHERE slug = ?", (slug,))
    await db.commit()
    return {"ok": True}
