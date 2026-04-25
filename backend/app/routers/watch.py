"""Watch/unwatch endpoints for pages, and webhook CRUD for admins."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_admin, require_real_user
from app.database import get_db
from app.services.acl import resolve_page_permission
from app.services.notifications import validate_webhook_url

router = APIRouter(tags=["watch"])


async def _require_readable_page(db, user, slug: str) -> int:
    """Resolve slug → page_id, 404 if missing/deleted or not readable.

    Collapsing "denied" and "not found" into the same 404 keeps the normal
    ACL policy intact — a user without read permission must not be able to
    probe whether a slug exists via /watch, nor subscribe to notifications
    on a page they can't read.
    """
    rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (slug,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = rows[0]["id"]
    if await resolve_page_permission(db, user, page_id) == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    return page_id


# ── Watching ──────────────────────────────────────────────────────────

@router.get("/api/pages/{slug}/watch")
async def get_watch_status(slug: str, user=Depends(require_real_user)):
    db = await get_db()
    page_id = await _require_readable_page(db, user, slug)

    watching = await db.execute_fetchall(
        "SELECT 1 FROM page_watchers WHERE user_id = ? AND page_id = ?",
        (user["id"], page_id),
    )
    count = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM page_watchers WHERE page_id = ?", (page_id,)
    )
    return {"watching": bool(watching), "watcher_count": count[0]["cnt"]}


@router.post("/api/pages/{slug}/watch")
async def watch_page(slug: str, user=Depends(require_real_user)):
    db = await get_db()
    page_id = await _require_readable_page(db, user, slug)

    await db.execute(
        "INSERT OR IGNORE INTO page_watchers (user_id, page_id) VALUES (?, ?)",
        (user["id"], page_id),
    )
    await db.commit()
    return {"watching": True}


@router.delete("/api/pages/{slug}/watch")
async def unwatch_page(slug: str, user=Depends(require_real_user)):
    db = await get_db()
    # Unwatch is always safe: even if ACL changed after subscribing, let
    # users clean up. Still require the page exists and isn't deleted.
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
    try:
        validate_webhook_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
        try:
            validate_webhook_url(body.url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
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
