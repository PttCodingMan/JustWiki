import json
from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import get_db
from app.services.acl import list_readable_page_ids

router = APIRouter(prefix="/api/activity", tags=["activity"])


async def log_activity(db, user_id: int, action: str, target_type: str, target_id: int, metadata: dict | None = None):
    """Write an activity log entry. Call this from other routers."""
    meta_json = json.dumps(metadata, ensure_ascii=False) if metadata else None
    await db.execute(
        """INSERT INTO activity_log (user_id, action, target_type, target_id, metadata)
           VALUES (?, ?, ?, ?, ?)""",
        (user_id, action, target_type, target_id, meta_json),
    )


def _readable_clause(readable: frozenset[int] | set[int]) -> tuple[str, list]:
    """SQL fragment + params for "target_type='page' AND target_id ∈ readable".

    Non-page rows (e.g. comment activity) are kept as-is — currently every
    write that calls log_activity uses target_type='page', so the filter is
    effectively a whitelist; if non-page targets are added later, they'll
    pass through and may need their own ACL gate.
    """
    if not readable:
        # No readable pages → drop every page-targeted row.
        return "(a.target_type != 'page')", []
    placeholders = ",".join("?" * len(readable))
    return (
        f"(a.target_type != 'page' OR a.target_id IN ({placeholders}))",
        list(readable),
    )


@router.get("")
async def list_activity(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    db = await get_db()
    offset = (page - 1) * per_page

    # Filter activity to entries about pages the caller can read; otherwise
    # the feed leaks titles/slugs of restricted pages via the metadata blob.
    # Admin is short-circuited inside list_readable_page_ids.
    readable = await list_readable_page_ids(db, user)
    where_sql, where_params = _readable_clause(readable)

    count_rows = await db.execute_fetchall(
        f"SELECT COUNT(*) as cnt FROM activity_log a WHERE {where_sql}",
        where_params,
    )
    total = count_rows[0]["cnt"]

    rows = await db.execute_fetchall(
        f"""SELECT a.id, a.user_id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
                   u.username, u.display_name
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE {where_sql}
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT ? OFFSET ?""",
        where_params + [per_page, offset],
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

    # Filter every page-derived list by the caller's readable set so guests
    # (and any role that can't read everything) don't see restricted titles
    # in top_viewed / recently_updated / orphan_pages.
    readable = await list_readable_page_ids(db, user)

    if not readable:
        # No readable pages → all page-keyed lists are empty. Still return
        # the shape so the dashboard renders without null-checks.
        return {
            "top_viewed": [],
            "recently_updated": [],
            "orphan_pages": [],
            "total_pages": 0,
            # Suppress global user count for callers without read access to
            # any page — they have no business enumerating the user roster.
            "total_users": 0,
        }

    placeholders = ",".join("?" * len(readable))
    readable_params = list(readable)

    top_viewed = await db.execute_fetchall(
        f"""SELECT id, slug, title, view_count FROM pages
           WHERE id IN ({placeholders})
           ORDER BY view_count DESC LIMIT 10""",
        readable_params,
    )

    recently_updated = await db.execute_fetchall(
        f"""SELECT p.id, p.slug, p.title, p.updated_at
           FROM pages p
           WHERE p.id IN ({placeholders})
           ORDER BY p.updated_at DESC LIMIT 10""",
        readable_params,
    )

    orphan_pages = await db.execute_fetchall(
        f"""SELECT p.id, p.slug, p.title, p.view_count
           FROM pages p
           WHERE p.id IN ({placeholders})
             AND p.id NOT IN (SELECT target_page_id FROM backlinks)
             AND p.parent_id IS NULL
           ORDER BY p.updated_at DESC LIMIT 20""",
        readable_params,
    )

    # total_pages reflects what *this user* can read, not the global count.
    # Anonymous and viewers see the open-default subset; admins see all.
    total_pages = len(readable)
    # Hide the user roster size from the synthetic guest. Real users on a
    # small-team wiki are expected to know the roster, so editors+ see it.
    if user.get("anonymous"):
        total_users = 0
    else:
        total_users_row = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM users")
        total_users = total_users_row[0]["cnt"]

    return {
        "top_viewed": [dict(r) for r in top_viewed],
        "recently_updated": [dict(r) for r in recently_updated],
        "orphan_pages": [dict(r) for r in orphan_pages],
        "total_pages": total_pages,
        "total_users": total_users,
    }
