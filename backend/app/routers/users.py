from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user, require_admin, hash_password
from app.database import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "editor"


class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    user=Depends(require_admin),
):
    db = await get_db()
    offset = (page - 1) * per_page
    count_rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM users")
    total = count_rows[0]["cnt"]
    rows = await db.execute_fetchall(
        "SELECT id, username, role, created_at FROM users ORDER BY id LIMIT ? OFFSET ?",
        (per_page, offset),
    )
    return {
        "users": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("", status_code=201)
async def create_user(body: UserCreate, user=Depends(require_admin)):
    if body.role not in ("admin", "editor"):
        raise HTTPException(status_code=400, detail="Role must be admin or editor")
    db = await get_db()
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


@router.put("/{user_id}")
async def update_user(user_id: int, body: UserUpdate, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, role FROM users WHERE id = ?", (user_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")

    updates = []
    values = []
    if body.role is not None:
        if body.role not in ("admin", "editor"):
            raise HTTPException(status_code=400, detail="Role must be admin or editor")
        # Prevent last admin from demoting themselves
        if user_id == user["id"] and body.role != "admin":
            admin_count = await db.execute_fetchall(
                "SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'"
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
    rows = await db.execute_fetchall("SELECT id FROM users WHERE id = ?", (user_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.commit()
