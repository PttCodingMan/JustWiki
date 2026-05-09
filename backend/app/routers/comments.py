from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.auth import require_real_user
from app.database import get_db, write_transaction
from app.services.acl import PageAccess, page_dep
from app.services.mention import notify_mentions
from app.routers.activity import log_activity

router = APIRouter(prefix="/api/pages/{slug}/comments", tags=["comments"])


class CommentCreate(BaseModel):
    content: str


class CommentUpdate(BaseModel):
    content: str


@router.get("")
async def list_comments(
    slug: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    ctx: PageAccess = Depends(page_dep("read")),
):
    # `page_dep("read")` enforces ACL — guests with ANONYMOUS_READ on can
    # still see comments on otherwise-readable pages. Posting is handled
    # by the `write` dep on the mutating routes.
    db = await get_db()
    page_id = ctx.page["id"]

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
async def create_comment(
    slug: str,
    body: CommentCreate,
    # Personal-write action — guest gets 401 before page_dep runs so an
    # ACL-restricted page returns 401, not 404.
    _real=Depends(require_real_user),
    ctx: PageAccess = Depends(page_dep("write")),
):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")
    db = await get_db()
    user = ctx.user
    page_id = ctx.page["id"]
    page_title = ctx.page["title"]

    comment_text = body.content.strip()
    async with write_transaction(db):
        cursor = await db.execute(
            "INSERT INTO comments (page_id, user_id, content) VALUES (?, ?, ?)",
            (page_id, user["id"], comment_text),
        )
        comment_id = cursor.lastrowid
        await log_activity(
            db, user["id"], "commented", "page", page_id,
            {"title": page_title, "comment_id": comment_id},
        )

    await notify_mentions(
        db,
        content_md=comment_text,
        page_id=page_id,
        actor=user,
        comment_id=comment_id,
    )

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
    slug: str,
    comment_id: int,
    body: CommentUpdate,
    _real=Depends(require_real_user),
    ctx: PageAccess = Depends(page_dep("write")),
):
    db = await get_db()
    user = ctx.user
    page_id = ctx.page["id"]
    # Verify the comment exists AND belongs to the page in the URL.
    rows = await db.execute_fetchall(
        "SELECT id, user_id, page_id, content FROM comments WHERE id = ?", (comment_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Comment not found")
    if rows[0]["page_id"] != page_id:
        raise HTTPException(status_code=404, detail="Comment not found on this page")
    if rows[0]["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    old_content = rows[0]["content"]
    new_content = body.content.strip()
    async with write_transaction(db):
        await db.execute(
            "UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_content, comment_id),
        )

    await notify_mentions(
        db,
        content_md=new_content,
        page_id=page_id,
        actor=user,
        comment_id=comment_id,
        old_content_md=old_content,
    )

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
async def delete_comment(
    slug: str,
    comment_id: int,
    _real=Depends(require_real_user),
    ctx: PageAccess = Depends(page_dep("write")),
):
    db = await get_db()
    user = ctx.user
    page_id = ctx.page["id"]
    # Verify the comment exists AND belongs to the page in the URL.
    rows = await db.execute_fetchall(
        "SELECT id, user_id, page_id FROM comments WHERE id = ?", (comment_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Comment not found")
    if rows[0]["page_id"] != page_id:
        raise HTTPException(status_code=404, detail="Comment not found on this page")
    if rows[0]["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not allowed")

    async with write_transaction(db):
        await db.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
