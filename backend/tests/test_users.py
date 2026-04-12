import pytest

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
    # Create a user to update
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("updateme", "hash", "editor")
    )
    user_id = cursor.lastrowid
    await db.commit()

    response = await admin_client.put(f"/api/users/{user_id}", json={
        "role": "admin"
    })
    assert response.status_code == 200
    assert response.json()["role"] == "admin"

@pytest.mark.asyncio
async def test_delete_user(admin_client, db):
    # Create a user to delete
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("deleteme", "hash", "editor")
    )
    user_id = cursor.lastrowid
    await db.commit()

    response = await admin_client.delete(f"/api/users/{user_id}")
    assert response.status_code == 204

@pytest.mark.asyncio
async def test_delete_self_fails(admin_client, admin_user):
    user_id = admin_user["user"]["id"]
    response = await admin_client.delete(f"/api/users/{user_id}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot delete yourself"
