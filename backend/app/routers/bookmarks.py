from fastapi import APIRouter, HTTPException, Depends
from app.auth import get_current_user, require_real_user
from app.database import get_db, write_transaction
from app.services.acl import PageAccess, page_dep

# Bookmarks are inherently per-user; the synthetic guest has no place here,
# so reject it at the router boundary instead of repeating the check on
# every endpoint.
router = APIRouter(
    prefix="/api/bookmarks",
    tags=["bookmarks"],
    dependencies=[Depends(require_real_user)],
)


@router.get("")
async def list_bookmarks(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.title, p.updated_at, p.view_count, b.created_at as bookmarked_at
           FROM bookmarks b
           JOIN pages p ON p.id = b.page_id
           WHERE b.user_id = ? AND p.deleted_at IS NULL
           ORDER BY b.created_at DESC""",
        (user["id"],),
    )
    return [dict(r) for r in rows]


@router.post("/{slug}")
async def add_bookmark(slug: str, ctx: PageAccess = Depends(page_dep("read"))):
    db = await get_db()
    user = ctx.user
    page_id = ctx.page["id"]

    async with write_transaction(db):
        await db.execute(
            "INSERT OR IGNORE INTO bookmarks (user_id, page_id) VALUES (?, ?)",
            (user["id"], page_id),
        )
    return {"ok": True}


@router.delete("/{slug}")
async def remove_bookmark(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    # No deleted_at filter or ACL check: removing your own bookmark is always
    # safe, and we want it to keep working even after the page is soft-deleted
    # or its ACL changes so users can clean up stale entries.
    page = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page[0]["id"]

    async with write_transaction(db):
        await db.execute(
            "DELETE FROM bookmarks WHERE user_id = ? AND page_id = ?",
            (user["id"], page_id),
        )
    return {"ok": True}


@router.get("/check/{slug}")
async def check_bookmark(slug: str, ctx: PageAccess = Depends(page_dep("read"))):
    db = await get_db()
    user = ctx.user
    page_id = ctx.page["id"]

    rows = await db.execute_fetchall(
        "SELECT 1 FROM bookmarks WHERE user_id = ? AND page_id = ?",
        (user["id"], page_id),
    )
    return {"bookmarked": len(rows) > 0}
