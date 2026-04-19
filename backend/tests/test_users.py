import pytest

from app.auth import hash_password


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
