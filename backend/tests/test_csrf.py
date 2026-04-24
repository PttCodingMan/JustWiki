"""CSRF middleware regression tests.

Written after a review caught the previous implementation exempting any
request that carried ``Authorization: Bearer ...`` — including clearly
invalid Bearer values. ``get_current_user`` falls back to the session
cookie on an invalid Bearer, so that bypass let a cross-origin attacker
skip CSRF protection simply by attaching a bogus header alongside the
victim's cookie.

The current policy: no session cookie = no CSRF (Bearer/API-token clients
and tests live here). Session cookie present = Origin must be allow-listed,
regardless of whether a Bearer header is also present.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.auth import create_token
from app.main import app


@pytest.mark.asyncio
async def test_bearer_garbage_with_session_cookie_does_not_bypass_csrf(admin_user):
    """Bogus Bearer + victim cookie + evil Origin must be rejected.

    This is the attack the original bypass enabled: the cross-origin page
    sets an arbitrary `Authorization: Bearer xyz` header while the browser
    attaches the session cookie automatically. Previously the middleware
    saw the Bearer prefix and skipped the Origin check.
    """
    token = admin_user["token"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("token", token)
        res = await client.post(
            "/api/pages",
            json={"title": "x", "content_md": "y"},
            headers={
                "Authorization": "Bearer not-a-real-token",
                "Origin": "https://evil.example.com",
            },
        )
    assert res.status_code == 403
    assert "CSRF" in res.json()["detail"]


@pytest.mark.asyncio
async def test_bearer_only_no_cookie_passes(admin_user):
    """Tests and API-token clients set Bearer + no cookie. They must work."""
    token = admin_user["token"]
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={
            "Authorization": f"Bearer {token}",
            "Origin": "https://evil.example.com",
        },
    ) as client:
        res = await client.post(
            "/api/pages",
            json={"title": "csrf-test-bearer-only", "content_md": ""},
        )
    # No cookie → CSRF doesn't apply. Origin can be anything.
    assert res.status_code == 201


@pytest.mark.asyncio
async def test_cookie_mutating_request_without_origin_is_blocked(admin_user):
    """Plain cross-site POST with no Origin but a stolen cookie → 403."""
    token = admin_user["token"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("token", token)
        # No Origin/Referer, no Bearer → fails the allow-list check.
        res = await client.post("/api/pages", json={"title": "x", "content_md": ""})
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_cookie_mutating_request_with_allowed_origin_passes(admin_user):
    """Same-origin request with cookie + allowed Origin → 201."""
    token = admin_user["token"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("token", token)
        res = await client.post(
            "/api/pages",
            json={"title": "csrf-test-allowed-origin", "content_md": ""},
            headers={"Origin": "http://localhost:5173"},
        )
    assert res.status_code == 201


@pytest.mark.asyncio
async def test_safe_method_skips_csrf(admin_user):
    """GET never triggers the Origin check, even with a mismatched Origin."""
    token = admin_user["token"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("token", token)
        res = await client.get(
            "/api/pages", headers={"Origin": "https://evil.example.com"}
        )
    assert res.status_code == 200
