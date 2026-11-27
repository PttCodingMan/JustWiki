"""Periodic page review: owner + interval, "verified" stamp, due reminders.

A page with review turned on has one row in ``page_reviews``. It falls due
``interval_days`` after the last verification; the owner (falling back to the
page's creator) gets one in-app notification + ``page.review_due`` webhook per
cycle, sent by `review_reminder_loop`. Verifying starts a new cycle.

Timestamps are SQLite ``CURRENT_TIMESTAMP`` strings (UTC, no zone suffix),
matching the rest of the schema.
"""
import asyncio
import logging
import math
from datetime import datetime, timedelta, timezone

from app.database import get_db, request_db_context, write_transaction
from app.services.acl import resolve_page_permission
from app.services.notifications import notify_review_due

logger = logging.getLogger("justwiki.review")

MIN_INTERVAL_DAYS = 1
MAX_INTERVAL_DAYS = 3650
# How often the background loop looks for pages that fell due.
CHECK_INTERVAL_SECONDS = 3600
# Grace period after startup so the first check doesn't compete with boot work.
INITIAL_DELAY_SECONDS = 60

_SQL_TS = "%Y-%m-%d %H:%M:%S"

# Shared by the single-page lookup and the /api/reviews listing.
REVIEW_COLUMNS = """
    r.page_id, r.owner_id, r.interval_days, r.reviewed_at, r.reviewed_by,
    ou.username AS owner_username,
    CASE WHEN ou.display_name IS NOT NULL AND ou.display_name != ''
         THEN ou.display_name ELSE ou.username END AS owner_name,
    CASE WHEN ru.display_name IS NOT NULL AND ru.display_name != ''
         THEN ru.display_name ELSE ru.username END AS reviewed_by_name
"""
REVIEW_JOINS = """
    LEFT JOIN users ou ON ou.id = r.owner_id
    LEFT JOIN users ru ON ru.id = r.reviewed_by
"""


def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.strptime(str(value)[:19], _SQL_TS)
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def review_status(reviewed_at, interval_days: int, now: datetime | None = None) -> dict:
    """Compute due date and status for a review row.

    ``days_left`` is whole days until due (negative once overdue), so the
    frontend never has to parse zone-less SQLite timestamps. "due_soon" kicks
    in a quarter of the interval before the due date, capped at 7 days, so a
    weekly review isn't permanently "due soon".
    """
    now = now or datetime.now(timezone.utc)
    due = _parse_ts(reviewed_at) + timedelta(days=interval_days)
    remaining = due - now
    if remaining <= timedelta(0):
        status = "overdue"
    elif remaining <= timedelta(days=max(1, min(7, interval_days // 4))):
        status = "due_soon"
    else:
        status = "ok"
    # Whole days, read the way people say it: a fresh 30-day review is "due in
    # 30 days" (round up), 10 days and an hour late is "overdue by 10 days"
    # (round down), and anything overdue is at least 1 day.
    seconds = remaining.total_seconds()
    if seconds > 0:
        days_left = math.ceil(seconds / 86400)
    else:
        days_left = -max(1, math.floor(-seconds / 86400))
    return {
        "due_at": due.strftime(_SQL_TS),
        "days_left": days_left,
        "status": status,
    }


def serialize_review(row) -> dict:
    r = dict(row)
    return {
        "owner_id": r["owner_id"],
        "owner_username": r.get("owner_username"),
        "owner_name": r.get("owner_name"),
        "interval_days": r["interval_days"],
        "reviewed_at": str(r["reviewed_at"]),
        "reviewed_by": r.get("reviewed_by"),
        "reviewed_by_name": r.get("reviewed_by_name"),
        **review_status(r["reviewed_at"], r["interval_days"]),
    }


async def get_page_review(db, page_id: int) -> dict | None:
    rows = await db.execute_fetchall(
        f"SELECT {REVIEW_COLUMNS} FROM page_reviews r {REVIEW_JOINS} WHERE r.page_id = ?",
        (page_id,),
    )
    return serialize_review(rows[0]) if rows else None


async def _usable_recipient(db, user_id: int | None, page_id: int) -> int | None:
    """Return user_id if that account is live and can still read the page."""
    if user_id is None:
        return None
    rows = await db.execute_fetchall(
        "SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1",
        (user_id,),
    )
    if not rows:
        return None
    if await resolve_page_permission(db, dict(rows[0]), page_id) == "none":
        return None
    return user_id


async def send_due_reminders(db) -> int:
    """Notify owners of every page whose review fell due and hasn't been
    announced yet this cycle. Returns how many reminders were sent.
    """
    due = "datetime({0}reviewed_at, '+' || {0}interval_days || ' days') <= datetime('now')"
    rows = await db.execute_fetchall(
        f"""SELECT r.page_id, r.owner_id, r.interval_days, r.reviewed_at,
                  p.slug, p.title, p.version, p.updated_at, p.created_by
           FROM page_reviews r
           JOIN pages p ON p.id = r.page_id
           WHERE p.deleted_at IS NULL AND r.notified_at IS NULL AND {due.format("r.")}"""
    )
    sent = 0
    for row in rows:
        page = {
            "id": row["page_id"],
            "slug": row["slug"],
            "title": row["title"],
            "version": row["version"],
            "updated_at": row["updated_at"],
        }
        # Claim the reminder first, atomically, re-checking it's still due:
        # if the notification write fails we'd rather miss one reminder than
        # spam the owner every hour; a second process running this loop
        # can't send it again; and a verify that landed after the SELECT
        # isn't marked as already reminded.
        async with write_transaction(db):
            cursor = await db.execute(
                f"""UPDATE page_reviews SET notified_at = CURRENT_TIMESTAMP
                    WHERE page_id = ? AND notified_at IS NULL AND {due.format("")}""",
                (row["page_id"],),
            )
        if cursor.rowcount != 1:
            continue
        recipient = await _usable_recipient(db, row["owner_id"], row["page_id"])
        if recipient is None:
            recipient = await _usable_recipient(db, row["created_by"], row["page_id"])
        status = review_status(row["reviewed_at"], row["interval_days"])
        await notify_review_due(
            db,
            page,
            [recipient] if recipient is not None else [],
            {"due_at": status["due_at"], "interval_days": row["interval_days"]},
        )
        sent += 1
    return sent


async def review_reminder_loop() -> None:
    """Background task started from the app lifespan."""
    await asyncio.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            async with request_db_context():
                count = await send_due_reminders(await get_db())
                if count:
                    logger.info("Sent review reminders for %d page(s)", count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Review reminder check failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
