import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user, require_admin, hash_password
from app.database import get_db

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


@router.get("/search")
async def search_users(
    q: str = Query("", description="Substring match on username or display_name"),
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    """Username lookup for the AclManager picker.

    Returns a minimal shape (id, username, display_name) to keep the
    response small. Available to any authenticated user since the
    alternative is no UI for managing ACLs at all; this does allow
    username enumeration by authenticated users, which is an accepted
    trade-off for a small-team wiki.
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
    pw_hash = hash_password(body.password)
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (body.username, pw_hash, body.role),
    )
    await db.commit()
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
    cursor = await db.execute(
        """INSERT INTO users (username, password_hash, role, display_name, email)
           VALUES (?, ?, ?, ?, ?)""",
        (username, DISABLED_PASSWORD_HASH, body.role, display_name, email),
    )
    await db.commit()
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
        values.append(hash_password(body.password))

    if updates:
        values.append(user_id)
        await db.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values
        )
        await db.commit()

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
    await db.commit()


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
    try:
        await db.execute(
            """UPDATE users
               SET deleted_at = NULL,
                   original_username = NULL,
                   username = ?
               WHERE id = ?""",
            (target, user_id),
        )
        await db.commit()
    except sqlite3.IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Username '{target}' is taken; choose a different one",
        )
    row = await db.execute_fetchall(
        "SELECT id, username, role, created_at FROM users WHERE id = ?", (user_id,)
    )
    return dict(row[0])
