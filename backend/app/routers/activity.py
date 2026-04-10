import json
from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/activity", tags=["activity"])


async def log_activity(db, user_id: int, action: str, target_type: str, target_id: int, metadata: dict | None = None):
    """Write an activity log entry. Call this from other routers."""
    meta_json = json.dumps(metadata, ensure_ascii=False) if metadata else None
    await db.execute(
        """INSERT INTO activity_log (user_id, action, target_type, target_id, metadata)
           VALUES (?, ?, ?, ?, ?)""",
        (user_id, action, target_type, target_id, meta_json),
    )


@router.get("")
async def list_activity(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    db = await get_db()
    offset = (page - 1) * per_page

    count_rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM activity_log")
    total = count_rows[0]["cnt"]

    rows = await db.execute_fetchall(
        """SELECT a.id, a.user_id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
                  u.username
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT ? OFFSET ?""",
        (per_page, offset),
    )

    results = []
    for r in rows:
        row = dict(r)
        if row["metadata"]:
            row["metadata"] = json.loads(row["metadata"])
        results.append(row)

    return {"activities": results, "total": total, "page": page, "per_page": per_page}


@router.get("/stats")
async def activity_stats(user=Depends(get_current_user)):
    db = await get_db()

    # Top viewed pages
    top_viewed = await db.execute_fetchall(
        """SELECT id, slug, title, view_count FROM pages
           ORDER BY view_count DESC LIMIT 10"""
    )

    # Recently updated pages
    recently_updated = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.title, p.updated_at
           FROM pages p
           ORDER BY p.updated_at DESC LIMIT 10"""
    )

    # Orphan pages (no backlinks pointing to them, not linked from anywhere)
    orphan_pages = await db.execute_fetchall(
        """SELECT p.id, p.slug, p.title, p.view_count
           FROM pages p
           WHERE p.id NOT IN (SELECT target_page_id FROM backlinks)
             AND p.parent_id IS NULL
           ORDER BY p.updated_at DESC LIMIT 20"""
    )

    # Total counts
    total_pages_row = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM pages")
    total_users_row = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM users")

    return {
        "top_viewed": [dict(r) for r in top_viewed],
        "recently_updated": [dict(r) for r in recently_updated],
        "orphan_pages": [dict(r) for r in orphan_pages],
        "total_pages": total_pages_row[0]["cnt"],
        "total_users": total_users_row[0]["cnt"],
    }
