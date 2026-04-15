"""Group CRUD + membership management.

Group creation and membership edits are admin-only. Listing is open to
any authenticated user because the AclManager picker needs to show all
available groups to pick from.

Deleting a group cascades into `group_members` via the schema's ON
DELETE CASCADE and also explicitly clears any `page_acl` rows that
referenced the group, so deleted groups don't leave behind ghost grants.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.database import get_db

router = APIRouter(prefix="/api/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str
    description: str = ""


class GroupMemberAdd(BaseModel):
    user_id: int


@router.get("")
async def list_groups(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT g.id, g.name, g.description, g.created_at, g.created_by,
                  (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
           FROM groups g
           ORDER BY g.name"""
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_group(body: GroupCreate, user=Depends(require_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name cannot be empty")
    db = await get_db()
    existing = await db.execute_fetchall(
        "SELECT id FROM groups WHERE name = ?", (name,)
    )
    if existing:
        raise HTTPException(status_code=409, detail="Group name already exists")
    cursor = await db.execute(
        "INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?)",
        (name, body.description, user["id"]),
    )
    await db.commit()
    return {
        "id": cursor.lastrowid,
        "name": name,
        "description": body.description,
        "member_count": 0,
    }


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM groups WHERE id = ?", (group_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Group not found")

    # Clean up ACL rows that referenced this group so they don't turn into
    # dangling "grant to unknown group" entries. group_members cascades via
    # the schema's ON DELETE CASCADE.
    await db.execute(
        "DELETE FROM page_acl WHERE principal_type = 'group' AND principal_id = ?",
        (group_id,),
    )
    await db.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    await db.commit()


@router.get("/{group_id}/members")
async def list_members(group_id: int, user=Depends(get_current_user)):
    db = await get_db()
    group = await db.execute_fetchall(
        "SELECT id FROM groups WHERE id = ?", (group_id,)
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    rows = await db.execute_fetchall(
        """SELECT u.id, u.username, u.display_name, u.role, gm.added_at
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.group_id = ?
           ORDER BY u.username""",
        (group_id,),
    )
    return [dict(r) for r in rows]


@router.post("/{group_id}/members", status_code=201)
async def add_member(
    group_id: int,
    body: GroupMemberAdd,
    user=Depends(require_admin),
):
    db = await get_db()
    group = await db.execute_fetchall(
        "SELECT id FROM groups WHERE id = ?", (group_id,)
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    target = await db.execute_fetchall(
        "SELECT id FROM users WHERE id = ?", (body.user_id,)
    )
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    await db.execute(
        "INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
        (group_id, body.user_id),
    )
    await db.commit()
    return {"group_id": group_id, "user_id": body.user_id}


@router.delete("/{group_id}/members/{user_id}", status_code=204)
async def remove_member(
    group_id: int,
    user_id: int,
    user=Depends(require_admin),
):
    db = await get_db()
    await db.execute(
        "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
        (group_id, user_id),
    )
    await db.commit()
