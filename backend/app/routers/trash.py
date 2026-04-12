"""Trash endpoints: list, restore, purge soft-deleted pages.

The hard-delete path (`DELETE /api/pages/{slug}`) soft-deletes pages by setting
`deleted_at`. From here, the creator or an admin can restore them, or an admin
can purge them forever.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.routers.activity import log_activity
from app.services.search import rebuild_search_index
from app.services.wikilink import parse_and_update_backlinks

router = APIRouter(prefix="/api/trash", tags=["trash"])


@router.get("")
async def list_trash(user=Depends(get_current_user)):
    """List soft-deleted pages. Non-admins only see pages they created."""
    db = await get_db()
    base_sql = """
        SELECT p.id, p.slug, p.title, p.content_md, p.parent_id, p.version,
               p.view_count, p.created_by, p.deleted_at, p.updated_at,
               CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                    THEN u.display_name ELSE u.username END AS author_name
        FROM pages p
        LEFT JOIN users u ON u.id = p.created_by
        WHERE p.deleted_at IS NOT NULL
    """
    if user["role"] == "admin":
        rows = await db.execute_fetchall(base_sql + " ORDER BY p.deleted_at DESC")
    else:
        rows = await db.execute_fetchall(
            base_sql + " AND p.created_by = ? ORDER BY p.deleted_at DESC",
            (user["id"],),
        )
    return {"items": [dict(r) for r in rows]}


@router.post("/{slug}/restore")
async def restore_page(slug: str, user=Depends(get_current_user)):
    """Restore a soft-deleted page. Admin or the original creator only."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM pages WHERE slug = ? AND deleted_at IS NOT NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found in trash")

    page = dict(rows[0])
    if user["role"] != "admin" and page["created_by"] != user["id"]:
        raise HTTPException(
            status_code=403,
            detail="Only the page creator or an admin can restore this page",
        )

    # If the slug has been taken by a new page while this one was in the trash,
    # refuse to restore — caller must purge or the new page must be renamed.
    # (Currently the slug stays on the deleted row so there's nothing to collide
    # with; this check is defensive.)
    clash = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL AND id != ?",
        (slug, page["id"]),
    )
    if clash:
        raise HTTPException(
            status_code=409,
            detail="Another page now uses this slug. Rename it first.",
        )

    await db.execute(
        "UPDATE pages SET deleted_at = NULL WHERE id = ?", (page["id"],)
    )
    # Re-add to search index and regenerate outgoing backlinks — they were not
    # deleted from the backlinks table on soft-delete, but any links to pages
    # that moved/were renamed while this one was in the trash would be stale.
    await rebuild_search_index(db, page["id"], page["title"], page["content_md"])
    await parse_and_update_backlinks(db, page["id"], page["content_md"])
    await log_activity(
        db, user["id"], "restored", "page", page["id"],
        {"title": page["title"], "slug": slug},
    )
    await db.commit()

    # Return the fully re-hydrated page
    rows = await db.execute_fetchall(
        "SELECT * FROM pages WHERE id = ?", (page["id"],)
    )
    return dict(rows[0])


@router.delete("/{slug}", status_code=204)
async def purge_page(slug: str, user=Depends(require_admin)):
    """Permanently delete a trashed page. Admin only."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, title FROM pages WHERE slug = ? AND deleted_at IS NOT NULL",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found in trash")

    page_id = rows[0]["id"]
    page_title = rows[0]["title"]

    # Explicitly remove from search index (in case it was re-added)
    from app.services.search import remove_from_search_index
    await remove_from_search_index(db, page_id)

    await db.execute("DELETE FROM pages WHERE id = ?", (page_id,))
    await log_activity(
        db, user["id"], "purged", "page", page_id,
        {"title": page_title, "slug": slug},
    )
    await db.commit()
