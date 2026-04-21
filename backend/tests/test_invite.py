"""Admin → Invite (SSO) endpoint.

Validates shell-user creation for invitation-only mode: the row exists with
a disabled password hash ('!') and the configured role/email, and the
callers who would be expected to fail (non-admin, invalid input) are
rejected.
"""
import pytest


@pytest.mark.asyncio
async def test_invite_creates_shell_user(admin_client, db):
    response = await admin_client.post(
        "/api/users/invite",
        json={"email": "invitee@example.com", "role": "editor", "display_name": "Invitee"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "invitee@example.com"
    assert body["role"] == "editor"
    assert body["display_name"] == "Invitee"
    # Username derived from email local part
    assert body["username"] == "invitee"

    rows = await db.execute_fetchall(
        "SELECT password_hash FROM users WHERE id = ?", (body["id"],)
    )
    assert rows[0]["password_hash"] == "!"


@pytest.mark.asyncio
async def test_invite_rejects_invalid_email(admin_client):
    response = await admin_client.post(
        "/api/users/invite", json={"email": "not-an-email", "role": "editor"}
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_invite_rejects_bad_role(admin_client):
    response = await admin_client.post(
        "/api/users/invite", json={"email": "x@y.com", "role": "superuser"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_invite_duplicate_email_conflicts(admin_client, db):
    await admin_client.post(
        "/api/users/invite", json={"email": "dupe@example.com", "role": "editor"},
    )
    clash = await admin_client.post(
        "/api/users/invite", json={"email": "dupe@example.com", "role": "editor"},
    )
    assert clash.status_code == 409


@pytest.mark.asyncio
async def test_invite_autosuffixes_colliding_username(admin_client, db):
    # Pre-existing user with the username derived from the email's local part
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("clash", "!", "editor"),
    )
    await db.commit()

    response = await admin_client.post(
        "/api/users/invite",
        json={"email": "clash@example.com", "role": "editor"},
    )
    assert response.status_code == 201
    assert response.json()["username"] == "clash-2"


@pytest.mark.asyncio
async def test_invite_explicit_username_collision_rejected(admin_client, db):
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("taken", "!", "editor"),
    )
    await db.commit()

    response = await admin_client.post(
        "/api/users/invite",
        json={"email": "fresh@example.com", "username": "taken", "role": "editor"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_invite_requires_admin(auth_client):
    response = await auth_client.post(
        "/api/users/invite", json={"email": "x@y.com", "role": "editor"},
    )
    assert response.status_code == 403
