import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import create_token, hash_password
from app.database import get_db
from app.main import app

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


@pytest.mark.asyncio
async def test_change_password_wrong_old_returns_400(auth_client):
    """Regression: supplying the wrong old password must not 200 / 500.

    Earlier this path had no negative-case test and a bug would go
    unnoticed — especially the sentinel-hash edge case below.
    """
    res = await auth_client.put(
        "/api/auth/password",
        json={"old_password": "definitely-wrong", "new_password": "sufficiently-long"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_change_password_sso_only_account_returns_400():
    """SSO-only accounts carry ``password_hash = '!'``. `bcrypt.checkpw`
    raises on that value, which used to surface as a 500 (leaking the
    account shape). The handler now returns a clear 400 explaining
    that the account is SSO-managed.
    """
    db = await get_db()
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, '!', 'editor')",
        ("sso-only-user",),
    )
    await db.commit()
    rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE username = 'sso-only-user'"
    )
    uid = rows[0]["id"]
    token = create_token(uid, "sso-only-user", "editor")

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        res = await client.put(
            "/api/auth/password",
            json={"old_password": "anything", "new_password": "long-enough-pw"},
        )
    assert res.status_code == 400
    assert "SSO" in res.json()["detail"] or "LDAP" in res.json()["detail"]
