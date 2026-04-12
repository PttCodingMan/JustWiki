"""In-app notification endpoints for watchers."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    db = await get_db()
    where = "WHERE n.user_id = ?"
    params: list = [user["id"]]
    if unread_only:
        where += " AND n.read_at IS NULL"
    rows = await db.execute_fetchall(
        f"""
        SELECT n.id, n.event, n.page_id, n.actor_id, n.metadata, n.read_at, n.created_at,
               p.slug AS page_slug, p.title AS page_title,
               CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                    THEN u.display_name ELSE u.username END AS actor_name
        FROM notifications n
        LEFT JOIN pages p ON p.id = n.page_id
        LEFT JOIN users u ON u.id = n.actor_id
        {where}
        ORDER BY n.created_at DESC
        LIMIT ?
        """,
        params + [limit],
    )
    unread_row = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND read_at IS NULL",
        (user["id"],),
    )
    return {
        "items": [dict(r) for r in rows],
        "unread_count": unread_row[0]["cnt"],
    }


@router.post("/read-all")
async def mark_all_read(user=Depends(get_current_user)):
    db = await get_db()
    await db.execute(
        "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL",
        (user["id"],),
    )
    await db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM notifications WHERE id = ? AND user_id = ?",
        (notification_id, user["id"]),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.execute(
        "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ?",
        (notification_id,),
    )
    await db.commit()
    return {"ok": True}
