"""Regression tests for the fixes in bug.md.

Each test exercises one of the reported defects and verifies the patched
behavior so the hole doesn't reopen later.
"""
import io
import sqlite3
import struct
import tempfile
import zipfile
from pathlib import Path

import pytest

from app.config import settings
from app.routers.pages import _would_create_parent_cycle, slugify
from app.database import get_db


# ---------------------------------------------------------------------------
# 2.1 Page tree cycle prevention
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_page_rejects_self_parent(auth_client):
    res = await auth_client.post("/api/pages", json={
        "title": "SelfParent", "content_md": "x", "slug": "self-parent",
    })
    page = res.json()

    # Setting parent_id to its own id must fail.
    bad = await auth_client.put(
        f"/api/pages/{page['slug']}", json={"parent_id": page["id"]}
    )
    assert bad.status_code == 400
    assert "cycle" in bad.json()["detail"].lower()


@pytest.mark.asyncio
async def test_move_page_rejects_descendant_parent(auth_client):
    # Build A -> B, then try to make A's parent = B. That would put B's
    # ancestor chain through A and form A -> B -> A.
    a = (await auth_client.post("/api/pages", json={
        "title": "CycleA", "content_md": "x", "slug": "cycle-a",
    })).json()
    b = (await auth_client.post("/api/pages", json={
        "title": "CycleB", "content_md": "x", "slug": "cycle-b",
        "parent_id": a["id"],
    })).json()

    res = await auth_client.patch(
        f"/api/pages/{a['slug']}/move", json={"parent_id": b["id"]}
    )
    assert res.status_code == 400
    assert "cycle" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_page_tree_survives_corrupt_cycle(auth_client, db):
    # Manually poke a cycle into the DB that couldn't be inserted via the API,
    # to prove the tree builder doesn't blow the stack on pre-existing bad data.
    a = (await auth_client.post("/api/pages", json={
        "title": "LoopA", "content_md": "x", "slug": "loop-a",
    })).json()
    b = (await auth_client.post("/api/pages", json={
        "title": "LoopB", "content_md": "x", "slug": "loop-b",
        "parent_id": a["id"],
    })).json()
    await db.execute("UPDATE pages SET parent_id = ? WHERE id = ?", (b["id"], a["id"]))
    await db.commit()
    try:
        # Must return, not recurse forever.
        res = await auth_client.get("/api/pages/tree")
        assert res.status_code == 200
    finally:
        await db.execute("UPDATE pages SET parent_id = NULL WHERE id = ?", (a["id"],))
        await db.commit()


@pytest.mark.asyncio
async def test_would_create_parent_cycle_helper(db):
    # Unit-level coverage for the helper, independent of the HTTP layer.
    cursor = await db.execute(
        "INSERT INTO pages (slug, title, content_md, parent_id) VALUES (?, ?, ?, NULL)",
        ("cyc-helper-1", "h1", "x"),
    )
    p1 = cursor.lastrowid
    cursor = await db.execute(
        "INSERT INTO pages (slug, title, content_md, parent_id) VALUES (?, ?, ?, ?)",
        ("cyc-helper-2", "h2", "x", p1),
    )
    p2 = cursor.lastrowid
    await db.commit()

    assert await _would_create_parent_cycle(db, p1, p1) is True   # self
    assert await _would_create_parent_cycle(db, p1, p2) is True   # child
    assert await _would_create_parent_cycle(db, p2, p1) is False  # parent ok
    assert await _would_create_parent_cycle(db, p1, None) is False


# ---------------------------------------------------------------------------
# 2.2 unique_slug race: IntegrityError path is handled
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_page_handles_slug_race(auth_client, db, monkeypatch):
    # Pre-create a page at the exact slug that unique_slug() would pick so
    # that the very next INSERT hits a UNIQUE-constraint error. If the retry
    # loop works, create_page should walk to the next candidate instead of
    # 500ing.
    from app.routers import pages as pages_module

    real_unique_slug = pages_module.unique_slug
    call_count = {"n": 0}

    async def flaky_unique_slug(db_arg, slug):
        call_count["n"] += 1
        # First call: return an already-taken slug so INSERT fails.
        if call_count["n"] == 1:
            return "race-slug-taken"
        return await real_unique_slug(db_arg, slug)

    await auth_client.post("/api/pages", json={
        "title": "blocker", "content_md": "x", "slug": "race-slug-taken",
    })
    monkeypatch.setattr(pages_module, "unique_slug", flaky_unique_slug)

    res = await auth_client.post("/api/pages", json={
        "title": "Racer", "content_md": "x",
    })
    assert res.status_code == 201
    assert res.json()["slug"] != "race-slug-taken"


# ---------------------------------------------------------------------------
# 2.3 Restore atomicity: integrity check rejects bad backups
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_restore_rejects_non_sqlite_payload(admin_client):
    # Build a zip that contains a "just-wiki.db" entry which is NOT a sqlite
    # file. The old code would happily overwrite the live DB; the new code
    # must reject before touching it.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("just-wiki.db", b"this is definitely not sqlite")
    buf.seek(0)

    # Capture the live DB's contents so we can prove it was untouched.
    live_db_path = Path(settings.DB_PATH)
    before = live_db_path.read_bytes() if live_db_path.exists() else b""

    files = {"file": ("bad.zip", buf.read(), "application/zip")}
    res = await admin_client.post("/api/backup/restore", files=files)
    assert res.status_code == 400
    # The original DB file on disk must still be intact. The in-process
    # connection may have been lazily re-opened, so compare bytes.
    after = live_db_path.read_bytes() if live_db_path.exists() else b""
    assert after == before


# ---------------------------------------------------------------------------
# 1.3 CSRF: cookie-auth + cross-origin mutation is blocked
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_csrf_blocks_cross_origin_cookie_post(client, auth_user):
    # Simulate a browser sending the auth cookie from a hostile origin.
    client.cookies.set("token", auth_user["token"])
    try:
        res = await client.post(
            "/api/pages",
            json={"title": "evil", "content_md": "x"},
            headers={"Origin": "https://evil.example.com"},
        )
        assert res.status_code == 403
        assert "csrf" in res.json()["detail"].lower()
    finally:
        client.cookies.clear()


@pytest.mark.asyncio
async def test_csrf_allows_trusted_origin_cookie_post(client, auth_user):
    client.cookies.set("token", auth_user["token"])
    try:
        res = await client.post(
            "/api/pages",
            json={"title": "Friendly", "content_md": "x", "slug": "csrf-ok"},
            headers={"Origin": "http://localhost:5173"},
        )
        assert res.status_code == 201
    finally:
        client.cookies.clear()


@pytest.mark.asyncio
async def test_csrf_allows_bearer_token_without_origin(auth_client):
    # Bearer-token requests aren't cookie-based, so CSRF shouldn't block them
    # regardless of (missing) Origin header. Sanity check that auth_client
    # still mutates freely.
    res = await auth_client.post("/api/pages", json={
        "title": "Bearer OK", "content_md": "x", "slug": "csrf-bearer",
    })
    assert res.status_code == 201


# ---------------------------------------------------------------------------
# 1.4 Private media must not be fetchable without auth
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_private_media_requires_auth(auth_client, client):
    up = await auth_client.post(
        "/api/media/upload",
        files={"file": ("private.png", b"secret-bytes", "image/png")},
    )
    assert up.status_code == 201
    filename = up.json()["filename"]

    # Authenticated fetch still works.
    ok = await auth_client.get(f"/api/media/{filename}")
    assert ok.status_code == 200
    assert ok.content == b"secret-bytes"

    # Anonymous fetch is 404 (not referenced by any public page).
    blocked = await client.get(f"/api/media/{filename}")
    assert blocked.status_code == 404


@pytest.mark.asyncio
async def test_public_referenced_media_fetchable_anonymously(auth_client, client):
    up = await auth_client.post(
        "/api/media/upload",
        files={"file": ("shared.png", b"public-bytes", "image/png")},
    )
    filename = up.json()["filename"]

    # Make a public page that references it.
    page = await auth_client.post("/api/pages", json={
        "title": "MediaHost",
        "content_md": f"![img](/api/media/{filename})",
        "slug": "media-host",
    })
    assert page.status_code == 201
    flip = await auth_client.put(
        "/api/pages/media-host", json={"is_public": True}
    )
    assert flip.status_code == 200

    # Anonymous should now succeed.
    res = await client.get(f"/api/media/{filename}")
    assert res.status_code == 200
    assert res.content == b"public-bytes"
