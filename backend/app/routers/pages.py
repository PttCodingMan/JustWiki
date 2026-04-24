import hashlib
import json
import random
import re
import time
import unicodedata
import aiosqlite
from fastapi import APIRouter, HTTPException, Depends, Query
from app.config import settings
from app.schemas import PageCreate, PageUpdate, PageResponse, PageListResponse, PageMoveRequest
from app.auth import get_current_user
from app.database import get_db
from app.services.acl import invalidate_readable_cache, list_readable_page_ids, resolve_page_permission
from app.services.search import rebuild_search_index, remove_from_search_index
from app.services.wikilink import parse_and_update_backlinks
from app.services.media_ref import parse_and_update_media_refs
from app.routers.activity import log_activity
from app.routers.versions import save_version

router = APIRouter(prefix="/api/pages", tags=["pages"])


async def _should_count_view(db, user_id: int, page_id: int) -> bool:
    """Record this view and return True if it should bump view_count.

    Counts at most once per (user, page) per VIEW_DEDUP_MINUTES. Keyed on
    sha256(user|page|SECRET_KEY) so a plain DB dump doesn't expose reading
    history — note that an attacker with both the DB and SECRET_KEY can
    still brute-force the small user_id × page_id space.
    """
    cooldown = settings.VIEW_DEDUP_MINUTES * 60
    now = int(time.time())
    cutoff = now - cooldown
    dedup_key = hashlib.sha256(
        f"u:{user_id}|{page_id}|{settings.SECRET_KEY.get_secret_value()}".encode()
    ).hexdigest()

    # Single-statement UPSERT so two concurrent views for the same key can't
    # both see no row and race on INSERT. The WHERE clause makes the UPDATE
    # branch a no-op while still inside the cooldown window, so rowcount
    # cleanly distinguishes "counted" (1) from "deduped" (0).
    cursor = await db.execute(
        """
        INSERT INTO view_dedup (dedup_key, page_id, last_viewed_at)
        VALUES (?, ?, ?)
        ON CONFLICT(dedup_key) DO UPDATE SET last_viewed_at = excluded.last_viewed_at
          WHERE view_dedup.last_viewed_at < ?
        """,
        (dedup_key, page_id, now, cutoff),
    )
    if cursor.rowcount != 1:
        return False

    # Opportunistic cleanup so the table doesn't grow unbounded. 1% of counted
    # views prune expired rows — amortises cleanup across traffic, no cron needed.
    if random.random() < 0.01:
        await db.execute(
            "DELETE FROM view_dedup WHERE last_viewed_at < ?", (cutoff,)
        )
    return True


def _build_id_clause(ids: set[int], column: str = "id") -> tuple[str, list]:
    """Produce a parameterized ``column IN (SELECT value FROM json_each(?))``
    clause plus params.

    Uses ``json_each`` instead of ``IN (?,?,...)`` to avoid hitting
    SQLite's ``SQLITE_MAX_VARIABLE_NUMBER`` limit on large page sets.
    For the empty set, returns a clause that never matches so downstream
    SQL can be composed without branching.
    """
    if not ids:
        return "0 = 1", []
    return f"{column} IN (SELECT value FROM json_each(?))", [json.dumps(list(ids))]


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


async def _would_create_parent_cycle(db, page_id: int, new_parent_id: int | None) -> bool:
    """True if setting page_id's parent to new_parent_id would create a cycle
    in the parent chain. A page pointing at itself also counts as a cycle.
    """
    if new_parent_id is None:
        return False
    if new_parent_id == page_id:
        return True
    # Walk the chain upward from new_parent_id. If we hit page_id, a cycle
    # would form; if we hit NULL or revisit a node, we're safe.
    current = new_parent_id
    seen: set[int] = set()
    while current is not None:
        if current == page_id:
            return True
        if current in seen:
            return False
        seen.add(current)
        rows = await db.execute_fetchall(
            "SELECT parent_id FROM pages WHERE id = ?", (current,)
        )
        if not rows:
            return False
        current = rows[0]["parent_id"]
    return False


@router.get("", response_model=PageListResponse)
async def list_pages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    parent_id: int | None = None,
    user=Depends(get_current_user),
):
    db = await get_db()
    offset = (page - 1) * per_page

    readable = await list_readable_page_ids(db, user)
    id_clause, id_params = _build_id_clause(readable)

    where = f"WHERE deleted_at IS NULL AND {id_clause}"
    params: list = list(id_params)
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
    readable = await list_readable_page_ids(db, user)
    id_clause, id_params = _build_id_clause(readable)
    rows = await db.execute_fetchall(
        f"SELECT id, slug, title, parent_id, sort_order FROM pages "
        f"WHERE deleted_at IS NULL AND {id_clause} "
        f"ORDER BY sort_order, title",
        id_params,
    )
    all_pages = [dict(r) for r in rows]

    # Reparent: if a page's parent is filtered out (not readable), promote
    # the page to a tree root so the user can still find it. Otherwise the
    # node would be orphaned and never rendered.
    readable_in_result = {p["id"] for p in all_pages}
    for p in all_pages:
        if p["parent_id"] is not None and p["parent_id"] not in readable_in_result:
            p["parent_id"] = None

    # Defensive: protect against any cycle in the stored parent_id chain.
    # New writes are validated in update_page/move_page/create_page, but a
    # pre-existing or externally-corrupted DB could still contain a cycle —
    # without this guard, build_tree would recurse forever.
    visited: set[int] = set()

    def build_tree(parent_id):
        children = [p for p in all_pages if p["parent_id"] == parent_id]
        result = []
        for child in children:
            if child["id"] in visited:
                continue
            visited.add(child["id"])
            child["children"] = build_tree(child["id"])
            result.append(child)
        return result

    return build_tree(None)


@router.get("/graph")
async def page_graph(user=Depends(get_current_user)):
    db = await get_db()
    readable = await list_readable_page_ids(db, user)
    id_clause, id_params = _build_id_clause(readable)
    pages = await db.execute_fetchall(
        f"SELECT id, slug, title FROM pages WHERE deleted_at IS NULL AND {id_clause}",
        id_params,
    )
    nodes = [{"id": p["id"], "slug": p["slug"], "title": p["title"]} for p in pages]

    # Only show links between pages the user can see.
    visible_ids = {p["id"] for p in pages}
    backlinks = await db.execute_fetchall("SELECT source_page_id, target_page_id FROM backlinks")
    links = [
        {"source": b["source_page_id"], "target": b["target_page_id"]}
        for b in backlinks
        if b["source_page_id"] in visible_ids and b["target_page_id"] in visible_ids
    ]

    return {"nodes": nodes, "links": links}


@router.post("", response_model=PageResponse, status_code=201)
async def create_page(body: PageCreate, user=Depends(get_current_user)):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot create pages")

    db = await get_db()

    content = body.content_md
    if body.template_id:
        tmpl = await db.execute_fetchall(
            "SELECT content_md FROM templates WHERE id = ?", (body.template_id,)
        )
        if tmpl:
            content = tmpl[0]["content_md"]

    if body.parent_id is not None:
        parent_rows = await db.execute_fetchall(
            "SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL",
            (body.parent_id,),
        )
        if not parent_rows:
            raise HTTPException(status_code=400, detail="Parent page not found")
        # Require write permission on the parent to nest under it.
        parent_perm = await resolve_page_permission(db, user, body.parent_id)
        if parent_perm not in ("admin", "write"):
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to create pages under this parent",
            )

    # Retry on the rare race where two concurrent create_page calls resolve the
    # same slug before either INSERT commits. unique_slug makes the collision
    # window small, and the UNIQUE constraint backstops correctness.
    page_id = None
    slug = None
    for _attempt in range(5):
        candidate = await unique_slug(db, slugify(body.title, body.slug))
        try:
            cursor = await db.execute(
                """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, version, page_type, created_by)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                (candidate, body.title, content, body.parent_id, body.sort_order, body.page_type, user["id"]),
            )
            slug = candidate
            page_id = cursor.lastrowid
            break
        except aiosqlite.IntegrityError:
            # Another request grabbed the slug first; try the next candidate.
            continue
    if page_id is None:
        raise HTTPException(status_code=409, detail="Could not allocate a unique slug; please retry")

    # Update search index
    await rebuild_search_index(db, page_id, body.title, content)
    # Parse wikilinks → update backlinks
    await parse_and_update_backlinks(db, page_id, content)
    # Parse media URLs → update media_references
    await parse_and_update_media_refs(db, page_id, content)
    # Log activity
    await log_activity(db, user["id"], "created", "page", page_id, {"title": body.title, "slug": slug})
    await db.commit()
    invalidate_readable_cache()

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

    page = dict(rows[0])
    permission = await resolve_page_permission(db, user, page["id"])
    if permission == "none":
        # Return 404 rather than 403 so unauthorized users can't probe for
        # the existence of restricted pages.
        raise HTTPException(status_code=404, detail="Page not found")

    # Increment view count (does not bump the content version), deduplicated
    # so refreshes / tab-switches by the same user don't inflate the count.
    if await _should_count_view(db, user["id"], page["id"]):
        await db.execute(
            "UPDATE pages SET view_count = view_count + 1 WHERE id = ?", (page["id"],)
        )
        page["view_count"] += 1
    await db.commit()

    page["effective_permission"] = permission
    return page


@router.put("/{slug}", response_model=PageResponse)
async def update_page(slug: str, body: PageUpdate, user=Depends(get_current_user)):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot edit pages")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    current = dict(rows[0])
    permission = await resolve_page_permission(db, user, current["id"])
    if permission == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if permission == "read":
        raise HTTPException(
            status_code=403,
            detail="You do not have write permission on this page",
        )

    # Optimistic lock. Required whenever the payload includes a content_md or
    # title change — those are the only edits that bump the version counter
    # and therefore the only ones that can silently clobber someone else's
    # work. Metadata-only edits (is_public toggle, parent/sort moves) don't
    # need it: they don't race against an open editor.
    touches_content = body.content_md is not None or body.title is not None
    if touches_content:
        if body.base_version is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "base_version_required",
                    "message": "base_version is required on content or title edits.",
                    "current_version": current["version"],
                },
            )
        if body.base_version != current["version"]:
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

    if "parent_id" in body.model_fields_set and parent_id != current["parent_id"]:
        if await _would_create_parent_cycle(db, current["id"], parent_id):
            raise HTTPException(
                status_code=400,
                detail="Cannot set parent: would create a cycle in the page tree",
            )
    current_is_public = bool(current.get("is_public", 0))
    is_public = body.is_public if body.is_public is not None else current_is_public
    current_page_type = current.get("page_type") or "document"
    page_type = body.page_type if body.page_type is not None else current_page_type

    content_changed = body.content_md is not None and body.content_md != current["content_md"]
    title_changed = body.title is not None and body.title != current["title"]
    public_changed = body.is_public is not None and bool(body.is_public) != current_is_public

    # Save current state as a version before updating (only if content/title actually changed).
    # Publicity/page_type toggles are metadata, not content, so they don't create a version.
    if content_changed or title_changed:
        await save_version(db, current["id"], current["title"], current["content_md"], user["id"])

    # is_public / page_type changes do NOT bump version (metadata, not content)
    new_version = current["version"] + 1 if (content_changed or title_changed) else current["version"]

    await db.execute(
        """UPDATE pages SET title = ?, content_md = ?, parent_id = ?, sort_order = ?,
           is_public = ?, page_type = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ?""",
        (title, content, parent_id, sort_order, 1 if is_public else 0, page_type, new_version, slug),
    )

    # Update search index
    await rebuild_search_index(db, current["id"], title, content)
    # Parse wikilinks → update backlinks
    await parse_and_update_backlinks(db, current["id"], content)
    # Parse media URLs → update media_references
    await parse_and_update_media_refs(db, current["id"], content)
    # Log activity
    if content_changed or title_changed:
        await log_activity(db, user["id"], "updated", "page", current["id"], {"title": title, "slug": slug})
    if public_changed:
        action = "made_public" if is_public else "made_private"
        await log_activity(db, user["id"], action, "page", current["id"], {"title": title, "slug": slug})
    await db.commit()
    if "parent_id" in body.model_fields_set and parent_id != current["parent_id"]:
        invalidate_readable_cache()  # parent change alters inherited ACL

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
    if await resolve_page_permission(db, user, page_id) == "none":
        raise HTTPException(status_code=404, detail="Page not found")

    readable = await list_readable_page_ids(db, user)
    id_clause, id_params = _build_id_clause(readable)
    children = await db.execute_fetchall(
        f"SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND {id_clause} "
        f"ORDER BY sort_order, title",
        [page_id] + id_params,
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
    if await resolve_page_permission(db, user, page_id) == "none":
        raise HTTPException(status_code=404, detail="Page not found")

    readable = await list_readable_page_ids(db, user)
    id_clause, id_params = _build_id_clause(readable, column="p.id")
    backlinks = await db.execute_fetchall(
        f"""SELECT p.id, p.slug, p.title
           FROM backlinks b
           JOIN pages p ON p.id = b.source_page_id
           WHERE b.target_page_id = ? AND p.deleted_at IS NULL AND {id_clause}
           ORDER BY p.title""",
        [page_id] + id_params,
    )
    return [dict(b) for b in backlinks]


@router.patch("/{slug}/move")
async def move_page(slug: str, body: PageMoveRequest, user=Depends(get_current_user)):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot move pages")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    src_perm = await resolve_page_permission(db, user, page_id)
    if src_perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if src_perm == "read":
        raise HTTPException(
            status_code=403,
            detail="You do not have write permission on this page",
        )

    updates = []
    params = []
    if "parent_id" in body.model_fields_set:
        if await _would_create_parent_cycle(db, page_id, body.parent_id):
            raise HTTPException(
                status_code=400,
                detail="Cannot move page: would create a cycle in the page tree",
            )
        if body.parent_id is not None:
            dst_perm = await resolve_page_permission(db, user, body.parent_id)
            if dst_perm not in ("admin", "write"):
                raise HTTPException(
                    status_code=403,
                    detail="You do not have permission to move pages under this parent",
                )
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
    if "parent_id" in body.model_fields_set:
        invalidate_readable_cache()  # parent change alters inherited ACL
    return {"ok": True}


@router.delete("/{slug}")
async def delete_page(slug: str, user=Depends(get_current_user)):
    """Soft-delete a page. Moves it to the trash; it can be restored from there.

    Hard-deleting (purging) happens via DELETE /api/trash/{slug}, admin only.
    """
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot delete pages")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, title, created_by FROM pages WHERE slug = ? AND deleted_at IS NULL",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    permission = await resolve_page_permission(db, user, rows[0]["id"])
    if permission == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if permission == "read":
        raise HTTPException(
            status_code=403,
            detail="You do not have write permission on this page",
        )

    # Only admin or page creator can delete (preserves existing rule in
    # addition to the ACL write check above).
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
    invalidate_readable_cache()

    # Fire notification
    from app.services.notifications import notify_page_deleted
    await notify_page_deleted(db, {"id": page_id, "title": page_title, "slug": slug}, user)

    return {"ok": True}
