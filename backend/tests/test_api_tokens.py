"""Tests for personal API tokens.

Covers happy path (create → list → use → revoke), viewer lockout, cross-user
revocation, token-via-token creation refusal, expiry enforcement, and
last_used bookkeeping.
"""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import API_TOKEN_PREFIX, create_token, hash_api_token, hash_password
from app.main import app


@pytest.mark.asyncio
async def test_create_and_use_token(auth_client, db):
    """Create a token via the API and use it to hit an authed endpoint."""
    r = await auth_client.post("/api/auth/tokens", json={"name": "ci-bot"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "ci-bot"
    token = body["token"]
    assert token.startswith(API_TOKEN_PREFIX)
    assert body["prefix"] == token[:12]
    # Expiry should default to ~30 days; at minimum it must be in the future.
    assert body["expires_at"] is not None

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as tc:
        me = await tc.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["username"] == "testuser"

    # last_used should have been bumped by the lookup.
    rows = await db.execute_fetchall(
        "SELECT last_used FROM api_tokens WHERE token_hash = ?",
        (hash_api_token(token),),
    )
    assert rows[0]["last_used"] is not None


@pytest.mark.asyncio
async def test_list_tokens(auth_client):
    await auth_client.post("/api/auth/tokens", json={"name": "one"})
    await auth_client.post("/api/auth/tokens", json={"name": "two"})
    r = await auth_client.get("/api/auth/tokens")
    assert r.status_code == 200
    names = [t["name"] for t in r.json()]
    assert "one" in names and "two" in names
    # Plaintext must never be returned on list.
    for t in r.json():
        assert "token" not in t


@pytest.mark.asyncio
async def test_revoke_then_use_fails(auth_client):
    r = await auth_client.post("/api/auth/tokens", json={"name": "short-lived"})
    token_id = r.json()["id"]
    token = r.json()["token"]

    rv = await auth_client.delete(f"/api/auth/tokens/{token_id}")
    assert rv.status_code == 204

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as tc:
        me = await tc.get("/api/auth/me")
        assert me.status_code == 401

    # Double revoke is a no-op (still 204-equivalent; endpoint returns 204).
    rv2 = await auth_client.delete(f"/api/auth/tokens/{token_id}")
    assert rv2.status_code == 204


@pytest.mark.asyncio
async def test_expired_token_rejected(auth_client, db):
    r = await auth_client.post(
        "/api/auth/tokens", json={"name": "brief", "expires_in_days": 1}
    )
    token = r.json()["token"]
    token_id = r.json()["id"]

    # Force the expiry into the past.
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    await db.execute(
        "UPDATE api_tokens SET expires_at = ? WHERE id = ?", (past, token_id)
    )
    await db.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as tc:
        me = await tc.get("/api/auth/me")
        assert me.status_code == 401


@pytest.mark.asyncio
async def test_never_expires(auth_client):
    r = await auth_client.post(
        "/api/auth/tokens", json={"name": "forever", "expires_in_days": 0}
    )
    assert r.status_code == 201
    assert r.json()["expires_at"] is None


@pytest.mark.asyncio
async def test_viewer_cannot_create_token(client, db):
    pw = hash_password("pw")
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer')",
        ("view-only", pw),
    )
    await db.commit()
    viewer_id = cursor.lastrowid

    jwt_token = create_token(viewer_id, "view-only", "viewer")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {jwt_token}"},
    ) as vc:
        r = await vc.post("/api/auth/tokens", json={"name": "nope"})
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_cannot_revoke_other_users_token(auth_client, admin_client, db):
    """A user asking about someone else's token id sees 404, not 403."""
    r = await admin_client.post("/api/auth/tokens", json={"name": "admin-tok"})
    admin_token_id = r.json()["id"]

    r2 = await auth_client.delete(f"/api/auth/tokens/{admin_token_id}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_token_cannot_mint_another_token(auth_client):
    r = await auth_client.post("/api/auth/tokens", json={"name": "parent"})
    token = r.json()["token"]

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as tc:
        r2 = await tc.post("/api/auth/tokens", json={"name": "child"})
        assert r2.status_code == 403


@pytest.mark.asyncio
async def test_list_excludes_other_users(auth_client, admin_client):
    await admin_client.post("/api/auth/tokens", json={"name": "admins-only"})
    r = await auth_client.get("/api/auth/tokens")
    assert r.status_code == 200
    names = [t["name"] for t in r.json()]
    assert "admins-only" not in names


@pytest.mark.asyncio
async def test_bad_expiry_rejected(auth_client):
    r = await auth_client.post(
        "/api/auth/tokens", json={"name": "too-long", "expires_in_days": 9999}
    )
    assert r.status_code == 422
    r = await auth_client.post(
        "/api/auth/tokens", json={"name": "negative", "expires_in_days": -1}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_token_from_deleted_user_rejected(auth_client, db):
    r = await auth_client.post("/api/auth/tokens", json={"name": "doomed"})
    token = r.json()["token"]
    rows = await db.execute_fetchall(
        "SELECT user_id FROM api_tokens WHERE token_hash = ?",
        (hash_api_token(token),),
    )
    owner_id = rows[0]["user_id"]

    await db.execute(
        "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", (owner_id,)
    )
    await db.commit()

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {token}"},
        ) as tc:
            me = await tc.get("/api/auth/me")
            assert me.status_code == 401
    finally:
        # Restore the fixture user so later tests still see them.
        await db.execute(
            "UPDATE users SET deleted_at = NULL WHERE id = ?", (owner_id,)
        )
        await db.commit()
