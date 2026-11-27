"""The `manage` permission level.

`manage` = `write` + control over who can see a page: editing its ACL,
toggling `is_public`, and moves that change which ACL the page inherits.
It comes from an explicit ACL grant, or — on an unrestricted page — from
having created the page. Plain write (incl. the open default every editor
gets) only allows editing content.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import create_token
from app.database import get_db
from app.main import app
from app.migrations import _m016_acl_manage_permission
from app.services.acl import (
    find_acl_anchor,
    has_permission,
    invalidate_readable_cache,
    resolve_page_permission,
)


async def _user(db, username: str, role: str = "editor") -> dict:
    rows = await db.execute_fetchall("SELECT id, role FROM users WHERE username = ?", (username,))
    if rows:
        return {"id": rows[0]["id"], "username": username, "role": rows[0]["role"]}
    cur = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, 'x', ?)", (username, role)
    )
    await db.commit()
    return {"id": cur.lastrowid, "username": username, "role": role}


async def _page(db, slug: str, *, parent_id=None, created_by=None) -> int:
    cur = await db.execute(
        "INSERT INTO pages (slug, title, parent_id, created_by) VALUES (?, ?, ?, ?)",
        (slug, slug, parent_id, created_by),
    )
    await db.commit()
    return cur.lastrowid


async def _acl(db, page_id: int, user_id: int, permission: str) -> None:
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) "
        "VALUES (?, 'user', ?, ?)",
        (page_id, user_id, permission),
    )
    await db.commit()
    invalidate_readable_cache()


def _client(user: dict) -> AsyncClient:
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.fixture(autouse=True)
async def _clean_acl():
    db = await get_db()
    await db.execute("DELETE FROM page_acl")
    await db.commit()
    invalidate_readable_cache()
    yield
    await db.execute("DELETE FROM page_acl")
    await db.commit()
    invalidate_readable_cache()


# ── Resolution ─────────────────────────────────────────────────────────────


def test_has_permission_ordering():
    assert has_permission("manage", "write")
    assert has_permission("admin", "manage")
    assert not has_permission("write", "manage")
    assert not has_permission("read", "write")
    assert not has_permission(None, "read")


@pytest.mark.asyncio
async def test_creator_manages_unrestricted_page(db):
    owner = await _user(db, "mg_owner_open")
    other = await _user(db, "mg_other_open")
    page = await _page(db, "mg-open-page", created_by=owner["id"])
    assert await resolve_page_permission(db, owner, page) == "manage"
    assert await resolve_page_permission(db, other, page) == "write"
    # Ownership doesn't extend to the subtree.
    child = await _page(db, "mg-open-child", parent_id=page, created_by=other["id"])
    assert await resolve_page_permission(db, owner, child) == "write"


@pytest.mark.asyncio
async def test_viewer_creator_and_viewer_grant_are_capped(db):
    viewer = await _user(db, "mg_viewer", "viewer")
    page = await _page(db, "mg-viewer-page", created_by=viewer["id"])
    assert await resolve_page_permission(db, viewer, page) == "read"
    await _acl(db, page, viewer["id"], "manage")
    assert await resolve_page_permission(db, viewer, page) == "read"


@pytest.mark.asyncio
async def test_inside_restricted_space_only_explicit_manage_counts(db):
    lead = await _user(db, "mg_lead")
    member = await _user(db, "mg_member")
    space = await _page(db, "mg-space")
    await _acl(db, space, lead["id"], "manage")
    await _acl(db, space, member["id"], "write")
    authored = await _page(db, "mg-member-page", parent_id=space, created_by=member["id"])

    assert await resolve_page_permission(db, member, authored) == "write"
    assert await resolve_page_permission(db, lead, authored) == "manage"
    assert await find_acl_anchor(db, authored) == space
    assert await find_acl_anchor(db, None) is None


# ── ACL editing ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_open_default_write_cannot_edit_acl(db):
    owner = await _user(db, "mg_acl_owner")
    other = await _user(db, "mg_acl_other")
    await _page(db, "mg-acl-page", created_by=owner["id"])
    rows = {"rows": [{"principal_type": "user", "principal_id": other["id"], "permission": "manage"}]}

    async with _client(other) as c:
        assert (await c.put("/api/pages/mg-acl-page/acl", json=rows)).status_code == 403
        assert (await c.delete("/api/pages/mg-acl-page/acl")).status_code == 403

    own = {"rows": [{"principal_type": "user", "principal_id": owner["id"], "permission": "manage"}]}
    async with _client(owner) as c:
        assert (await c.put("/api/pages/mg-acl-page/acl", json=own)).status_code == 200


@pytest.mark.asyncio
async def test_acl_put_refuses_self_lockout(db):
    owner = await _user(db, "mg_lock_owner")
    other = await _user(db, "mg_lock_other")
    page = await _page(db, "mg-lock-page", created_by=owner["id"])
    # Granting yourself only write would drop you to write → refused.
    rows = {"rows": [
        {"principal_type": "user", "principal_id": owner["id"], "permission": "write"},
        {"principal_type": "user", "principal_id": other["id"], "permission": "read"},
    ]}
    async with _client(owner) as c:
        res = await c.put("/api/pages/mg-lock-page/acl", json=rows)
    assert res.status_code == 400
    left = await db.execute_fetchall("SELECT 1 FROM page_acl WHERE page_id = ?", (page,))
    assert not left, "the rejected change must be rolled back"


# ── Public sharing ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_is_public_needs_manage(db):
    owner = await _user(db, "mg_pub_owner")
    other = await _user(db, "mg_pub_other")
    await _page(db, "mg-pub-page", created_by=owner["id"])

    async with _client(other) as c:
        assert (await c.put("/api/pages/mg-pub-page", json={"is_public": True})).status_code == 403
        # Content edits by a plain writer still work.
        page = (await c.get("/api/pages/mg-pub-page")).json()
        res = await c.put(
            "/api/pages/mg-pub-page",
            json={"content_md": "edited", "base_version": page["version"]},
        )
        assert res.status_code == 200
    async with _client(owner) as c:
        assert (await c.put("/api/pages/mg-pub-page", json={"is_public": True})).status_code == 200


# ── Moves that change the inherited ACL ────────────────────────────────────


@pytest.mark.asyncio
async def test_writer_cannot_pull_page_out_of_restricted_space(db):
    lead = await _user(db, "mg_out_lead")
    member = await _user(db, "mg_out_member")
    space = await _page(db, "mg-out-space")
    await _acl(db, space, lead["id"], "manage")
    await _acl(db, space, member["id"], "write")
    await _page(db, "mg-out-page", parent_id=space, created_by=member["id"])

    async with _client(member) as c:
        assert (await c.patch("/api/pages/mg-out-page/move", json={"parent_id": None})).status_code == 403
        assert (await c.put("/api/pages/mg-out-page", json={"parent_id": None})).status_code == 403
    async with _client(lead) as c:
        assert (await c.patch("/api/pages/mg-out-page/move", json={"parent_id": None})).status_code == 200


@pytest.mark.asyncio
async def test_writer_cannot_hide_someone_elses_page_in_private_space(db):
    victim = await _user(db, "mg_hide_victim")
    mover = await _user(db, "mg_hide_mover")
    private = await _page(db, "mg-hide-private")
    await _acl(db, private, mover["id"], "manage")
    victim_page = await _page(db, "mg-hide-victim-page", created_by=victim["id"])

    async with _client(mover) as c:
        res = await c.patch("/api/pages/mg-hide-victim-page/move", json={"parent_id": private})
    assert res.status_code == 403
    rows = await db.execute_fetchall("SELECT parent_id FROM pages WHERE id = ?", (victim_page,))
    assert rows[0]["parent_id"] is None


@pytest.mark.asyncio
async def test_moves_that_keep_the_acl_only_need_write(db):
    lead = await _user(db, "mg_same_lead")
    member = await _user(db, "mg_same_member")
    space = await _page(db, "mg-same-space")
    await _acl(db, space, lead["id"], "manage")
    await _acl(db, space, member["id"], "write")
    folder_a = await _page(db, "mg-same-a", parent_id=space)
    folder_b = await _page(db, "mg-same-b", parent_id=space)
    await _page(db, "mg-same-page", parent_id=folder_a)
    # A page with its own rules keeps them wherever it goes.
    own = await _page(db, "mg-same-own", parent_id=folder_a)
    await _acl(db, own, member["id"], "write")

    async with _client(member) as c:
        assert (await c.patch("/api/pages/mg-same-page/move", json={"parent_id": folder_b})).status_code == 200
        assert (await c.patch("/api/pages/mg-same-own/move", json={"parent_id": None})).status_code == 200
        # Unrestricted → unrestricted needs only write too.
        await _page(db, "mg-same-open-1")
        open2 = await _page(db, "mg-same-open-2")
        assert (await c.put("/api/pages/mg-same-open-1", json={"parent_id": open2})).status_code == 200


# ── Migration ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_migration_016_rebuilds_old_page_acl(tmp_path):
    import aiosqlite

    async with aiosqlite.connect(tmp_path / "old.db") as db:
        db.row_factory = aiosqlite.Row
        await db.execute("CREATE TABLE pages (id INTEGER PRIMARY KEY)")
        await db.execute("INSERT INTO pages (id) VALUES (1)")
        await db.execute(
            """CREATE TABLE page_acl (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'group')),
                principal_id INTEGER NOT NULL,
                permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
                UNIQUE (page_id, principal_type, principal_id))"""
        )
        await db.execute(
            "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) "
            "VALUES (1, 'user', 7, 'write')"
        )
        await db.commit()

        await _m016_acl_manage_permission(db)
        await db.commit()
        await _m016_acl_manage_permission(db)  # idempotent

        await db.execute(
            "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) "
            "VALUES (1, 'user', 8, 'manage')"
        )
        rows = await db.execute_fetchall(
            "SELECT principal_id, permission FROM page_acl ORDER BY principal_id"
        )
        assert [tuple(r) for r in rows] == [(7, "write"), (8, "manage")]
        idx = await db.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'page_acl'"
        )
        assert {"idx_page_acl_page", "idx_page_acl_principal"} <= {r["name"] for r in idx}
