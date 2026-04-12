"""Page change notifications.

Fires outbound webhooks and in-app notifications when pages change. Designed to
never block the request — failures are logged but do not raise.
"""
import asyncio
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger("justwiki.notifications")


async def notify_page_updated(db, page: dict, actor: dict, changes: dict) -> None:
    """Fire-and-forget notification dispatch when a page is updated."""
    try:
        await _dispatch(db, "page.updated", page, actor, changes)
    except Exception as exc:  # pragma: no cover — guardrail
        logger.warning("notify_page_updated failed: %s", exc)


async def notify_page_created(db, page: dict, actor: dict) -> None:
    try:
        await _dispatch(db, "page.created", page, actor, {})
    except Exception as exc:  # pragma: no cover
        logger.warning("notify_page_created failed: %s", exc)


async def notify_page_deleted(db, page: dict, actor: dict) -> None:
    try:
        await _dispatch(db, "page.deleted", page, actor, {})
    except Exception as exc:  # pragma: no cover
        logger.warning("notify_page_deleted failed: %s", exc)


async def _dispatch(db, event: str, page: dict, actor: dict, changes: dict) -> None:
    # 1. Build payload
    payload = {
        "event": event,
        "page": {
            "id": page.get("id"),
            "slug": page.get("slug"),
            "title": page.get("title"),
            "version": page.get("version"),
            "updated_at": str(page.get("updated_at")) if page.get("updated_at") else None,
        },
        "actor": {
            "id": actor.get("id"),
            "username": actor.get("username"),
        },
        "changes": changes,
    }

    # 2. Record in-app notification for watchers (excluding the actor)
    watchers = await db.execute_fetchall(
        """SELECT w.user_id FROM page_watchers w
           WHERE w.page_id = ? AND w.user_id != ?""",
        (page.get("id"), actor.get("id")),
    )
    watcher_ids = [w["user_id"] for w in watchers]
    if watcher_ids:
        metadata = json.dumps({"event": event, "title": page.get("title"), "slug": page.get("slug")})
        for wid in watcher_ids:
            await db.execute(
                """INSERT INTO notifications (user_id, event, page_id, actor_id, metadata)
                   VALUES (?, ?, ?, ?, ?)""",
                (wid, event, page.get("id"), actor.get("id"), metadata),
            )
        await db.commit()

    # 3. Fire outbound webhooks (fire-and-forget)
    hooks = await db.execute_fetchall(
        "SELECT id, url, events FROM webhooks WHERE is_active = 1"
    )
    targets = []
    for hook in hooks:
        events = [e.strip() for e in (hook["events"] or "").split(",") if e.strip()]
        if event in events or "*" in events:
            targets.append(hook["url"])

    if targets:
        # Run dispatches concurrently but do not block the HTTP response.
        asyncio.create_task(_post_many(targets, payload))


async def _post_many(urls: list[str], payload: dict) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        await asyncio.gather(
            *(_post_one(client, url, payload) for url in urls),
            return_exceptions=True,
        )


async def _post_one(client: httpx.AsyncClient, url: str, payload: dict) -> None:
    try:
        await client.post(url, json=payload)
    except Exception as exc:
        logger.info("webhook dispatch to %s failed: %s", url, exc)
