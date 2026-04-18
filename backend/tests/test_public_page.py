"""Tests for the public read-only page feature.

Covers:
- /api/public/pages/{slug} (success, 404, soft-delete, drawio inline, HTML strip)
- PUT /api/pages/{slug} with is_public (auth required, activity log, version unchanged)
- Rate limit and view_count invariants
"""
import pytest

from app.routers import public as public_router


def _reset_rate_limit():
    public_router._access_log.clear()


@pytest.fixture(autouse=True)
def clear_rate_limit():
    _reset_rate_limit()
    yield
    _reset_rate_limit()


@pytest.mark.asyncio
async def test_non_public_page_returns_404(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Secret Page",
        "content_md": "internal only",
        "slug": "public-404",
    })
    res = await client.get("/api/public/pages/public-404")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_public_page_returns_content(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Public Hello",
        "content_md": "# Hello world",
        "slug": "public-hello",
    })
    res = await auth_client.put("/api/pages/public-hello", json={"is_public": True})
    assert res.status_code == 200
    assert res.json()["is_public"] is True

    res = await client.get("/api/public/pages/public-hello")
    assert res.status_code == 200
    data = res.json()
    assert data["slug"] == "public-hello"
    assert data["title"] == "Public Hello"
    assert data["content_md"] == "# Hello world"
    assert "updated_at" in data
    assert "author_name" in data
    assert data["diagrams"] == {}


@pytest.mark.asyncio
async def test_public_page_soft_deleted_returns_404(auth_client, admin_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Public Deleted",
        "content_md": "bye",
        "slug": "public-del",
    })
    await auth_client.put("/api/pages/public-del", json={"is_public": True})
    # Admin can soft-delete any page
    res = await admin_client.delete("/api/pages/public-del")
    assert res.status_code == 200

    res = await client.get("/api/public/pages/public-del")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_enumeration_protection(auth_client, client):
    """A non-existent slug and a private slug must return identical responses."""
    await auth_client.post("/api/pages", json={
        "title": "Private",
        "content_md": "x",
        "slug": "private-page",
    })
    res_missing = await client.get("/api/public/pages/this-slug-does-not-exist")
    res_private = await client.get("/api/public/pages/private-page")
    assert res_missing.status_code == res_private.status_code == 404
    assert res_missing.json() == res_private.json()


@pytest.mark.asyncio
async def test_html_comments_stripped(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Comment Page",
        "content_md": "visible\n<!-- secret internal note -->\nmore",
        "slug": "public-comment",
    })
    await auth_client.put("/api/pages/public-comment", json={"is_public": True})

    res = await client.get("/api/public/pages/public-comment")
    assert res.status_code == 200
    body = res.json()
    assert "secret" not in body["content_md"]
    assert "visible" in body["content_md"]


@pytest.mark.asyncio
async def test_drawio_inline(auth_client, client, db):
    await auth_client.post("/api/pages", json={
        "title": "Diagram Page",
        "content_md": "before ::drawio[42] after",
        "slug": "public-diag",
    })
    await auth_client.put("/api/pages/public-diag", json={"is_public": True})

    await db.execute(
        "INSERT INTO diagrams (id, name, xml_data, svg_cache) VALUES (?, ?, ?, ?)",
        (42, "test", "<mxfile/>", "<svg>hi</svg>"),
    )
    await db.commit()

    res = await client.get("/api/public/pages/public-diag")
    assert res.status_code == 200
    body = res.json()
    assert body["diagrams"] == {"42": "<svg>hi</svg>"}


@pytest.mark.asyncio
async def test_drawio_without_svg_cache_omitted(auth_client, client, db):
    await auth_client.post("/api/pages", json={
        "title": "Diagram No SVG",
        "content_md": "before ::drawio[77] after",
        "slug": "public-diag-missing",
    })
    await auth_client.put("/api/pages/public-diag-missing", json={"is_public": True})

    await db.execute(
        "INSERT INTO diagrams (id, name, xml_data, svg_cache) VALUES (?, ?, ?, ?)",
        (77, "test", "<mxfile/>", None),
    )
    await db.commit()

    res = await client.get("/api/public/pages/public-diag-missing")
    assert res.status_code == 200
    assert "77" not in res.json()["diagrams"]


@pytest.mark.asyncio
async def test_no_drawio_empty_dict(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "No Diagrams",
        "content_md": "just text",
        "slug": "public-no-diag",
    })
    await auth_client.put("/api/pages/public-no-diag", json={"is_public": True})

    res = await client.get("/api/public/pages/public-no-diag")
    assert res.status_code == 200
    assert res.json()["diagrams"] == {}


@pytest.mark.asyncio
async def test_unauthenticated_put_is_public_rejected(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "NoAuth",
        "content_md": "x",
        "slug": "public-noauth",
    })
    res = await client.put("/api/pages/public-noauth", json={"is_public": True})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_make_public_logs_activity(auth_client, db):
    await auth_client.post("/api/pages", json={
        "title": "Logged Public",
        "content_md": "x",
        "slug": "public-log",
    })
    res = await auth_client.put("/api/pages/public-log", json={"is_public": True})
    assert res.status_code == 200

    rows = await db.execute_fetchall(
        """SELECT action FROM activity_log
           WHERE target_type = 'page'
             AND action IN ('made_public', 'made_private')
             AND target_id = (SELECT id FROM pages WHERE slug = 'public-log')
           ORDER BY id DESC"""
    )
    actions = [r["action"] for r in rows]
    assert "made_public" in actions


@pytest.mark.asyncio
async def test_make_private_logs_activity(auth_client, db):
    await auth_client.post("/api/pages", json={
        "title": "Logged Private",
        "content_md": "x",
        "slug": "public-log-priv",
    })
    await auth_client.put("/api/pages/public-log-priv", json={"is_public": True})
    res = await auth_client.put("/api/pages/public-log-priv", json={"is_public": False})
    assert res.status_code == 200

    rows = await db.execute_fetchall(
        """SELECT action FROM activity_log
           WHERE target_type = 'page'
             AND action IN ('made_public', 'made_private')
             AND target_id = (SELECT id FROM pages WHERE slug = 'public-log-priv')
           ORDER BY id DESC"""
    )
    actions = [r["action"] for r in rows]
    assert "made_private" in actions
    assert "made_public" in actions


@pytest.mark.asyncio
async def test_is_public_toggle_does_not_bump_version(auth_client):
    res = await auth_client.post("/api/pages", json={
        "title": "Ver Test",
        "content_md": "stable",
        "slug": "public-ver",
    })
    assert res.json()["version"] == 1

    res = await auth_client.put("/api/pages/public-ver", json={"is_public": True})
    assert res.status_code == 200
    assert res.json()["version"] == 1

    res = await auth_client.put("/api/pages/public-ver", json={"is_public": False})
    assert res.status_code == 200
    assert res.json()["version"] == 1


@pytest.mark.asyncio
async def test_view_count_unchanged_by_public_endpoint(auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "View Count Public",
        "content_md": "x",
        "slug": "public-vc",
    })
    await auth_client.put("/api/pages/public-vc", json={"is_public": True})

    # Snapshot the current view_count via one authed GET (dedup makes
    # subsequent same-user GETs inert inside the cooldown window).
    before = (await auth_client.get("/api/pages/public-vc")).json()["view_count"]

    # Public reads must not touch view_count.
    for _ in range(5):
        res = await client.get("/api/public/pages/public-vc")
        assert res.status_code == 200

    after = (await auth_client.get("/api/pages/public-vc")).json()["view_count"]
    assert after == before


@pytest.mark.asyncio
async def test_rate_limit_returns_429(auth_client, client, monkeypatch):
    await auth_client.post("/api/pages", json={
        "title": "RL",
        "content_md": "x",
        "slug": "public-rl",
    })
    await auth_client.put("/api/pages/public-rl", json={"is_public": True})

    # Shrink the limit to make the test fast
    monkeypatch.setattr(public_router, "_RATE_LIMIT_MAX", 3)
    _reset_rate_limit()

    for _ in range(3):
        res = await client.get("/api/public/pages/public-rl")
        assert res.status_code == 200

    res = await client.get("/api/public/pages/public-rl")
    assert res.status_code == 429
