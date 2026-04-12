"""Watch/unwatch endpoints for pages, and webhook CRUD for admins."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.database import get_db

router = APIRouter(tags=["watch"])


# ── Watching ──────────────────────────────────────────────────────────

@router.get("/api/pages/{slug}/watch")
async def get_watch_status(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    watching = await db.execute_fetchall(
        "SELECT 1 FROM page_watchers WHERE user_id = ? AND page_id = ?",
        (user["id"], page_id),
    )
    count = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM page_watchers WHERE page_id = ?", (page_id,)
    )
    return {"watching": bool(watching), "watcher_count": count[0]["cnt"]}


@router.post("/api/pages/{slug}/watch")
async def watch_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    await db.execute(
        "INSERT OR IGNORE INTO page_watchers (user_id, page_id) VALUES (?, ?)",
        (user["id"], page_id),
    )
    await db.commit()
    return {"watching": True}


@router.delete("/api/pages/{slug}/watch")
async def unwatch_page(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]

    await db.execute(
        "DELETE FROM page_watchers WHERE user_id = ? AND page_id = ?",
        (user["id"], page_id),
    )
    await db.commit()
    return {"watching": False}


# ── Webhooks (admin-managed) ──────────────────────────────────────────

class WebhookCreate(BaseModel):
    name: str
    url: str
    events: str = "page.updated,page.created,page.deleted"  # comma-separated
    is_active: bool = True


class WebhookUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    events: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/api/webhooks")
async def list_webhooks(user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, name, url, events, is_active, created_at FROM webhooks ORDER BY id"
    )
    return [dict(r) for r in rows]


@router.post("/api/webhooks", status_code=201)
async def create_webhook(body: WebhookCreate, user=Depends(require_admin)):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Webhook URL must start with http(s)://")
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO webhooks (name, url, events, is_active) VALUES (?, ?, ?, ?)",
        (body.name, body.url, body.events, 1 if body.is_active else 0),
    )
    await db.commit()
    row = await db.execute_fetchall(
        "SELECT id, name, url, events, is_active, created_at FROM webhooks WHERE id = ?",
        (cursor.lastrowid,),
    )
    return dict(row[0])


@router.put("/api/webhooks/{webhook_id}")
async def update_webhook(webhook_id: int, body: WebhookUpdate, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT id FROM webhooks WHERE id = ?", (webhook_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="Webhook not found")

    updates: list[str] = []
    params: list = []
    if body.name is not None:
        updates.append("name = ?")
        params.append(body.name)
    if body.url is not None:
        if not body.url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Webhook URL must start with http(s)://")
        updates.append("url = ?")
        params.append(body.url)
    if body.events is not None:
        updates.append("events = ?")
        params.append(body.events)
    if body.is_active is not None:
        updates.append("is_active = ?")
        params.append(1 if body.is_active else 0)

    if updates:
        params.append(webhook_id)
        await db.execute(f"UPDATE webhooks SET {', '.join(updates)} WHERE id = ?", params)
        await db.commit()

    row = await db.execute_fetchall(
        "SELECT id, name, url, events, is_active, created_at FROM webhooks WHERE id = ?",
        (webhook_id,),
    )
    return dict(row[0])


@router.delete("/api/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: int, user=Depends(require_admin)):
    db = await get_db()
    await db.execute("DELETE FROM webhooks WHERE id = ?", (webhook_id,))
    await db.commit()
