import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import create_token, hash_password
from app.config import settings
from app.main import app
from app.services.acl import invalidate_readable_cache


@pytest.mark.asyncio
async def test_list_users_admin(admin_client):
    response = await admin_client.get("/api/users")
    assert response.status_code == 200
    assert "users" in response.json()


@pytest.mark.asyncio
async def test_list_users_not_admin(auth_client):
    response = await auth_client.get("/api/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_update_user(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("updateme", "hash", "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()

    response = await admin_client.put(
        f"/api/users/{user_id}", json={"role": "admin"}
    )
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_delete_self_fails(admin_client, admin_user):
    user_id = admin_user["user"]["id"]
    response = await admin_client.delete(f"/api/users/{user_id}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot delete yourself"


# --- Soft-delete -----------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_user_is_soft(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("softme", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()

    response = await admin_client.delete(f"/api/users/{user_id}")
    assert response.status_code == 204

    # Row still exists for FK reasons, but is marked deleted and renamed.
    rows = await db.execute_fetchall(
        "SELECT id, username, original_username, deleted_at FROM users WHERE id = ?",
        (user_id,),
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["deleted_at"] is not None
    assert row["original_username"] == "softme"
    assert row["username"].startswith("__deleted_")


@pytest.mark.asyncio
async def test_deleted_user_hidden_from_list(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("listhidden", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    # Default list hides deleted rows (use max page size to avoid pagination
    # losing the test user when the suite has populated many rows).
    default = await admin_client.get("/api/users?per_page=200")
    assert default.status_code == 200
    usernames = [u["username"] for u in default.json()["users"]]
    assert "listhidden" not in usernames
    assert not any(u.startswith("__deleted_") for u in usernames)

    # include_deleted surfaces them again
    included = await admin_client.get("/api/users?include_deleted=true&per_page=200")
    assert included.status_code == 200
    matches = [u for u in included.json()["users"] if u["id"] == user_id]
    assert matches and matches[0]["original_username"] == "listhidden"


@pytest.mark.asyncio
async def test_deleted_users_endpoint_returns_tombstones(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("trashme", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    response = await admin_client.get("/api/users/deleted")
    assert response.status_code == 200
    ids = [u["id"] for u in response.json()]
    assert user_id in ids
    entry = next(u for u in response.json() if u["id"] == user_id)
    assert entry["original_username"] == "trashme"


@pytest.mark.asyncio
async def test_search_users_excludes_deleted(auth_client, admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("searchme", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    # AclManager-style lookup must not leak deleted users
    response = await auth_client.get("/api/users/search?q=searchme")
    assert response.status_code == 200
    assert all(u["id"] != user_id for u in response.json())


@pytest.mark.asyncio
async def test_cannot_update_deleted_user(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("frozen", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    response = await admin_client.put(
        f"/api/users/{user_id}", json={"role": "admin"}
    )
    assert response.status_code == 404


# --- Login / auth behaviour ------------------------------------------------


@pytest.mark.asyncio
async def test_deleted_user_cannot_login(client, admin_client, db):
    pw = hash_password("correct-horse")
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("loginme", pw, "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()

    # Sanity: login works first
    ok = await client.post(
        "/api/auth/login", json={"username": "loginme", "password": "correct-horse"}
    )
    assert ok.status_code == 200

    await admin_client.delete(f"/api/users/{user_id}")

    denied = await client.post(
        "/api/auth/login", json={"username": "loginme", "password": "correct-horse"}
    )
    assert denied.status_code == 401


@pytest.mark.asyncio
async def test_deleted_user_existing_token_rejected(client, admin_client, db):
    from app.auth import create_token

    pw = hash_password("pw")
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("tokened", pw, "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()

    # Token minted before deletion — simulates a cookie that was already set.
    token = create_token(user_id, "tokened", "editor")

    await admin_client.delete(f"/api/users/{user_id}")

    response = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


# --- Re-create after delete ------------------------------------------------


@pytest.mark.asyncio
async def test_can_create_user_with_same_name_after_delete(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("reuse", hash_password("pw"), "editor"),
    )
    old_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{old_id}")

    response = await admin_client.post(
        "/api/users",
        json={"username": "reuse", "password": "newpassword", "role": "editor"},
    )
    assert response.status_code == 201
    new_id = response.json()["id"]
    assert new_id != old_id


@pytest.mark.asyncio
async def test_cannot_create_reserved_prefix(admin_client):
    response = await admin_client.post(
        "/api/users",
        json={"username": "__deleted_hacker", "password": "pw12345", "role": "editor"},
    )
    assert response.status_code == 400


# --- Restore ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_restore_user_to_original_name(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("restoreme", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    response = await admin_client.post(f"/api/users/{user_id}/restore", json={})
    assert response.status_code == 200
    assert response.json()["username"] == "restoreme"

    rows = await db.execute_fetchall(
        "SELECT deleted_at, original_username FROM users WHERE id = ?", (user_id,)
    )
    assert rows[0]["deleted_at"] is None
    assert rows[0]["original_username"] is None


@pytest.mark.asyncio
async def test_restore_conflict_requires_new_name(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("clashy", hash_password("pw"), "editor"),
    )
    old_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{old_id}")

    # Someone else grabs the name in the meantime.
    await admin_client.post(
        "/api/users",
        json={"username": "clashy", "password": "pw12345", "role": "editor"},
    )

    conflict = await admin_client.post(
        f"/api/users/{old_id}/restore", json={}
    )
    assert conflict.status_code == 409

    renamed = await admin_client.post(
        f"/api/users/{old_id}/restore", json={"username": "clashy-v2"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["username"] == "clashy-v2"


@pytest.mark.asyncio
async def test_restore_rejects_reserved_prefix(admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("reserved-target", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    response = await admin_client.post(
        f"/api/users/{user_id}/restore", json={"username": "__deleted_x"}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_restore_nonexistent_returns_404(admin_client):
    response = await admin_client.post("/api/users/999999/restore", json={})
    assert response.status_code == 404


# --- FK integrity preserved by soft-delete --------------------------------


@pytest.mark.asyncio
async def test_soft_delete_preserves_authorship(admin_client, db):
    """Hard-deleting a user who created a page used to fail on an FK.
    Soft-delete keeps the row so pages.created_by still resolves."""
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("author", hash_password("pw"), "editor"),
    )
    author_id = cursor.lastrowid

    page_cursor = await db.execute(
        "INSERT INTO pages (slug, title, content_md, created_by) VALUES (?, ?, ?, ?)",
        ("authored-page", "Authored", "hello", author_id),
    )
    page_id = page_cursor.lastrowid
    await db.commit()

    response = await admin_client.delete(f"/api/users/{author_id}")
    assert response.status_code == 204

    rows = await db.execute_fetchall(
        "SELECT created_by FROM pages WHERE id = ?", (page_id,)
    )
    assert rows[0]["created_by"] == author_id


# --- Public profile (GET /api/users/{username}/profile) -------------------


async def _seed_profile_user(db, *, username="profileuser", display_name="Profile User"):
    cursor = await db.execute(
        """INSERT INTO users (username, password_hash, role, display_name)
           VALUES (?, ?, 'editor', ?)""",
        (username, hash_password("pw"), display_name),
    )
    await db.commit()
    user_id = cursor.lastrowid
    token = create_token(user_id, username, "editor")
    return user_id, token


@pytest.mark.asyncio
async def test_profile_unknown_user_404(auth_client):
    response = await auth_client.get("/api/users/no-such-user/profile")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_profile_soft_deleted_user_404(auth_client, admin_client, db):
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("ghost", hash_password("pw"), "editor"),
    )
    user_id = cursor.lastrowid
    await db.commit()
    await admin_client.delete(f"/api/users/{user_id}")

    response = await auth_client.get("/api/users/ghost/profile")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_profile_requires_real_user_blocks_anonymous(monkeypatch, db):
    """Even with ANONYMOUS_READ on, profiles are gated — guests would
    otherwise be enumerating the user roster."""
    monkeypatch.setattr(settings, "ANONYMOUS_READ", True)
    await _seed_profile_user(db, username="anonseen")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/users/anonseen/profile")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_profile_returns_identity_and_activity(admin_client, auth_client, db):
    user_id, token = await _seed_profile_user(db, username="alice", display_name="Alice")

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as alice_client:
        # Alice creates, updates, comments on a page.
        created = await alice_client.post("/api/pages", json={
            "title": "Alice Page", "content_md": "v1", "slug": "alice-page",
        })
        assert created.status_code in (200, 201)
        page = created.json()
        await alice_client.put(f"/api/pages/alice-page", json={
            "title": "Alice Page", "content_md": "v2", "base_version": page["version"],
        })
        await alice_client.post(f"/api/pages/alice-page/comments", json={"content": "hi"})

    response = await auth_client.get("/api/users/alice/profile")
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "alice"
    assert body["display_name"] == "Alice"
    assert body["role"] == "editor"

    actions = [a["action"] for a in body["recent_activity"]]
    # Most-recent first; commented happened last.
    assert actions[:3] == ["commented", "updated", "created"]
    for entry in body["recent_activity"][:3]:
        assert entry["page_slug"] == "alice-page"
        assert entry["page_title"] == "Alice Page"
    # Comment entry exposes comment_id for deep-linking.
    assert "comment_id" in body["recent_activity"][0]


@pytest.mark.asyncio
async def test_profile_only_surfaces_whitelisted_actions(auth_client, db):
    user_id, _ = await _seed_profile_user(db, username="noisy")
    page_cursor = await db.execute(
        "INSERT INTO pages (slug, title, content_md, created_by) VALUES (?, ?, ?, ?)",
        ("noisy-page", "Noisy", "x", user_id),
    )
    page_id = page_cursor.lastrowid
    # Plant one of every action type. Only created/updated/commented should
    # surface; deleted/granted/token_created etc. must be filtered out.
    for action in ("created", "updated", "commented", "deleted", "granted", "token_created"):
        target_type = "page" if action != "token_created" else "token"
        target_id = page_id if action != "token_created" else 1
        await db.execute(
            """INSERT INTO activity_log (user_id, action, target_type, target_id, metadata)
               VALUES (?, ?, ?, ?, NULL)""",
            (user_id, action, target_type, target_id),
        )
    await db.commit()
    # Direct INSERTs bypass the page-create code path that normally invalidates
    # the readable cache; flush so the new page shows up for the caller.
    invalidate_readable_cache()

    response = await auth_client.get("/api/users/noisy/profile")
    assert response.status_code == 200
    actions = {a["action"] for a in response.json()["recent_activity"]}
    assert actions == {"created", "updated", "commented"}


@pytest.mark.asyncio
async def test_profile_activity_filtered_by_caller_acl(admin_client, db):
    """Activity on pages the *caller* can't read must not leak into the timeline."""
    actor_id, _ = await _seed_profile_user(db, username="actor")

    # `actor` creates a page that only admin will be able to read after we
    # pin a per-page ACL row to the admin user.
    page_cursor = await db.execute(
        "INSERT INTO pages (slug, title, content_md, created_by) VALUES (?, ?, ?, ?)",
        ("secret-page", "Secret", "x", actor_id),
    )
    page_id = page_cursor.lastrowid
    await db.execute(
        """INSERT INTO activity_log (user_id, action, target_type, target_id, metadata)
           VALUES (?, 'created', 'page', ?, NULL)""",
        (actor_id, page_id),
    )

    # Set up a viewer-role caller; ACL anchor on the page restricts read to
    # admin only (we grant 'read' to a sentinel principal that isn't this caller).
    viewer_cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
        ("outsider", hash_password("pw")),
    )
    outsider_id = viewer_cursor.lastrowid
    # Pin an ACL anchor that lists nobody the outsider matches → outsider gets 'none'.
    await db.execute(
        """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
           VALUES (?, 'user', ?, 'write')""",
        (page_id, actor_id),
    )
    await db.commit()
    invalidate_readable_cache()

    outsider_token = create_token(outsider_id, "outsider", "editor")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {outsider_token}"},
    ) as outsider_client:
        response = await outsider_client.get("/api/users/actor/profile")
    assert response.status_code == 200
    slugs = [a["page_slug"] for a in response.json()["recent_activity"]]
    assert "secret-page" not in slugs

    # Sanity: admin (bypasses ACL) does see it.
    admin_response = await admin_client.get("/api/users/actor/profile")
    assert admin_response.status_code == 200
    admin_slugs = [a["page_slug"] for a in admin_response.json()["recent_activity"]]
    assert "secret-page" in admin_slugs


@pytest.mark.asyncio
async def test_profile_returns_bio(auth_client, db):
    user_id, _ = await _seed_profile_user(db, username="biouser")
    await db.execute(
        "UPDATE users SET bio = ? WHERE id = ?",
        ("Hi I'm bio. See [[home]]", user_id),
    )
    await db.commit()

    response = await auth_client.get("/api/users/biouser/profile")
    assert response.status_code == 200
    body = response.json()
    assert body["bio"] == "Hi I'm bio. See [[home]]"


@pytest.mark.asyncio
async def test_auth_profile_round_trips_bio(auth_client):
    # display_name + bio go in
    response = await auth_client.put(
        "/api/auth/profile", json={"bio": "My short intro **md**"}
    )
    assert response.status_code == 200
    assert response.json()["bio"] == "My short intro **md**"

    # GET reflects the saved value
    fetched = await auth_client.get("/api/auth/profile")
    assert fetched.status_code == 200
    assert fetched.json()["bio"] == "My short intro **md**"


@pytest.mark.asyncio
async def test_auth_profile_bio_length_capped(auth_client):
    too_long = "x" * 1001
    response = await auth_client.put("/api/auth/profile", json={"bio": too_long})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_auth_profile_can_clear_bio(auth_client):
    await auth_client.put("/api/auth/profile", json={"bio": "something"})
    cleared = await auth_client.put("/api/auth/profile", json={"bio": ""})
    assert cleared.status_code == 200
    assert cleared.json()["bio"] == ""


@pytest.mark.asyncio
async def test_profile_drops_activity_on_deleted_pages(auth_client, db):
    user_id, _ = await _seed_profile_user(db, username="haunted")
    # Page exists, soft-deleted; activity row points at it. The join on
    # `pages.deleted_at IS NULL` should drop the row.
    page_cursor = await db.execute(
        """INSERT INTO pages (slug, title, content_md, created_by, deleted_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        ("profile-haunted-page", "Haunted", "x", user_id),
    )
    page_id = page_cursor.lastrowid
    await db.execute(
        """INSERT INTO activity_log (user_id, action, target_type, target_id, metadata)
           VALUES (?, 'updated', 'page', ?, NULL)""",
        (user_id, page_id),
    )
    await db.commit()
    invalidate_readable_cache()

    response = await auth_client.get("/api/users/haunted/profile")
    assert response.status_code == 200
    slugs = [a["page_slug"] for a in response.json()["recent_activity"]]
    assert "profile-haunted-page" not in slugs
