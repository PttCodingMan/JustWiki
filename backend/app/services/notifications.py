"""Page change notifications.

Fires outbound webhooks and in-app notifications when pages change. Designed to
never block the request — failures are logged but do not raise.
"""
import asyncio
import ipaddress
import json
import logging
import socket
from typing import Any
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger("justwiki.notifications")


def _is_private_address(host: str) -> bool:
    """True if `host` resolves to a non-public address.

    Blocks RFC1918, loopback, link-local, multicast, reserved, and the
    cloud IMDS address (169.254.169.254 is already link-local). Also
    blocks IPv6 equivalents.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        # Unresolvable host — let httpx surface the connection error.
        # We treat unresolvable as "not obviously private"; the request
        # simply fails at send time.
        return False
    for info in infos:
        raw = info[4][0]
        try:
            addr = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_multicast
            or addr.is_reserved
            or addr.is_unspecified
        ):
            return True
    return False


def validate_webhook_url(url: str) -> None:
    """Raise ValueError if the URL points at a private/loopback/link-local host.

    Called at webhook-create/update time so a compromised admin account
    can't point a webhook at cloud IMDS, a sidecar container, or another
    internal service to exfiltrate or pivot. Runtime dispatch does a
    second check in case DNS changed after the webhook was stored.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError("Webhook URL must use http:// or https://")
    host = parts.hostname
    if not host:
        raise ValueError("Webhook URL must include a host")
    if _is_private_address(host):
        raise ValueError(
            "Webhook URL resolves to a private/loopback address, which is not allowed"
        )


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
    # follow_redirects=False so a stored hook whose host later issues a 302
    # to an internal address can't escape the validation we did at store time.
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
        await asyncio.gather(
            *(_post_one(client, url, payload) for url in urls),
            return_exceptions=True,
        )


async def _post_one(client: httpx.AsyncClient, url: str, payload: dict) -> None:
    # Re-check at dispatch time — the stored URL's hostname may have started
    # resolving to an internal address since it was saved. Silently drop
    # rather than contribute to the attacker's oracle.
    try:
        validate_webhook_url(url)
    except ValueError as exc:
        logger.warning("webhook %s rejected at dispatch: %s", url, exc)
        return
    try:
        await client.post(url, json=payload)
    except Exception as exc:
        logger.info("webhook dispatch to %s failed: %s", url, exc)
