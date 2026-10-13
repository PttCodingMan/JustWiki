"""Tests for /api/settings — site-wide branding and homepage knobs."""
from datetime import datetime, timezone

import pytest
from jose import jwt

from app.auth import hash_password
from app.services.site_settings import BOOL_SETTINGS, DEFAULT_SETTINGS, INT_SETTINGS


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
async def reset_knobs(db):
    """The test DB is shared across the session; don't leak non-default
    session/upload/password knobs into later tests."""
    yield
    keys = list(INT_SETTINGS) + list(BOOL_SETTINGS)
    await db.execute(
        f"DELETE FROM site_settings WHERE key IN ({','.join('?' * len(keys))})", keys
    )
    await db.commit()


async def _make_user(db, username: str, password: str = "sessionpass") -> None:
    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
        (username, hash_password(password)),
    )
    await db.commit()


def _token_lifetime(token: str) -> float:
    claims = jwt.get_unverified_claims(token)
    return claims["exp"] - datetime.now(timezone.utc).timestamp()


@pytest.mark.asyncio
async def test_knob_defaults(client):
    data = (await client.get("/api/settings")).json()
    for key, (default, _, _) in INT_SETTINGS.items():
        assert data[key] == default
    for key, default in BOOL_SETTINGS.items():
        assert data[key] is default


@pytest.mark.asyncio
@pytest.mark.parametrize("key", list(INT_SETTINGS))
async def test_put_int_knob_validates_range(admin_client, reset_knobs, key):
    _, lo, hi = INT_SETTINGS[key]
    assert (await admin_client.put("/api/settings", json={key: lo - 1})).status_code == 422
    assert (await admin_client.put("/api/settings", json={key: hi + 1})).status_code == 422
    res = await admin_client.put("/api/settings", json={key: hi})
    assert res.status_code == 200
    assert res.json()[key] == hi


@pytest.mark.asyncio
async def test_put_session_auto_renew_roundtrip(admin_client, reset_knobs):
    res = await admin_client.put("/api/settings", json={"session_auto_renew": True})
    assert res.json()["session_auto_renew"] is True
    res = await admin_client.put("/api/settings", json={"session_auto_renew": False})
    assert res.json()["session_auto_renew"] is False


@pytest.mark.asyncio
async def test_login_uses_configured_session_days(admin_client, client, db, reset_knobs):
    """Both the cookie max_age and the JWT exp follow the admin setting."""
    await _make_user(db, "sessionuser")
    await admin_client.put("/api/settings", json={"session_days": 14})
    res = await client.post(
        "/api/auth/login", json={"username": "sessionuser", "password": "sessionpass"}
    )
    assert res.status_code == 200
    assert f"Max-Age={14 * 86400}" in res.headers["set-cookie"]
    assert 13 * 86400 < _token_lifetime(res.cookies["token"]) <= 14 * 86400


@pytest.mark.asyncio
async def test_me_renews_cookie_only_when_enabled(admin_client, client, db, reset_knobs):
    await _make_user(db, "renewuser")
    res = await client.post(
        "/api/auth/login", json={"username": "renewuser", "password": "sessionpass"}
    )
    assert res.status_code == 200

    # Off by default: /me must not touch the cookie.
    res = await client.get("/api/auth/me")
    assert res.status_code == 200
    assert "set-cookie" not in res.headers

    await admin_client.put(
        "/api/settings", json={"session_auto_renew": True, "session_days": 30}
    )
    res = await client.get("/api/auth/me")
    assert res.status_code == 200
    assert f"Max-Age={30 * 86400}" in res.headers["set-cookie"]
    assert 29 * 86400 < _token_lifetime(res.cookies["token"]) <= 30 * 86400


@pytest.mark.asyncio
async def test_me_does_not_renew_for_bearer(admin_client, auth_client, reset_knobs):
    """Bearer callers don't use the cookie; don't hand them one."""
    await admin_client.put("/api/settings", json={"session_auto_renew": True})
    res = await auth_client.get("/api/auth/me")
    assert res.status_code == 200
    assert "set-cookie" not in res.headers


@pytest.mark.asyncio
async def test_upload_respects_max_upload_mb(admin_client, auth_client, reset_knobs):
    await admin_client.put("/api/settings", json={"max_upload_mb": 1})
    big = b"x" * (1024 * 1024 + 1)
    res = await auth_client.post(
        "/api/media/upload", files={"file": ("big.txt", big, "text/plain")}
    )
    assert res.status_code == 413
    assert "1 MB" in res.json()["detail"]


@pytest.mark.asyncio
async def test_password_min_length_applies_everywhere(admin_client, client, db, reset_knobs):
    await admin_client.put("/api/settings", json={"password_min_length": 12})

    # Admin create
    res = await admin_client.post(
        "/api/users", json={"username": "pwshort", "password": "elevenchars", "role": "editor"}
    )
    assert res.status_code == 400
    res = await admin_client.post(
        "/api/users", json={"username": "pwlong", "password": "twelve-chars", "role": "editor"}
    )
    assert res.status_code == 201
    user_id = res.json()["id"]

    # Admin reset
    res = await admin_client.put(f"/api/users/{user_id}", json={"password": "short"})
    assert res.status_code == 400

    # Self-service change
    login = await client.post(
        "/api/auth/login", json={"username": "pwlong", "password": "twelve-chars"}
    )
    assert login.status_code == 200
    res = await client.put(
        "/api/auth/password",
        json={"old_password": "twelve-chars", "new_password": "elevenchars"},
        headers={"Origin": "http://localhost:5173"},  # CSRF check on cookie auth
    )
    assert res.status_code == 400
    assert "12" in res.json()["detail"]
