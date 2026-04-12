import pytest
from app.auth import hash_password

@pytest.mark.asyncio
async def test_admin_create_user(admin_client):
    # Create User
    response = await admin_client.post("/api/users", json={
        "username": "newuser",
        "password": "newpassword",
        "role": "editor"
    })
    assert response.status_code == 201
    assert response.json()["username"] == "newuser"

@pytest.mark.asyncio
async def test_login(client, auth_user):
    # Login
    response = await client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "testpass"
    })
    assert response.status_code == 200
    assert "user" in response.json()
    assert "token" in response.cookies

@pytest.mark.asyncio
async def test_login_invalid(client):
    response = await client.post("/api/auth/login", json={
        "username": "nonexistent",
        "password": "wrongpassword"
    })
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_me(auth_client):
    response = await auth_client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["username"] == "testuser"

@pytest.mark.asyncio
async def test_change_password(auth_client):
    response = await auth_client.put("/api/auth/password", json={
        "old_password": "testpass",
        "new_password": "newtestpass"
    })
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Verify we can login with new password
    response = await auth_client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "newtestpass"
    })
    assert response.status_code == 200
