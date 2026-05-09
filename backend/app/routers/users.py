import json
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user, require_admin, require_real_user, hash_password_async
from app.database import get_db, write_transaction
from app.services.acl import build_id_clause, list_readable_page_ids, resolve_page_permission

router = APIRouter(prefix="/api/users", tags=["users"])

# Reserved prefix applied to a soft-deleted user's `username` so the original
# name is immediately free for reuse while the row stays put to preserve FK
# references (pages.created_by, page_versions.edited_by, comments.user_id, ...).
TOMBSTONE_PREFIX = "__deleted_"

# Invited-but-not-yet-logged-in users have this sentinel hash so bcrypt can't
# match any password. Same convention used by SSO-only accounts.
DISABLED_PASSWORD_HASH = "!"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME_CLEAN = re.compile(r"[^a-zA-Z0-9._-]")


def _is_reserved(name: str) -> bool:
    return name.startswith(TOMBSTONE_PREFIX)


def _derive_username_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    cleaned = _USERNAME_CLEAN.sub("-", local).strip("-")
    return cleaned or "user"


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "editor"


class UserInvite(BaseModel):
    email: str
    display_name: Optional[str] = None
    username: Optional[str] = None   # defaults to email local-part, de-duped
    role: str = "editor"


class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class UserRestore(BaseModel):
    username: Optional[str] = None


@router.get("/mentionable")
async def mentionable_targets(
    page_slug: str = Query(..., description="Slug of the page being edited or commented on"),
    q: str = Query("", description="Substring match on username/display_name/group name"),
    limit: int = Query(10, ge=1, le=20),
    user=Depends(require_real_user),
):
    """Autocomplete candidates for @mention / @@group on a specific page.

    Users are ACL-filtered against ``page_slug`` so we never offer to
    mention someone who can't read the page. Groups are returned without
    membership ACL filtering — the autocomplete is a hint and the
    notification fan-out (`services/mention.py`) re-runs the same ACL
    check per resolved user, so the worst case is a useless suggestion,
    not a leak.
    """
    db = await get_db()
    page_rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ? AND deleted_at IS NULL", (page_slug,)
    )
    if not page_rows:
        raise HTTPException(status_code=404, detail="Page not found")
    page_id = page_rows[0]["id"]

    # The caller must themselves be able to read the page they're editing.
    # Otherwise this endpoint becomes a way to enumerate users-by-page.
    caller_perm = await resolve_page_permission(db, user, page_id)
    if caller_perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")

    pattern = f"%{q}%"
    # Pull a wider candidate set so the per-row ACL check has room to drop
    # users without leaving the result short of `limit`.
    candidate_rows = await db.execute_fetchall(
        """SELECT id, username, display_name, role
           FROM users
           WHERE deleted_at IS NULL
             AND (username LIKE ? OR display_name LIKE ?)
           ORDER BY username
           LIMIT ?""",
        (pattern, pattern, limit * 5),
    )

    users_out: list[dict] = []
    for row in candidate_rows:
        if len(users_out) >= limit:
            break
        candidate = dict(row)
        perm = await resolve_page_permission(db, candidate, page_id)
        if perm == "none":
            continue
        users_out.append({
            "username": candidate["username"],
            "display_name": candidate["display_name"] or "",
        })

    group_rows = await db.execute_fetchall(
        """SELECT g.name, g.description,
                  (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
           FROM groups g
           WHERE g.name LIKE ?
           ORDER BY g.name
           LIMIT ?""",
        (pattern, limit),
    )
    groups_out = [
        {
            "name": r["name"],
            "description": r["description"] or "",
            "member_count": r["member_count"],
        }
        for r in group_rows
    ]

    return {"users": users_out, "groups": groups_out}


# Activity actions surfaced on a user's public profile. Other actions
# (deleted, granted, revoked, token_*, group_*) are admin/audit-flavored
# and would either leak history or just be noise on a "what has this
# person been working on" timeline.
_PROFILE_ACTIONS = ("created", "updated", "commented")
_PROFILE_ACTIVITY_LIMIT = 30


@router.get("/{username}/profile")
async def user_profile(username: str, user=Depends(require_real_user)):
    """Public-ish profile of a single user — identity card + recent activity.

    `require_real_user` keeps anonymous visitors out even when
    ``ANONYMOUS_READ`` is on (a guest enumerating profiles would also be
    enumerating the user roster). Soft-deleted users 404 — matches how
    `/api/users` and the mention autocomplete already pretend they don't
    exist.

    Activity is filtered by the **caller's** readable-page set, not the
    profiled user's; otherwise the timeline would leak titles/slugs of
    pages the viewer can't access. Activity rows whose page has since
    been soft-deleted are dropped via the ``pages`` join.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT id, username, display_name, role, bio, created_at
           FROM users
           WHERE username = ? AND deleted_at IS NULL""",
        (username,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    profiled = dict(rows[0])

    readable = await list_readable_page_ids(db, user)
    if not readable:
        recent_activity: list[dict] = []
    else:
        action_placeholders = ",".join("?" for _ in _PROFILE_ACTIONS)
        id_clause, id_params = build_id_clause(readable, column="a.target_id")
        activity_rows = await db.execute_fetchall(
            f"""SELECT a.id, a.action, a.target_id, a.metadata, a.created_at,
                       p.slug AS page_slug, p.title AS page_title
                  FROM activity_log a
                  JOIN pages p ON p.id = a.target_id
                 WHERE a.user_id = ?
                   AND a.target_type = 'page'
                   AND a.action IN ({action_placeholders})
                   AND p.deleted_at IS NULL
                   AND {id_clause}
                 ORDER BY a.created_at DESC, a.id DESC
                 LIMIT ?""",
            [profiled["id"], *_PROFILE_ACTIONS, *id_params, _PROFILE_ACTIVITY_LIMIT],
        )
        recent_activity = []
        for r in activity_rows:
            entry = {
                "id": r["id"],
                "action": r["action"],
                "page_slug": r["page_slug"],
                "page_title": r["page_title"],
                "created_at": r["created_at"],
            }
            # Surface comment_id so the frontend can deep-link from a
            # 'commented' row to the specific comment thread.
            if r["action"] == "commented" and r["metadata"]:
                try:
                    meta = json.loads(r["metadata"])
                    if "comment_id" in meta:
                        entry["comment_id"] = meta["comment_id"]
                except (ValueError, TypeError):
                    pass
            recent_activity.append(entry)

    return {
        "username": profiled["username"],
        "display_name": profiled["display_name"] or "",
        "role": profiled["role"],
        "bio": profiled["bio"] or "",
        "created_at": profiled["created_at"],
        "recent_activity": recent_activity,
    }


@router.get("/search")
async def search_users(
    q: str = Query("", description="Substring match on username or display_name"),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(require_real_user),
):
    """Username lookup for the AclManager picker.

    Returns a minimal shape (id, username, display_name) to keep the
    response small. Available to any authenticated user since the
    alternative is no UI for managing ACLs at all; this does allow
    username enumeration by authenticated users, which is an accepted
    trade-off for a small-team wiki — but **not** by anonymous visitors,
    so this endpoint blocks the synthetic guest even when ANONYMOUS_READ
    is on.
    """
    db = await get_db()
    pattern = f"%{q}%"
    rows = await db.execute_fetchall(
        """SELECT id, username, display_name, role
           FROM users
           WHERE deleted_at IS NULL AND (username LIKE ? OR display_name LIKE ?)
           ORDER BY username
           LIMIT ?""",
        (pattern, pattern, limit),
    )
    return [dict(r) for r in rows]


@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    include_deleted: bool = Query(False, description="Include soft-deleted users"),
    user=Depends(require_admin),
):
    db = await get_db()
    offset = (page - 1) * per_page
    where = "" if include_deleted else "WHERE deleted_at IS NULL"
    count_rows = await db.execute_fetchall(f"SELECT COUNT(*) as cnt FROM users {where}")
    total = count_rows[0]["cnt"]
    rows = await db.execute_fetchall(
        f"""SELECT id, username, original_username, role, deleted_at, created_at
            FROM users {where}
            ORDER BY id LIMIT ? OFFSET ?""",
        (per_page, offset),
    )
    return {
        "users": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/deleted")
async def list_deleted_users(user=Depends(require_admin)):
    """Trash list: soft-deleted users with their original username preserved."""
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT id, original_username, display_name, email, role, deleted_at, created_at
           FROM users
           WHERE deleted_at IS NOT NULL
           ORDER BY deleted_at DESC"""
    )
    return [dict(r) for r in rows]


ALLOWED_ROLES = ("admin", "editor", "viewer")


@router.post("", status_code=201)
async def create_user(body: UserCreate, user=Depends(require_admin)):
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Role must be admin, editor, or viewer")
    if _is_reserved(body.username):
        raise HTTPException(status_code=400, detail="Username prefix is reserved")
    db = await get_db()
    # Deleted users have tombstone usernames so they won't match here; the
    # uniqueness check naturally only considers the active namespace.
    existing = await db.execute_fetchall(
        "SELECT id FROM users WHERE username = ?", (body.username,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    pw_hash = await hash_password_async(body.password)
    async with write_transaction(db):
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (body.username, pw_hash, body.role),
        )
    row = await db.execute_fetchall(
        "SELECT id, username, role, created_at FROM users WHERE id = ?",
        (cursor.lastrowid,),
    )
    return dict(row[0])


@router.post("/invite", status_code=201)
async def invite_user(body: UserInvite, user=Depends(require_admin)):
    """Pre-provision a user account for SSO-only login.

    The row is created with a disabled password hash ('!') — the invitee can
    then sign in via OIDC and will be matched to this shell by email. Safe
    under invitation-only mode (OIDC_ALLOW_SIGNUP=false) where only pre-
    provisioned users can reach the app.
    """
    email = (body.email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="A valid email is required")
    if body.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Role must be admin, editor, or viewer")

    candidate = (body.username or "").strip() or _derive_username_from_email(email)
    if _is_reserved(candidate):
        raise HTTPException(status_code=400, detail="Username prefix is reserved")

    db = await get_db()

    # Don't silently clobber an existing account with the same email.
    existing_email = await db.execute_fetchall(
        "SELECT id FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL",
        (email,),
    )
    if existing_email:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    # If admin-chosen username collides, suffix until unique; if they passed
    # an explicit username and it collides, reject rather than silently renaming.
    username = candidate
    if body.username:
        clash = await db.execute_fetchall(
            "SELECT id FROM users WHERE username = ?", (username,)
        )
        if clash:
            raise HTTPException(status_code=409, detail="Username already exists")
    else:
        for suffix in [""] + [f"-{i}" for i in range(2, 100)]:
            cand = f"{candidate}{suffix}"
            clash = await db.execute_fetchall(
                "SELECT id FROM users WHERE username = ?", (cand,)
            )
            if not clash:
                username = cand
                break
        else:
            raise HTTPException(status_code=500, detail="Could not find an available username")

    display_name = (body.display_name or "").strip()
    async with write_transaction(db):
        cursor = await db.execute(
            """INSERT INTO users (username, password_hash, role, display_name, email)
               VALUES (?, ?, ?, ?, ?)""",
            (username, DISABLED_PASSWORD_HASH, body.role, display_name, email),
        )
    row = await db.execute_fetchall(
        """SELECT id, username, role, display_name, email, created_at
           FROM users WHERE id = ?""",
        (cursor.lastrowid,),
    )
    return dict(row[0])


@router.put("/{user_id}")
async def update_user(user_id: int, body: UserUpdate, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, role FROM users WHERE id = ? AND deleted_at IS NULL",
        (user_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    updates = []
    values = []
    if body.role is not None:
        if body.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail="Role must be admin, editor, or viewer")
        # Prevent last admin from demoting themselves
        if user_id == user["id"] and body.role != "admin":
            admin_count = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND deleted_at IS NULL"
            )
            if admin_count[0]["cnt"] <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot demote the last admin",
                )
        updates.append("role = ?")
        values.append(body.role)
    if body.password is not None:
        updates.append("password_hash = ?")
        values.append(await hash_password_async(body.password))

    if updates:
        values.append(user_id)
        async with write_transaction(db):
            await db.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values
            )

    row = await db.execute_fetchall(
        "SELECT id, username, role, created_at FROM users WHERE id = ?", (user_id,)
    )
    return dict(row[0])


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, user=Depends(require_admin)):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL",
        (user_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    # No "last admin" guard here: `require_admin` means the caller is an
    # admin, the self-check above ensures they differ from the target, so at
    # least two admins exist whenever this point is reached.

    # Soft-delete: keep the row (FKs still resolve) but rename `username` to a
    # tombstone that is guaranteed unique. The epoch suffix covers the
    # delete → restore → delete loop for the same user id.
    async with write_transaction(db):
        await db.execute(
            """UPDATE users
               SET deleted_at = CURRENT_TIMESTAMP,
                   original_username = username,
                   username = '__deleted_' || id || '_' || strftime('%s','now')
               WHERE id = ?""",
            (user_id,),
        )
        # Drop SSO/LDAP bindings so re-inviting the same email cleanly relinks
        # to the new user row. Leaving them behind causes the old (provider,sub)
        # to resolve to the tombstoned user forever, returning `user_disabled`.
        await db.execute(
            "DELETE FROM auth_identities WHERE user_id = ?", (user_id,),
        )


@router.post("/{user_id}/restore")
async def restore_user(user_id: int, body: UserRestore, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, original_username FROM users WHERE id = ? AND deleted_at IS NOT NULL",
        (user_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Deleted user not found")

    target = (body.username or rows[0]["original_username"] or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="Username required for restore")
    if _is_reserved(target):
        raise HTTPException(status_code=400, detail="Username prefix is reserved")

    # UPDATE relies on the UNIQUE(username) constraint to reject collisions —
    # catching IntegrityError closes the TOCTOU window that a SELECT-then-UPDATE
    # check would open if two admins restored into the same slot concurrently.
    # write_transaction handles rollback on the IntegrityError before we re-raise.
    try:
        async with write_transaction(db):
            await db.execute(
                """UPDATE users
                   SET deleted_at = NULL,
                       original_username = NULL,
                       username = ?
                   WHERE id = ?""",
                (target, user_id),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=f"Username '{target}' is taken; choose a different one",
        )
    row = await db.execute_fetchall(
        "SELECT id, username, role, created_at FROM users WHERE id = ?", (user_id,)
    )
    return dict(row[0])
