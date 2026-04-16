from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user
from app.database import get_db
from app.services.acl import resolve_page_permission
from app.routers.activity import log_activity

router = APIRouter(prefix="/api/pages/{slug}/comments", tags=["comments"])


async def _require_page_read(db, user, page_id: int):
    """Read-or-better permission is enough to list comments."""
    perm = await resolve_page_permission(db, user, page_id)
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    return perm


async def _require_page_write(db, user, page_id: int):
    """Write-or-better permission is required to post comments."""
    perm = await resolve_page_permission(db, user, page_id)
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if perm == "read":
        raise HTTPException(status_code=403, detail="You do not have write permission on this page")


class CommentCreate(BaseModel):
    content: str


class CommentUpdate(BaseModel):
    content: str


@router.get("")
async def list_comments(
    slug: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    db = await get_db()
    page_rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page_rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page_rows[0]["id"]
    await _require_page_read(db, user, page_id)

    offset = (page - 1) * per_page
    count_rows = await db.execute_fetchall(
        "SELECT COUNT(*) as cnt FROM comments WHERE page_id = ?", (page_id,)
    )
    total = count_rows[0]["cnt"]

    rows = await db.execute_fetchall(
        """SELECT c.id, c.page_id, c.user_id, c.content, c.created_at, c.updated_at,
                  u.username, u.display_name
           FROM comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.page_id = ?
           ORDER BY c.created_at ASC
           LIMIT ? OFFSET ?""",
        (page_id, per_page, offset),
    )
    return {
        "comments": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("", status_code=201)
async def create_comment(slug: str, body: CommentCreate, user=Depends(get_current_user)):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")
    db = await get_db()
    page_rows = await db.execute_fetchall("SELECT id, title FROM pages WHERE slug = ?", (slug,))
    if not page_rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page_rows[0]["id"]
    page_title = page_rows[0]["title"]
    await _require_page_write(db, user, page_id)

    cursor = await db.execute(
        "INSERT INTO comments (page_id, user_id, content) VALUES (?, ?, ?)",
        (page_id, user["id"], body.content.strip()),
    )
    await log_activity(
        db, user["id"], "commented", "page", page_id,
        {"title": page_title, "comment_id": cursor.lastrowid},
    )
    await db.commit()

    row = await db.execute_fetchall(
        """SELECT c.id, c.page_id, c.user_id, c.content, c.created_at, c.updated_at,
                  u.username, u.display_name
           FROM comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.id = ?""",
        (cursor.lastrowid,),
    )
    return dict(row[0])


@router.put("/{comment_id}")
async def update_comment(
    slug: str, comment_id: int, body: CommentUpdate, user=Depends(get_current_user)
):
    db = await get_db()
    # Verify the comment exists AND belongs to the page in the URL
    page_rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page_rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page_rows[0]["id"]
    await _require_page_write(db, user, page_id)
    rows = await db.execute_fetchall(
        "SELECT id, user_id, page_id FROM comments WHERE id = ?", (comment_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Comment not found")
    if rows[0]["page_id"] != page_id:
        raise HTTPException(status_code=404, detail="Comment not found on this page")
    if rows[0]["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    await db.execute(
        "UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (body.content.strip(), comment_id),
    )
    await db.commit()

    row = await db.execute_fetchall(
        """SELECT c.id, c.page_id, c.user_id, c.content, c.created_at, c.updated_at,
                  u.username, u.display_name
           FROM comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.id = ?""",
        (comment_id,),
    )
    return dict(row[0])


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(slug: str, comment_id: int, user=Depends(get_current_user)):
    db = await get_db()
    # Verify the comment exists AND belongs to the page in the URL
    page_rows = await db.execute_fetchall("SELECT id FROM pages WHERE slug = ?", (slug,))
    if not page_rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page_rows[0]["id"]
    await _require_page_write(db, user, page_id)
    rows = await db.execute_fetchall(
        "SELECT id, user_id, page_id FROM comments WHERE id = ?", (comment_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Comment not found")
    if rows[0]["page_id"] != page_id:
        raise HTTPException(status_code=404, detail="Comment not found on this page")
    if rows[0]["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    await db.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    await db.commit()
