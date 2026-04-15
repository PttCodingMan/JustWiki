"""Unit tests for the ACL resolver (backend/app/services/acl.py).

These tests exercise the resolver directly against the shared test DB,
cleaning up page_acl / groups / group_members between tests so rows don't
leak. Integration tests for router enforcement live in the router-specific
test files added in later commits.
"""

import pytest
from app.database import get_db
from app.services.acl import (
    resolve_page_permission,
    list_readable_page_ids,
    can_read_media,
)


async def _get_or_create_user(db, username, role):
    rows = await db.execute_fetchall(
        "SELECT id, role FROM users WHERE username = ?", (username,)
    )
    if rows:
        return {"id": rows[0]["id"], "username": username, "role": rows[0]["role"]}
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, 'x', ?)",
        (username, role),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "username": username, "role": role}


async def _make_page(db, slug, parent_id=None):
    cursor = await db.execute(
        "INSERT INTO pages (slug, title, parent_id) VALUES (?, ?, ?)",
        (slug, slug, parent_id),
    )
    await db.commit()
    return cursor.lastrowid


async def _add_acl(db, page_id, principal_type, principal_id, permission):
    await db.execute(
        """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
           VALUES (?, ?, ?, ?)""",
        (page_id, principal_type, principal_id, permission),
    )
    await db.commit()


async def _make_group(db, name, created_by):
    cursor = await db.execute(
        "INSERT INTO groups (name, created_by) VALUES (?, ?)",
        (name, created_by),
    )
    await db.commit()
    return cursor.lastrowid


async def _add_member(db, group_id, user_id):
    await db.execute(
        "INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
        (group_id, user_id),
    )
    await db.commit()


async def _remove_member(db, group_id, user_id):
    await db.execute(
        "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
        (group_id, user_id),
    )
    await db.commit()


@pytest.fixture(autouse=True)
async def _clean_acl_state():
    """Clear all ACL-adjacent rows before and after each test so state from
    one test never leaks into another. Pages and users are left alone because
    the unique slugs/usernames each test uses make that safe.
    """
    db = await get_db()
    await db.execute("DELETE FROM page_acl")
    await db.execute("DELETE FROM group_members")
    await db.execute("DELETE FROM groups")
    await db.commit()
    yield
    await db.execute("DELETE FROM page_acl")
    await db.execute("DELETE FROM group_members")
    await db.execute("DELETE FROM groups")
    await db.commit()


# ── resolve_page_permission ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_bypasses_acl():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_admin_bypass", "editor")
    admin = await _get_or_create_user(db, "acl_admin_bypass", "admin")
    page = await _make_page(db, "acl-admin-bypass")
    await _add_acl(db, page, "user", alice["id"], "read")

    assert await resolve_page_permission(db, admin, page) == "admin"


@pytest.mark.asyncio
async def test_editor_default_is_write():
    db = await get_db()
    bob = await _get_or_create_user(db, "acl_bob_default", "editor")
    page = await _make_page(db, "acl-editor-default")
    assert await resolve_page_permission(db, bob, page) == "write"


@pytest.mark.asyncio
async def test_viewer_default_is_read():
    db = await get_db()
    vic = await _get_or_create_user(db, "acl_vic_default", "viewer")
    page = await _make_page(db, "acl-viewer-default")
    assert await resolve_page_permission(db, vic, page) == "read"


@pytest.mark.asyncio
async def test_viewer_capped_even_with_write_grant():
    db = await get_db()
    vic = await _get_or_create_user(db, "acl_vic_capped", "viewer")
    page = await _make_page(db, "acl-viewer-capped")
    await _add_acl(db, page, "user", vic["id"], "write")
    assert await resolve_page_permission(db, vic, page) == "read"


@pytest.mark.asyncio
async def test_explicit_user_grant_and_denial():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_user_grant", "editor")
    bob = await _get_or_create_user(db, "acl_bob_user_grant", "editor")
    page = await _make_page(db, "acl-user-grant")
    await _add_acl(db, page, "user", alice["id"], "write")

    assert await resolve_page_permission(db, alice, page) == "write"
    # Anchor exists but has no row for bob → denied.
    assert await resolve_page_permission(db, bob, page) == "none"


@pytest.mark.asyncio
async def test_group_grant():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_group_grant", "admin")
    alice = await _get_or_create_user(db, "acl_alice_group_grant", "editor")
    bob = await _get_or_create_user(db, "acl_bob_group_grant", "editor")
    gid = await _make_group(db, "acl-group-grant-engineering", admin["id"])
    await _add_member(db, gid, alice["id"])

    page = await _make_page(db, "acl-group-grant-page")
    await _add_acl(db, page, "group", gid, "write")

    assert await resolve_page_permission(db, alice, page) == "write"
    assert await resolve_page_permission(db, bob, page) == "none"


@pytest.mark.asyncio
async def test_group_membership_changes_propagate_immediately():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_prop", "admin")
    bob = await _get_or_create_user(db, "acl_bob_prop", "editor")
    gid = await _make_group(db, "acl-prop-group", admin["id"])
    page = await _make_page(db, "acl-prop-page")
    await _add_acl(db, page, "group", gid, "write")

    assert await resolve_page_permission(db, bob, page) == "none"

    await _add_member(db, gid, bob["id"])
    assert await resolve_page_permission(db, bob, page) == "write"

    await _remove_member(db, gid, bob["id"])
    assert await resolve_page_permission(db, bob, page) == "none"


@pytest.mark.asyncio
async def test_user_row_plus_group_row_most_permissive_wins():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_mup", "admin")
    alice = await _get_or_create_user(db, "acl_alice_mup", "editor")
    gid = await _make_group(db, "acl-mup-group", admin["id"])
    await _add_member(db, gid, alice["id"])

    page = await _make_page(db, "acl-mup-page")
    # Direct user row says read, group row says write → write wins.
    await _add_acl(db, page, "user", alice["id"], "read")
    await _add_acl(db, page, "group", gid, "write")

    assert await resolve_page_permission(db, alice, page) == "write"


@pytest.mark.asyncio
async def test_inheritance_down_subtree():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_inh", "editor")
    bob = await _get_or_create_user(db, "acl_bob_inh", "editor")

    parent = await _make_page(db, "acl-inh-parent")
    child = await _make_page(db, "acl-inh-child", parent_id=parent)
    grand = await _make_page(db, "acl-inh-grand", parent_id=child)

    await _add_acl(db, parent, "user", alice["id"], "write")

    # Alice gets write everywhere via inheritance.
    assert await resolve_page_permission(db, alice, parent) == "write"
    assert await resolve_page_permission(db, alice, child) == "write"
    assert await resolve_page_permission(db, alice, grand) == "write"

    # Bob is locked out at the parent anchor; inheritance propagates deny.
    assert await resolve_page_permission(db, bob, parent) == "none"
    assert await resolve_page_permission(db, bob, child) == "none"
    assert await resolve_page_permission(db, bob, grand) == "none"


@pytest.mark.asyncio
async def test_child_override_shadows_parent_acl():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_ovr", "editor")
    bob = await _get_or_create_user(db, "acl_bob_ovr", "editor")

    parent = await _make_page(db, "acl-ovr-parent")
    child = await _make_page(db, "acl-ovr-child", parent_id=parent)

    await _add_acl(db, parent, "user", alice["id"], "write")
    await _add_acl(db, child, "user", bob["id"], "read")

    # Child's shallowest anchor is itself; Alice has no row there → denied.
    assert await resolve_page_permission(db, alice, child) == "none"
    assert await resolve_page_permission(db, bob, child) == "read"
    # Parent's shallowest anchor is parent; unchanged.
    assert await resolve_page_permission(db, alice, parent) == "write"
    assert await resolve_page_permission(db, bob, parent) == "none"


# ── list_readable_page_ids ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_readable_admin_gets_all_live_pages():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_list", "admin")
    other = await _get_or_create_user(db, "acl_other_list", "editor")
    p1 = await _make_page(db, "acl-list-admin-1")
    p2 = await _make_page(db, "acl-list-admin-2")
    await _add_acl(db, p1, "user", other["id"], "read")

    ids = await list_readable_page_ids(db, admin)
    assert p1 in ids
    assert p2 in ids


@pytest.mark.asyncio
async def test_list_readable_editor_respects_anchors():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_list", "editor")
    bob = await _get_or_create_user(db, "acl_bob_list", "editor")

    open_page = await _make_page(db, "acl-list-open")
    restricted = await _make_page(db, "acl-list-restricted")
    await _add_acl(db, restricted, "user", alice["id"], "write")

    alice_ids = await list_readable_page_ids(db, alice)
    bob_ids = await list_readable_page_ids(db, bob)

    assert open_page in alice_ids
    assert restricted in alice_ids
    assert open_page in bob_ids
    assert restricted not in bob_ids


@pytest.mark.asyncio
async def test_list_readable_via_group():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_list_g", "admin")
    alice = await _get_or_create_user(db, "acl_alice_list_g", "editor")
    bob = await _get_or_create_user(db, "acl_bob_list_g", "editor")
    gid = await _make_group(db, "acl-list-g-engineering", admin["id"])
    await _add_member(db, gid, alice["id"])

    page = await _make_page(db, "acl-list-g-page")
    await _add_acl(db, page, "group", gid, "read")

    assert page in await list_readable_page_ids(db, alice)
    assert page not in await list_readable_page_ids(db, bob)


@pytest.mark.asyncio
async def test_list_readable_inheritance():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_list_inh", "editor")
    bob = await _get_or_create_user(db, "acl_bob_list_inh", "editor")

    parent = await _make_page(db, "acl-list-inh-parent")
    child = await _make_page(db, "acl-list-inh-child", parent_id=parent)

    await _add_acl(db, parent, "user", alice["id"], "write")

    alice_ids = await list_readable_page_ids(db, alice)
    bob_ids = await list_readable_page_ids(db, bob)

    assert parent in alice_ids and child in alice_ids
    assert parent not in bob_ids and child not in bob_ids


# ── can_read_media ───────────────────────────────────────────────────────


async def _make_media(db, filename, uploaded_by):
    cursor = await db.execute(
        """INSERT INTO media (filename, original_name, filepath, mime_type, uploaded_by)
           VALUES (?, ?, ?, 'image/png', ?)""",
        (filename, filename, f"/tmp/{filename}", uploaded_by),
    )
    await db.commit()
    return cursor.lastrowid


async def _link_media(db, page_id, media_id):
    await db.execute(
        "INSERT OR IGNORE INTO media_references (page_id, media_id) VALUES (?, ?)",
        (page_id, media_id),
    )
    await db.commit()


@pytest.mark.asyncio
async def test_can_read_media_via_referencing_page():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_media", "editor")
    bob = await _get_or_create_user(db, "acl_bob_media", "editor")

    page = await _make_page(db, "acl-media-page")
    await _add_acl(db, page, "user", alice["id"], "read")

    media_id = await _make_media(db, "acl-media-test.png", alice["id"])
    await _link_media(db, page, media_id)

    assert await can_read_media(db, alice, media_id) is True
    assert await can_read_media(db, bob, media_id) is False


@pytest.mark.asyncio
async def test_can_read_media_orphan_uploader_only():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_alice_orph", "editor")
    bob = await _get_or_create_user(db, "acl_bob_orph", "editor")

    media_id = await _make_media(db, "acl-orphan.png", alice["id"])

    assert await can_read_media(db, alice, media_id) is True
    assert await can_read_media(db, bob, media_id) is False


@pytest.mark.asyncio
async def test_can_read_media_admin_always():
    db = await get_db()
    admin = await _get_or_create_user(db, "acl_admin_media", "admin")
    alice = await _get_or_create_user(db, "acl_alice_adm_media", "editor")

    media_id = await _make_media(db, "acl-admin-media.png", alice["id"])
    # orphan, uploaded by alice; admin should still see it
    assert await can_read_media(db, admin, media_id) is True


# ── pages router integration ─────────────────────────────────────────────
#
# These tests verify that router-level enforcement in pages.py calls into
# the resolver correctly. They spin up users with distinct roles, create
# ACL rows, and hit the HTTP API.

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.auth import create_token


def _token_client(user: dict) -> AsyncClient:
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_router_viewer_cannot_create_page():
    db = await get_db()
    vic = await _get_or_create_user(db, "acl_router_vic_create", "viewer")
    async with _token_client(vic) as client:
        resp = await client.post(
            "/api/pages",
            json={"title": "Nope", "slug": "acl-router-viewer-create"},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_router_viewer_cannot_update_page():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_upd", "editor")
    vic = await _get_or_create_user(db, "acl_router_vic_upd", "viewer")

    # Alice creates a page directly in DB so the test doesn't depend on create.
    await _make_page(db, "acl-router-viewer-update")

    async with _token_client(vic) as client:
        resp = await client.put(
            "/api/pages/acl-router-viewer-update",
            json={"title": "Hijacked"},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_router_get_page_404_for_denied_user():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_deny", "editor")
    bob = await _get_or_create_user(db, "acl_router_bob_deny", "editor")
    page = await _make_page(db, "acl-router-denied")
    await _add_acl(db, page, "user", alice["id"], "write")

    async with _token_client(alice) as client:
        resp = await client.get("/api/pages/acl-router-denied")
    assert resp.status_code == 200
    assert resp.json()["effective_permission"] == "write"

    async with _token_client(bob) as client:
        resp = await client.get("/api/pages/acl-router-denied")
    # 404 (not 403) so bob can't learn the page exists.
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_router_read_only_user_cannot_write():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_ro", "editor")
    page = await _make_page(db, "acl-router-readonly")
    await _add_acl(db, page, "user", alice["id"], "read")

    async with _token_client(alice) as client:
        get_resp = await client.get("/api/pages/acl-router-readonly")
        assert get_resp.status_code == 200
        assert get_resp.json()["effective_permission"] == "read"

        put_resp = await client.put(
            "/api/pages/acl-router-readonly",
            json={"title": "Nope"},
        )
        assert put_resp.status_code == 403


@pytest.mark.asyncio
async def test_router_list_pages_filters_denied():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_list", "editor")
    bob = await _get_or_create_user(db, "acl_router_bob_list", "editor")
    restricted = await _make_page(db, "acl-router-list-restricted")
    await _add_acl(db, restricted, "user", alice["id"], "read")

    async with _token_client(bob) as client:
        resp = await client.get("/api/pages", params={"per_page": 100})
    assert resp.status_code == 200
    slugs = {p["slug"] for p in resp.json()["pages"]}
    assert "acl-router-list-restricted" not in slugs


@pytest.mark.asyncio
async def test_router_tree_filters_denied_but_keeps_readable_children():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_tree", "editor")
    bob = await _get_or_create_user(db, "acl_router_bob_tree", "editor")

    parent = await _make_page(db, "acl-router-tree-parent")
    child = await _make_page(db, "acl-router-tree-child", parent_id=parent)

    # Parent locked to alice; child explicitly shared with bob (read).
    await _add_acl(db, parent, "user", alice["id"], "write")
    await _add_acl(db, child, "user", bob["id"], "read")

    async with _token_client(bob) as client:
        resp = await client.get("/api/pages/tree")
    assert resp.status_code == 200
    # Flatten tree and look for child — it should be visible (as a root,
    # since parent was filtered out).
    def _flatten(nodes):
        out = []
        for n in nodes:
            out.append(n["slug"])
            out.extend(_flatten(n.get("children", [])))
        return out

    slugs = _flatten(resp.json())
    assert "acl-router-tree-child" in slugs
    assert "acl-router-tree-parent" not in slugs


@pytest.mark.asyncio
async def test_router_create_under_denied_parent_403():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_parent", "editor")
    bob = await _get_or_create_user(db, "acl_router_bob_parent", "editor")
    parent = await _make_page(db, "acl-router-parent-gate")
    await _add_acl(db, parent, "user", alice["id"], "write")

    async with _token_client(bob) as client:
        resp = await client.post(
            "/api/pages",
            json={
                "title": "Sneaky",
                "slug": "acl-router-sneaky-child",
                "parent_id": parent,
            },
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_router_admin_bypass_through_http():
    db = await get_db()
    alice = await _get_or_create_user(db, "acl_router_alice_admin_bypass", "editor")
    admin = await _get_or_create_user(db, "acl_router_admin_bypass", "admin")
    page = await _make_page(db, "acl-router-admin-bypass")
    await _add_acl(db, page, "user", alice["id"], "read")

    async with _token_client(admin) as client:
        get_resp = await client.get("/api/pages/acl-router-admin-bypass")
    assert get_resp.status_code == 200
    assert get_resp.json()["effective_permission"] == "admin"
