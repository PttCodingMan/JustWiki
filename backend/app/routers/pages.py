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
    """Generate a URL-friendly slug from title. Preserves CJK characters so
    Chinese/Japanese/Korean titles show up in the URL as-is rather than pinyin."""
    if existing_slug:
        return existing_slug

    text = unicodedata.normalize("NFKC", title)
    text = text.strip().lower()
    # In Python 3 str regex, \w matches Unicode word characters including CJK,
    # so this strips punctuation while keeping letters from any script.
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

    where = "WHERE deleted_at IS NULL"
    params: list = []
    if parent_id is not None:
        where += " AND parent_id = ?"
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
        "SELECT id, slug, title, parent_id, sort_order FROM pages WHERE deleted_at IS NULL ORDER BY sort_order, title"
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
    pages = await db.execute_fetchall(
        "SELECT id, slug, title FROM pages WHERE deleted_at IS NULL"
    )
    nodes = [{"id": p["id"], "slug": p["slug"], "title": p["title"]} for p in pages]

    # Only show links between live pages
    live_ids = {p["id"] for p in pages}
    backlinks = await db.execute_fetchall("SELECT source_page_id, target_page_id FROM backlinks")
    links = [
        {"source": b["source_page_id"], "target": b["target_page_id"]}
        for b in backlinks
        if b["source_page_id"] in live_ids and b["target_page_id"] in live_ids
    ]

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
        """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, version, created_by)
           VALUES (?, ?, ?, ?, ?, 1, ?)""",
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
    new_page = dict(rows[0])

    # Fire notification
    from app.services.notifications import notify_page_created
    await notify_page_created(db, new_page, user)

    return new_page


@router.get("/{slug}", response_model=PageResponse)
async def get_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.*, CASE WHEN u.display_name IS NOT NULL AND u.display_name != '' THEN u.display_name ELSE u.username END AS author_name
           FROM pages p
           LEFT JOIN users u ON u.id = p.created_by
           WHERE p.slug = ? AND p.deleted_at IS NULL""",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    # Increment view count (does not bump the content version)
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
    rows = await db.execute_fetchall(
        "SELECT * FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    current = dict(rows[0])

    # Optimistic lock: if the client sent a base_version, it must match.
    # Missing base_version is allowed for legacy API clients, but logged.
    if body.base_version is not None and body.base_version != current["version"]:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This page was modified by someone else. Reload to see the latest version.",
                "current_version": current["version"],
                "your_version": body.base_version,
            },
        )

    title = body.title if body.title is not None else current["title"]
    content = body.content_md if body.content_md is not None else current["content_md"]
    parent_id = body.parent_id if "parent_id" in body.model_fields_set else current["parent_id"]
    sort_order = body.sort_order if body.sort_order is not None else current["sort_order"]
    current_is_public = bool(current.get("is_public", 0))
    is_public = body.is_public if body.is_public is not None else current_is_public

    content_changed = body.content_md is not None and body.content_md != current["content_md"]
    title_changed = body.title is not None and body.title != current["title"]
    public_changed = body.is_public is not None and bool(body.is_public) != current_is_public

    # Save current state as a version before updating (only if content/title actually changed).
    # Publicity toggles are metadata, not content, so they don't create a version.
    if content_changed or title_changed:
        await save_version(db, current["id"], current["title"], current["content_md"], user["id"])

    # is_public changes do NOT bump version (metadata, not content)
    new_version = current["version"] + 1 if (content_changed or title_changed) else current["version"]

    await db.execute(
        """UPDATE pages SET title = ?, content_md = ?, parent_id = ?, sort_order = ?,
           is_public = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?""",
        (title, content, parent_id, sort_order, 1 if is_public else 0, new_version, slug),
    )

    # Update search index
    await rebuild_search_index(db, current["id"], title, content)
    # Parse wikilinks → update backlinks
    await parse_and_update_backlinks(db, current["id"], content)
    # Log activity
    if content_changed or title_changed:
        await log_activity(db, user["id"], "updated", "page", current["id"], {"title": title, "slug": slug})
    if public_changed:
        action = "made_public" if is_public else "made_private"
        await log_activity(db, user["id"], action, "page", current["id"], {"title": title, "slug": slug})
    await db.commit()

    rows = await db.execute_fetchall("SELECT * FROM pages WHERE slug = ?", (slug,))
    updated = dict(rows[0])

    # Fire notifications if content/title actually changed
    if content_changed or title_changed:
        from app.services.notifications import notify_page_updated
        await notify_page_updated(db, updated, user, {"title_changed": title_changed, "content_changed": content_changed})

    return updated


@router.get("/{slug}/children")
async def get_children(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]
    children = await db.execute_fetchall(
        "SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, title",
        (page_id,),
    )
    return [dict(c) for c in children]


@router.get("/{slug}/backlinks")
async def get_backlinks(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]
    backlinks = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.title
           FROM backlinks b
           JOIN pages p ON p.id = b.source_page_id
           WHERE b.target_page_id = ? AND p.deleted_at IS NULL
           ORDER BY p.title""",
        (page_id,),
    )
    return [dict(b) for b in backlinks]


@router.patch("/{slug}/move")
async def move_page(slug: str, body: PageMoveRequest, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
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
    """Soft-delete a page. Moves it to the trash; it can be restored from there.

    Hard-deleting (purging) happens via DELETE /api/trash/{slug}, admin only.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, title, created_by FROM pages WHERE slug = ? AND deleted_at IS NULL",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    # Only admin or page creator can delete
    if user["role"] != "admin" and rows[0]["created_by"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the page creator or an admin can delete this page")

    page_id = rows[0]["id"]
    page_title = rows[0]["title"]

    # Soft delete: mark as deleted but keep the row, versions, and backlinks intact.
    await db.execute(
        "UPDATE pages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", (page_id,)
    )
    # Remove from search index so deleted pages don't appear in search
    await remove_from_search_index(db, page_id)
    # Log activity
    await log_activity(db, user["id"], "deleted", "page", page_id, {"title": page_title, "slug": slug})

    await db.commit()

    # Fire notification
    from app.services.notifications import notify_page_deleted
    await notify_page_deleted(db, {"id": page_id, "title": page_title, "slug": slug}, user)

    return {"ok": True}
