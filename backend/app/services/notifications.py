"""Page change notifications.

Fires outbound webhooks and in-app notifications when pages change. Designed to
never block the request — failures are logged but do not raise.
"""
import asyncio
import ipaddress
import json
import logging
import socket
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.database import write_transaction

logger = logging.getLogger("justwiki.notifications")


_NAT64_PREFIX = ipaddress.ip_network("64:ff9b::/96")


def _is_blocked_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for anything that isn't a plain public unicast address.

    `is_global` already excludes RFC1918, loopback, link-local (incl. cloud
    IMDS at 169.254.169.254), CGNAT 100.64/10 (Alibaba IMDS, Tailscale),
    ULA, reserved and unspecified ranges. IPv6 forms that embed an IPv4
    address (mapped, 6to4, NAT64) are judged by the embedded address.
    """
    if isinstance(addr, ipaddress.IPv6Address):
        embedded = addr.ipv4_mapped or addr.sixtofour
        if embedded is None and addr in _NAT64_PREFIX:
            embedded = ipaddress.IPv4Address(int(addr) & 0xFFFFFFFF)
        if embedded is not None and _is_blocked_ip(embedded):
            return True
    return not addr.is_global or addr.is_multicast


def _resolve(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve `host` (name or IP literal). Raises OSError if unresolvable."""
    out = []
    for info in socket.getaddrinfo(host, None):
        try:
            out.append(ipaddress.ip_address(info[4][0].split("%", 1)[0]))
        except ValueError:
            continue
    if not out:
        raise OSError(f"no usable address for {host}")
    return out


def _is_private_address(host: str) -> bool:
    """True if `host` resolves to any non-public address.

    An unresolvable host is "not obviously private" here (store-time check:
    DNS may be briefly unavailable). Dispatch resolves again and fails
    closed, so a name that later resolves internally is still caught.
    """
    try:
        addrs = _resolve(host)
    except OSError:
        return False
    return any(_is_blocked_ip(a) for a in addrs)


def validate_webhook_url(url: str) -> None:
    """Raise ValueError if the URL points at a private/loopback/link-local host.

    Called at webhook-create/update time so a compromised admin account
    can't point a webhook at cloud IMDS, a sidecar container, or another
    internal service to exfiltrate or pivot. Dispatch re-resolves and pins
    the connection to the checked IP (see `_post_one`).
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


def _pin_to_public_ip(url: str) -> tuple[str, dict, dict]:
    """Resolve the webhook host once, check every address, and return a
    request (url, headers, extensions) that connects to the checked IP.

    Connecting to the IP literal closes the DNS-rebinding window: httpx
    can't re-resolve the name to something else between check and connect.
    The Host header and TLS SNI/certificate check still use the original
    hostname. Raises ValueError when the URL is not allowed (including an
    unresolvable host — fail closed at dispatch).
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("invalid webhook URL")
    host = parts.hostname
    try:
        addrs = _resolve(host)
    except OSError as exc:
        raise ValueError(f"cannot resolve {host}") from exc
    if any(_is_blocked_ip(a) for a in addrs):
        raise ValueError(f"{host} resolves to a non-public address")
    ip = addrs[0]
    netloc = f"[{ip}]" if ip.version == 6 else str(ip)
    if parts.port:
        netloc += f":{parts.port}"
    pinned = urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    host_header = host if ":" not in host else f"[{host}]"
    if parts.port:
        host_header += f":{parts.port}"
    extensions = {"sni_hostname": host} if parts.scheme == "https" else {}
    return pinned, {"Host": host_header}, extensions


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


def _payload(event: str, page: dict, actor: dict | None, changes: dict) -> dict:
    return {
        "event": event,
        "page": {
            "id": page.get("id"),
            "slug": page.get("slug"),
            "title": page.get("title"),
            "version": page.get("version"),
            "updated_at": str(page.get("updated_at")) if page.get("updated_at") else None,
        },
        # None for system-originated events (e.g. a review falling due).
        "actor": {"id": actor.get("id"), "username": actor.get("username")} if actor else None,
        "changes": changes,
    }


async def _insert_notifications(
    db, user_ids: list[int], event: str, page: dict, actor_id: int | None
) -> None:
    if not user_ids:
        return
    metadata = json.dumps({"event": event, "title": page.get("title"), "slug": page.get("slug")})
    async with write_transaction(db):
        for uid in user_ids:
            await db.execute(
                """INSERT INTO notifications (user_id, event, page_id, actor_id, metadata)
                   VALUES (?, ?, ?, ?, ?)""",
                (uid, event, page.get("id"), actor_id, metadata),
            )


async def _fire_webhooks(db, event: str, payload: dict) -> None:
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


async def _dispatch(db, event: str, page: dict, actor: dict, changes: dict) -> None:
    # In-app notification for watchers (excluding the actor), then webhooks.
    # Lazy import: services.mention imports this module's siblings and the
    # ACL layer; keeping it local avoids an import cycle at startup.
    from app.services.mention import filter_readable_users

    watchers = await db.execute_fetchall(
        """SELECT w.user_id FROM page_watchers w
           WHERE w.page_id = ? AND w.user_id != ?""",
        (page.get("id"), actor.get("id")),
    )
    # A watch subscription outlives an ACL change: someone who watched the
    # page while it was open must not keep receiving its title once it has
    # been restricted away from them.
    recipients = await filter_readable_users(
        db, {w["user_id"] for w in watchers}, page.get("id")
    )
    await _insert_notifications(db, sorted(recipients), event, page, actor.get("id"))
    await _fire_webhooks(db, event, _payload(event, page, actor, changes))


async def notify_review_due(db, page: dict, recipient_ids: list[int], changes: dict) -> None:
    """Remind the page's owner that its periodic review is due.

    System-originated, so there is no actor. Never raises: the caller is a
    background loop that must keep going for the remaining pages.
    """
    event = "page.review_due"
    try:
        await _insert_notifications(db, recipient_ids, event, page, None)
        await _fire_webhooks(db, event, _payload(event, page, None, changes))
    except Exception as exc:  # pragma: no cover — guardrail
        logger.warning("notify_review_due failed: %s", exc)


async def _post_many(urls: list[str], payload: dict) -> None:
    # follow_redirects=False so a stored hook whose host later issues a 302
    # to an internal address can't escape the validation we did at store time.
    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
        await asyncio.gather(
            *(_post_one(client, url, payload) for url in urls),
            return_exceptions=True,
        )


async def _post_one(client: httpx.AsyncClient, url: str, payload: dict) -> None:
    # Re-validate at dispatch (DNS may have changed since the hook was
    # stored) and connect to the exact IP that passed the check.
    try:
        pinned, headers, extensions = _pin_to_public_ip(url)
    except ValueError as exc:
        logger.warning("webhook %s rejected at dispatch: %s", url, exc)
        return
    try:
        await client.post(pinned, json=payload, headers=headers, extensions=extensions)
    except Exception as exc:
        logger.info("webhook dispatch to %s failed: %s", url, exc)
