"""Tests for /api/settings — site-wide branding and homepage knobs."""
from datetime import datetime, timezone

import pytest
from jose import jwt

from app.auth import hash_password
from app.routers.settings import DEFAULT_SESSION_DAYS, DEFAULT_SETTINGS, MAX_SESSION_DAYS


@pytest.mark.asyncio
async def test_get_settings_returns_defaults_when_empty(client):
    """A fresh DB has no overrides; the response must mirror DEFAULT_SETTINGS."""
    res = await client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()
    for key, value in DEFAULT_SETTINGS.items():
        assert data[key] == value


@pytest.mark.asyncio
async def test_get_settings_is_anonymous(client):
    """The Login page renders before auth, so this endpoint must not require it."""
    # client has no Authorization header
    res = await client.get("/api/settings")
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_put_settings_requires_admin(auth_client):
    res = await auth_client.put("/api/settings", json={"site_name": "MyWiki"})
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_put_settings_requires_auth(client):
    res = await client.put("/api/settings", json={"site_name": "MyWiki"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_put_settings_persists_overrides(admin_client, client):
    res = await admin_client.put(
        "/api/settings",
        json={
            "site_name": "TeamWiki",
            "login_subtitle": "Internal docs",
            "home_page_slug": "welcome",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["site_name"] == "TeamWiki"
    assert data["login_subtitle"] == "Internal docs"
    assert data["home_page_slug"] == "welcome"
    # Untouched keys still report defaults
    assert data["footer_text"] == DEFAULT_SETTINGS["footer_text"]

    # Anonymous fetch sees the new values too
    res2 = await client.get("/api/settings")
    assert res2.status_code == 200
    assert res2.json()["site_name"] == "TeamWiki"


@pytest.mark.asyncio
async def test_put_empty_string_clears_override(admin_client):
    """Sending '' should restore the built-in default rather than store empty."""
    await admin_client.put("/api/settings", json={"site_name": "Override"})
    res = await admin_client.put("/api/settings", json={"site_name": ""})
    assert res.status_code == 200
    assert res.json()["site_name"] == DEFAULT_SETTINGS["site_name"]


@pytest.mark.asyncio
async def test_put_strips_whitespace(admin_client):
    res = await admin_client.put("/api/settings", json={"site_name": "  Trimmed  "})
    assert res.status_code == 200
    assert res.json()["site_name"] == "Trimmed"


@pytest.mark.asyncio
async def test_put_unknown_key_is_ignored(admin_client):
    """Pydantic strips unknown fields rather than 400-ing — they just no-op."""
    res = await admin_client.put(
        "/api/settings",
        json={"site_name": "OK", "bogus_key": "evil"},
    )
    assert res.status_code == 200
    assert "bogus_key" not in res.json()


@pytest.mark.asyncio
async def test_put_partial_update_leaves_other_keys_alone(admin_client):
    await admin_client.put(
        "/api/settings",
        json={"site_name": "First", "footer_text": "Footer1"},
    )
    res = await admin_client.put("/api/settings", json={"site_name": "Second"})
    assert res.status_code == 200
    data = res.json()
    assert data["site_name"] == "Second"
    assert data["footer_text"] == "Footer1"


@pytest.fixture
async def reset_session_days(db):
    """The test DB is shared across the session; don't leak a non-default
    session length into tests that log in later."""
    yield
    await db.execute("DELETE FROM site_settings WHERE key = 'session_days'")
    await db.commit()


@pytest.mark.asyncio
async def test_session_days_defaults_to_one_day(client):
    res = await client.get("/api/settings")
    assert res.json()["session_days"] == DEFAULT_SESSION_DAYS


@pytest.mark.asyncio
async def test_put_session_days_validates_range(admin_client, reset_session_days):
    assert (await admin_client.put("/api/settings", json={"session_days": 0})).status_code == 422
    assert (
        await admin_client.put("/api/settings", json={"session_days": MAX_SESSION_DAYS + 1})
    ).status_code == 422
    res = await admin_client.put("/api/settings", json={"session_days": 30})
    assert res.status_code == 200
    assert res.json()["session_days"] == 30


@pytest.mark.asyncio
async def test_login_uses_configured_session_days(admin_client, client, db, reset_session_days):
    """Both the cookie max_age and the JWT exp follow the admin setting."""
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
        ("sessionuser", hash_password("sessionpass")),
    )
    await db.commit()
    await admin_client.put("/api/settings", json={"session_days": 14})
    res = await client.post(
        "/api/auth/login", json={"username": "sessionuser", "password": "sessionpass"}
    )
    assert res.status_code == 200
    set_cookie = res.headers["set-cookie"]
    assert f"Max-Age={14 * 86400}" in set_cookie

    token = res.cookies["token"]
    claims = jwt.get_unverified_claims(token)
    lifetime = claims["exp"] - datetime.now(timezone.utc).timestamp()
    assert 13 * 86400 < lifetime <= 14 * 86400
