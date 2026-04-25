"""Page + media ACL resolution.

Single source of truth for "can user X do Y to page/media Z". Routers must
call these helpers instead of doing their own role/creator checks.

Resolution model (see /docs or the original plan for the full rationale):

- `admin` role bypasses all ACL checks.
- Per-page ACL rows live in `page_acl`, keyed by `(page_id, principal_type,
  principal_id)` where principal is either a user or a group.
- To resolve a user's permission on a page, walk from the page up through
  `parent_id` and find the shallowest ancestor (the "anchor") that has any
  ACL row. At that anchor, collect every row matching the user (direct user
  row OR a group the user belongs to) and pick the most permissive
  (`write` > `read`). If no row matches, return `none`.
- If no anchor exists anywhere in the chain, the page is open by default:
  editors get `write`, viewers get `read`.
- `viewer` role is capped at `read` even when an ACL row would grant write.
- Media permission = union of its referencing live pages. Orphan media
  (no live references) is accessible to its uploader and admins only.
"""

import time

from fastapi import HTTPException

# SQLite recursive-CTE safety cap: the parent chain should never be this
# deep in real wikis, but the cap prevents a corrupted cyclic chain from
# locking the DB. Writes are already cycle-checked in pages.py.
_MAX_CHAIN_DEPTH = 50

# ── In-memory TTL cache for list_readable_page_ids ──────────────────
# Key: user_id → (monotonic_timestamp, frozenset[int])
# Cleared by invalidate_readable_cache() on ACL / group-membership writes.
_readable_cache: dict[int, tuple[float, frozenset[int]]] = {}
_READABLE_CACHE_TTL = 30  # seconds


def invalidate_readable_cache(user_id: int | None = None):
    """Drop cached readable-page sets.

    Call with ``user_id`` when only one user's view may have changed (e.g.
    a group-membership edit), or with ``None`` to flush the whole cache
    (e.g. after a page_acl write that could affect multiple users).
    """
    if user_id is None:
        _readable_cache.clear()
    else:
        _readable_cache.pop(user_id, None)


async def _user_group_ids(db, user_id: int) -> list[int]:
    # The synthetic anonymous user (id=0) is never in any group; skip the
    # round-trip and return early so list/tree/search calls stay cheap.
    if user_id == 0:
        return []
    rows = await db.execute_fetchall(
        "SELECT group_id FROM group_members WHERE user_id = ?", (user_id,)
    )
    return [r["group_id"] for r in rows]


def _cap_for_role(role: str, permission: str) -> str:
    if role == "viewer" and permission == "write":
        return "read"
    return permission


async def resolve_page_permission(db, user: dict, page_id: int) -> str:
    """Return one of `'admin' | 'write' | 'read' | 'none'`."""
    role = user.get("role") or "editor"
    if role == "admin":
        return "admin"

    group_ids = await _user_group_ids(db, user["id"])

    rows = await db.execute_fetchall(
        f"""WITH RECURSIVE chain(id, parent_id, depth) AS (
               SELECT id, parent_id, 0 FROM pages WHERE id = ?
               UNION ALL
               SELECT p.id, p.parent_id, c.depth + 1
               FROM pages p JOIN chain c ON p.id = c.parent_id
               WHERE c.parent_id IS NOT NULL AND c.depth < {_MAX_CHAIN_DEPTH}
             )
             SELECT c.depth, a.principal_type, a.principal_id, a.permission
             FROM chain c
             JOIN page_acl a ON a.page_id = c.id
             ORDER BY c.depth ASC""",
        (page_id,),
    )

    if not rows:
        # No anchor anywhere in chain → open default.
        return _cap_for_role(role, "write")

    anchor_depth = rows[0]["depth"]
    best = None  # None | 'read' | 'write'
    for r in rows:
        if r["depth"] != anchor_depth:
            break  # rows are ordered by depth ASC; done with anchor
        matches = (
            (r["principal_type"] == "user" and r["principal_id"] == user["id"])
            or (r["principal_type"] == "group" and r["principal_id"] in group_ids)
        )
        if not matches:
            continue
        if r["permission"] == "write":
            best = "write"
            break  # most permissive already found
        if r["permission"] == "read" and best != "write":
            best = "read"

    if best is None:
        return "none"
    return _cap_for_role(role, best)


async def list_readable_page_ids(db, user: dict) -> set[int]:
    """Return the set of live page IDs the user can read.

    Used by list/tree/graph/search/export/etc. to filter result sets
    efficiently in SQL rather than per-row Python loops.

    Results are cached per-user for ``_READABLE_CACHE_TTL`` seconds to
    avoid re-running the recursive CTE on every sidebar / search request.
    """
    role = user.get("role") or "editor"

    if role == "admin":
        all_rows = await db.execute_fetchall(
            "SELECT id FROM pages WHERE deleted_at IS NULL"
        )
        return {r["id"] for r in all_rows}

    user_id = user["id"]
    now = time.monotonic()
    cached = _readable_cache.get(user_id)
    if cached and now - cached[0] < _READABLE_CACHE_TTL:
        return cached[1]

    group_ids = await _user_group_ids(db, user["id"])

    if group_ids:
        group_placeholders = ",".join("?" * len(group_ids))
        group_clause = (
            f"(pa.principal_type = 'group' AND pa.principal_id IN ({group_placeholders}))"
        )
        group_params = list(group_ids)
    else:
        # No groups → make the clause never match.
        group_clause = "0"
        group_params = []

    sql = f"""
    WITH RECURSIVE
      chain(page_id, ancestor_id, depth) AS (
        SELECT id, id, 0 FROM pages WHERE deleted_at IS NULL
        UNION ALL
        SELECT c.page_id, p.parent_id, c.depth + 1
        FROM chain c
        JOIN pages p ON p.id = c.ancestor_id
        WHERE p.parent_id IS NOT NULL AND c.depth < {_MAX_CHAIN_DEPTH}
      ),
      acl_depths AS (
        SELECT c.page_id, MIN(c.depth) AS anchor_depth
        FROM chain c
        WHERE EXISTS (SELECT 1 FROM page_acl WHERE page_id = c.ancestor_id)
        GROUP BY c.page_id
      )
    SELECT DISTINCT p.id AS id
    FROM pages p
    WHERE p.deleted_at IS NULL
      AND (
        NOT EXISTS (SELECT 1 FROM acl_depths ad WHERE ad.page_id = p.id)
        OR EXISTS (
          SELECT 1
          FROM chain c2
          JOIN acl_depths ad2
            ON ad2.page_id = c2.page_id AND ad2.anchor_depth = c2.depth
          JOIN page_acl pa ON pa.page_id = c2.ancestor_id
          WHERE c2.page_id = p.id
            AND (
              (pa.principal_type = 'user' AND pa.principal_id = ?)
              OR {group_clause}
            )
        )
      )
    """
    params = [user["id"]] + group_params
    rows = await db.execute_fetchall(sql, params)
    result = frozenset(r["id"] for r in rows)
    _readable_cache[user_id] = (now, result)
    return result


async def require_page_read(db, user: dict, page_id: int) -> str:
    """Raise 404 if `user` cannot read `page_id`, else return the permission.

    Collapsing denied and not-found into the same 404 keeps the app's
    standard policy: a user with no read access must not be able to prove
    a page exists. Shared helper so routers don't reinvent the same 5 lines.
    """
    perm = await resolve_page_permission(db, user, page_id)
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    return perm


async def require_page_write(db, user: dict, page_id: int) -> str:
    """Raise 403/404 if the user cannot write to this page."""
    perm = await resolve_page_permission(db, user, page_id)
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if perm == "read":
        raise HTTPException(
            status_code=403, detail="You do not have write permission on this page"
        )
    return perm


async def can_read_media(db, user: dict, media_id: int) -> bool:
    """True if the user can read the given media file.

    Admins always can. Otherwise: if any live referencing page is readable,
    the media is. Orphan media (no live references) is accessible only to
    its uploader (admins fall through the admin short-circuit above).
    """
    if (user.get("role") or "editor") == "admin":
        return True

    ref_rows = await db.execute_fetchall(
        """SELECT mr.page_id
           FROM media_references mr
           JOIN pages p ON p.id = mr.page_id
           WHERE mr.media_id = ? AND p.deleted_at IS NULL""",
        (media_id,),
    )

    if not ref_rows:
        # Orphan — uploader only. Short-circuit the synthetic guest so a
        # future media row with `uploaded_by=0` (which shouldn't exist, but
        # defensive) can't accidentally return True for every guest.
        if user.get("anonymous") or user.get("id") == 0:
            return False
        media = await db.execute_fetchall(
            "SELECT uploaded_by FROM media WHERE id = ?", (media_id,)
        )
        if not media:
            return False
        return media[0]["uploaded_by"] == user["id"]

    # Use the cached readable-set instead of N individual resolve calls.
    readable = await list_readable_page_ids(db, user)
    return any(r["page_id"] in readable for r in ref_rows)
