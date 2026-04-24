"""Tests for the AI chat router.

The upstream LLM call is mocked — we never hit a real provider in CI. The
most important test is test_ai_acl_filter: it proves retrieval respects
page ACLs so AI responses can't leak content from pages the caller cannot
read.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from app.auth import create_token
from app.config import settings
from app.database import get_db
from app.main import app


# ── helpers ────────────────────────────────────────────────────────────


async def _get_or_create_user(db, username, role):
    rows = await db.execute_fetchall(
        "SELECT id, role FROM users WHERE username = ?", (username,)
    )
    if rows:
        return {"id": rows[0]["id"], "username": username, "role": rows[0]["role"]}
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, 'x', ?)",
        (username, role),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "username": username, "role": role}


def _token_client(user: dict) -> AsyncClient:
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


async def _add_acl(db, page_id, principal_type, principal_id, permission):
    await db.execute(
        """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
           VALUES (?, ?, ?, ?)""",
        (page_id, principal_type, principal_id, permission),
    )
    await db.commit()


class _FakeStreamResponse:
    """Mimics the async-context-manager returned by httpx.AsyncClient.stream."""

    def __init__(self, status_code: int, lines: list[str]):
        self.status_code = status_code
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def aread(self):
        return b""

    async def aiter_lines(self):
        for line in self._lines:
            yield line


def _mock_httpx_client(status_code=200, lines=None):
    """Build a MagicMock that replaces httpx.AsyncClient for one call."""
    if lines is None:
        lines = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" world"}}]}',
            "data: [DONE]",
        ]

    fake_client = MagicMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    fake_client.stream = MagicMock(
        return_value=_FakeStreamResponse(status_code, lines)
    )
    return fake_client


@pytest.fixture
def ai_enabled(monkeypatch):
    """Turn the feature on with a dummy key for the duration of a test."""
    monkeypatch.setattr(settings, "AI_ENABLED", True)
    monkeypatch.setattr(settings, "AI_API_KEY", SecretStr("test-key"))
    monkeypatch.setattr(settings, "AI_MODEL", "test-model")
    # Reset the rate-limit bucket between tests so they don't interfere.
    from app.routers import ai as ai_router
    ai_router._rate_buckets.clear()
    yield
    ai_router._rate_buckets.clear()


# ── status endpoint ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_reports_disabled_when_flag_off(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "AI_ENABLED", False)
    resp = await auth_client.get("/api/ai/status")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


@pytest.mark.asyncio
async def test_status_reports_enabled(auth_client, ai_enabled):
    resp = await auth_client.get("/api/ai/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is True
    assert data["model"] == "test-model"


@pytest.mark.asyncio
async def test_status_disabled_when_key_missing(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "AI_ENABLED", True)
    monkeypatch.setattr(settings, "AI_API_KEY", SecretStr(""))
    resp = await auth_client.get("/api/ai/status")
    assert resp.json()["enabled"] is False


# ── guard tests ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_disabled_returns_404(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "AI_ENABLED", False)
    resp = await auth_client.post("/api/ai/chat", json={"message": "hi"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_chat_missing_key_returns_503(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "AI_ENABLED", True)
    monkeypatch.setattr(settings, "AI_API_KEY", SecretStr(""))
    resp = await auth_client.post("/api/ai/chat", json={"message": "hi"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_chat_unauthenticated_returns_401():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post("/api/ai/chat", json={"message": "hi"})
    assert resp.status_code == 401


# ── retrieval and ACL ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_no_matching_pages_returns_422(auth_client, ai_enabled):
    # Unique token that won't hit any page.
    resp = await auth_client.post(
        "/api/ai/chat",
        json={"message": "zxqvnonsensetokenaiunique42 please"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_ai_acl_filter(ai_enabled):
    """The critical test: a user without read access must not see a
    restricted page in the retrieved citations. If this fails, AI responses
    could leak content from ACL-protected pages.
    """
    db = await get_db()
    alice = await _get_or_create_user(db, "ai_acl_alice", "editor")
    bob = await _get_or_create_user(db, "ai_acl_bob", "editor")

    # Create both pages via HTTP so FTS5 index is populated.
    async with _token_client(alice) as client:
        r = await client.post(
            "/api/pages",
            json={
                "title": "AI Secret Doc",
                "slug": "ai-acl-secret-doc",
                "content_md": "This page contains aiuniquekeyword123 confidential info.",
            },
        )
        assert r.status_code == 201
        secret_page_id = r.json()["id"]

        r2 = await client.post(
            "/api/pages",
            json={
                "title": "AI Public Doc",
                "slug": "ai-acl-public-doc",
                "content_md": "This page also mentions aiuniquekeyword123 publicly.",
            },
        )
        assert r2.status_code == 201

    # Restrict the secret page to Alice only.
    await _add_acl(db, secret_page_id, "user", alice["id"], "read")

    fake = _mock_httpx_client()
    with patch("app.routers.ai.httpx.AsyncClient", return_value=fake):
        # Alice sees both pages.
        async with _token_client(alice) as client:
            r_alice = await client.post(
                "/api/ai/chat",
                json={"message": "aiuniquekeyword123"},
            )
        assert r_alice.status_code == 200
        citations_a = _extract_citations(r_alice.text)
        slugs_a = {c["slug"] for c in citations_a}
        assert "ai-acl-secret-doc" in slugs_a
        assert "ai-acl-public-doc" in slugs_a

        # Bob only sees the public page. The secret page MUST NOT leak.
        async with _token_client(bob) as client:
            r_bob = await client.post(
                "/api/ai/chat",
                json={"message": "aiuniquekeyword123"},
            )
        assert r_bob.status_code == 200
        citations_b = _extract_citations(r_bob.text)
        slugs_b = {c["slug"] for c in citations_b}
        assert "ai-acl-secret-doc" not in slugs_b, (
            "ACL leak: Bob retrieved a page Alice restricted"
        )
        assert "ai-acl-public-doc" in slugs_b


def _extract_citations(sse_body: str) -> list[dict]:
    for line in sse_body.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: "):].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "citations":
            return obj.get("citations", [])
    return []


# ── streaming format ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_streams_sse(auth_client, ai_enabled):
    # Seed a page so retrieval succeeds.
    await auth_client.post(
        "/api/pages",
        json={
            "title": "Stream Test",
            "slug": "ai-stream-test",
            "content_md": "aistreamtestkeyword content here.",
        },
    )

    fake = _mock_httpx_client(
        lines=[
            'data: {"choices":[{"delta":{"content":"Hi"}}]}',
            'data: {"choices":[{"delta":{"content":" there"}}]}',
            "data: [DONE]",
        ]
    )
    with patch("app.routers.ai.httpx.AsyncClient", return_value=fake):
        resp = await auth_client.post(
            "/api/ai/chat",
            json={"message": "aistreamtestkeyword"},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    body = resp.text
    # Citations event first, then the LLM chunks, then [DONE].
    assert '"type": "citations"' in body
    assert '"Hi"' in body
    assert '" there"' in body
    assert "[DONE]" in body


@pytest.mark.asyncio
async def test_chat_upstream_error_surfaces_as_sse_event(auth_client, ai_enabled):
    await auth_client.post(
        "/api/pages",
        json={
            "title": "Err Test",
            "slug": "ai-err-test",
            "content_md": "aierrtestkeyword content.",
        },
    )

    fake = _mock_httpx_client(status_code=401, lines=[])
    with patch("app.routers.ai.httpx.AsyncClient", return_value=fake):
        resp = await auth_client.post(
            "/api/ai/chat",
            json={"message": "aierrtestkeyword"},
        )
    assert resp.status_code == 200  # HTTP 200 with an error SSE event inside
    assert '"error"' in resp.text
    assert "upstream 401" in resp.text


@pytest.mark.asyncio
async def test_chat_upstream_timeout(auth_client, ai_enabled):
    await auth_client.post(
        "/api/pages",
        json={
            "title": "Timeout Test",
            "slug": "ai-timeout-test",
            "content_md": "aitimeouttestkeyword content.",
        },
    )

    fake_client = MagicMock()
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)

    def _raise_timeout(*a, **kw):
        raise httpx.TimeoutException("slow")

    fake_client.stream = MagicMock(side_effect=_raise_timeout)

    with patch("app.routers.ai.httpx.AsyncClient", return_value=fake_client):
        resp = await auth_client.post(
            "/api/ai/chat",
            json={"message": "aitimeouttestkeyword"},
        )
    assert resp.status_code == 200
    assert "upstream timeout" in resp.text


# ── rate limiting ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_rate_limit(auth_client, ai_enabled, monkeypatch):
    # Tight limit for a deterministic test.
    monkeypatch.setattr(settings, "AI_RATE_LIMIT_PER_HOUR", 2)

    await auth_client.post(
        "/api/pages",
        json={
            "title": "RL Test",
            "slug": "ai-rl-test",
            "content_md": "airatelimitkeyword content here.",
        },
    )

    fake = _mock_httpx_client()
    with patch("app.routers.ai.httpx.AsyncClient", return_value=fake):
        r1 = await auth_client.post(
            "/api/ai/chat", json={"message": "airatelimitkeyword"}
        )
        r2 = await auth_client.post(
            "/api/ai/chat", json={"message": "airatelimitkeyword"}
        )
        r3 = await auth_client.post(
            "/api/ai/chat", json={"message": "airatelimitkeyword"}
        )

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r3.status_code == 429
