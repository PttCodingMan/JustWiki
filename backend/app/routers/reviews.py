"""Periodic page review: configure owner/interval, verify, list what's due.

See services/page_review.py for the model. Anyone who can edit a page can
configure or verify its review — the same people who could fix it.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import require_real_user
from app.database import get_db, write_transaction
from app.routers.activity import log_activity
from app.services.acl import (
    PageAccess,
    build_id_clause,
    list_readable_page_ids,
    page_dep,
    resolve_page_permission,
)
from app.services.page_review import (
    MAX_INTERVAL_DAYS,
    MIN_INTERVAL_DAYS,
    REVIEW_COLUMNS,
    REVIEW_JOINS,
    get_page_review,
    serialize_review,
)

router = APIRouter(tags=["reviews"])


class ReviewSettings(BaseModel):
    owner_id: int | None = None
    interval_days: int = Field(ge=MIN_INTERVAL_DAYS, le=MAX_INTERVAL_DAYS)


async def _validate_owner(db, owner_id: int, page_id: int) -> None:
    rows = await db.execute_fetchall(
        "SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1",
        (owner_id,),
    )
    # Same message for "no such user" and "can't read the page" so the
    # endpoint can't be used to probe ACLs of other users.
    if not rows or await resolve_page_permission(db, dict(rows[0]), page_id) == "none":
        raise HTTPException(
            status_code=400, detail="Owner must be an active user who can read this page"
        )


@router.put("/api/pages/{slug}/review")
async def set_review(body: ReviewSettings, ctx: PageAccess = Depends(page_dep("write"))):
    db = await get_db()
    page = ctx.page
    if body.owner_id is not None:
        await _validate_owner(db, body.owner_id, page["id"])

    async with write_transaction(db):
        # New row: the clock starts now and counts as a verification by the
        # person who turned review on. Existing row: keep reviewed_at, but
        # clear notified_at so a changed interval gets its own reminder.
        await db.execute(
            """INSERT INTO page_reviews (page_id, owner_id, interval_days, reviewed_by)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(page_id) DO UPDATE SET
                   owner_id = excluded.owner_id,
                   interval_days = excluded.interval_days,
                   notified_at = NULL""",
            (page["id"], body.owner_id, body.interval_days, ctx.user["id"]),
        )
    return await get_page_review(db, page["id"])


@router.delete("/api/pages/{slug}/review")
async def clear_review(ctx: PageAccess = Depends(page_dep("write"))):
    db = await get_db()
    async with write_transaction(db):
        await db.execute("DELETE FROM page_reviews WHERE page_id = ?", (ctx.page["id"],))
    return {"ok": True}


@router.post("/api/pages/{slug}/review/verify")
async def verify_page(ctx: PageAccess = Depends(page_dep("write"))):
    db = await get_db()
    page = ctx.page
    async with write_transaction(db):
        cursor = await db.execute(
            """UPDATE page_reviews
               SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, notified_at = NULL
               WHERE page_id = ?""",
            (ctx.user["id"], page["id"]),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=400, detail="Review is not enabled for this page")
        await log_activity(
            db, ctx.user["id"], "verified", "page", page["id"],
            {"title": page["title"], "slug": page["slug"]},
        )
    return await get_page_review(db, page["id"])


@router.get("/api/reviews")
async def list_reviews(
    scope: Literal["all", "mine"] = Query("all"),
    user=Depends(require_real_user),
):
    """Pages with review enabled that the caller can read, most urgent first."""
    db = await get_db()
    readable = await list_readable_page_ids(db, user)
    clause, params = build_id_clause(readable, "r.page_id")
    sql = f"""SELECT p.slug, p.title, {REVIEW_COLUMNS}
              FROM page_reviews r
              JOIN pages p ON p.id = r.page_id
              {REVIEW_JOINS}
              WHERE p.deleted_at IS NULL AND {clause}"""
    if scope == "mine":
        sql += " AND r.owner_id = ?"
        params.append(user["id"])
    sql += " ORDER BY datetime(r.reviewed_at, '+' || r.interval_days || ' days') ASC"
    rows = await db.execute_fetchall(sql, params)
    return {
        "items": [
            {"slug": r["slug"], "title": r["title"], **serialize_review(r)} for r in rows
        ]
    }
