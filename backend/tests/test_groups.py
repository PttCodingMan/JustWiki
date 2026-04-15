"""Tests for /api/groups CRUD and member management.

Groups are cleared between tests by the autouse fixture in test_acl.py,
but test_groups.py uses its own local cleanup too since its tests don't
import from test_acl.py.
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import create_token, hash_password
from app.database import get_db
from app.main import app


def _client_for(user: dict) -> AsyncClient:
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


async def _get_or_create(db, username: str, role: str) -> dict:
    rows = await db.execute_fetchall(
        "SELECT id, role FROM users WHERE username = ?", (username,)
    )
    if rows:
        return {"id": rows[0]["id"], "username": username, "role": rows[0]["role"]}
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, hash_password("x"), role),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "username": username, "role": role}


@pytest.fixture(autouse=True)
async def _clean_groups():
    db = await get_db()
    await db.execute("DELETE FROM page_acl WHERE principal_type = 'group'")
    await db.execute("DELETE FROM group_members")
    await db.execute("DELETE FROM groups")
    await db.commit()
    yield
    await db.execute("DELETE FROM page_acl WHERE principal_type = 'group'")
    await db.execute("DELETE FROM group_members")
    await db.execute("DELETE FROM groups")
    await db.commit()


@pytest.mark.asyncio
async def test_admin_can_create_group():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_create", "admin")

    async with _client_for(admin) as client:
        resp = await client.post(
            "/api/groups",
            json={"name": "engineering", "description": "eng team"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "engineering"
    assert body["member_count"] == 0


@pytest.mark.asyncio
async def test_editor_cannot_create_group():
    db = await get_db()
    alice = await _get_or_create(db, "groups_editor_create", "editor")
    async with _client_for(alice) as client:
        resp = await client.post("/api/groups", json={"name": "nope"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_duplicate_group_name_rejected():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_dup", "admin")
    async with _client_for(admin) as client:
        await client.post("/api/groups", json={"name": "dup-name"})
        resp = await client.post("/api/groups", json={"name": "dup-name"})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_list_groups_visible_to_any_authenticated_user():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_list", "admin")
    alice = await _get_or_create(db, "groups_editor_list", "editor")

    async with _client_for(admin) as client:
        await client.post("/api/groups", json={"name": "visible-to-all"})

    async with _client_for(alice) as client:
        resp = await client.get("/api/groups")
    assert resp.status_code == 200
    names = {g["name"] for g in resp.json()}
    assert "visible-to-all" in names


@pytest.mark.asyncio
async def test_admin_can_add_and_remove_member():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_mem", "admin")
    alice = await _get_or_create(db, "groups_alice_mem", "editor")

    async with _client_for(admin) as client:
        create = await client.post("/api/groups", json={"name": "members-test"})
        gid = create.json()["id"]

        add = await client.post(
            f"/api/groups/{gid}/members",
            json={"user_id": alice["id"]},
        )
        assert add.status_code == 201

        mem = await client.get(f"/api/groups/{gid}/members")
        assert mem.status_code == 200
        assert {m["username"] for m in mem.json()} == {"groups_alice_mem"}

        rem = await client.delete(f"/api/groups/{gid}/members/{alice['id']}")
        assert rem.status_code == 204

        mem2 = await client.get(f"/api/groups/{gid}/members")
        assert mem2.json() == []


@pytest.mark.asyncio
async def test_editor_cannot_add_member():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_editor_add", "admin")
    alice = await _get_or_create(db, "groups_alice_editor_add", "editor")
    bob = await _get_or_create(db, "groups_bob_editor_add", "editor")

    async with _client_for(admin) as client:
        create = await client.post("/api/groups", json={"name": "editor-add-test"})
        gid = create.json()["id"]

    async with _client_for(alice) as client:
        resp = await client.post(
            f"/api/groups/{gid}/members",
            json={"user_id": bob["id"]},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_group_cleans_up_page_acl():
    db = await get_db()
    admin = await _get_or_create(db, "groups_admin_cleanup", "admin")

    # Create a group and a page_acl row pointing at it.
    async with _client_for(admin) as client:
        create = await client.post("/api/groups", json={"name": "to-be-deleted"})
        gid = create.json()["id"]

    cursor = await db.execute(
        "INSERT INTO pages (slug, title) VALUES (?, ?)",
        ("groups-cleanup-page", "groups-cleanup-page"),
    )
    page_id = cursor.lastrowid
    await db.execute(
        """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
           VALUES (?, 'group', ?, 'write')""",
        (page_id, gid),
    )
    await db.commit()

    # Sanity: row exists.
    before = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM page_acl WHERE principal_type='group' AND principal_id=?",
        (gid,),
    )
    assert before[0]["cnt"] == 1

    async with _client_for(admin) as client:
        resp = await client.delete(f"/api/groups/{gid}")
    assert resp.status_code == 204

    after = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM page_acl WHERE principal_type='group' AND principal_id=?",
        (gid,),
    )
    assert after[0]["cnt"] == 0
