"""Tests for page watching and notification dispatch."""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.auth import create_token, hash_password


async def _make_second_user(db, username: str = "second", role: str = "user"):
    rows = await db.execute_fetchall("SELECT id FROM users WHERE username = ?", (username,))
    if rows:
        row = await db.execute_fetchall(
            "SELECT id, username, role FROM users WHERE id = ?", (rows[0]["id"],),
        )
        return dict(row[0])
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, hash_password("pw"), role),
    )
    await db.commit()
    return {"id": cursor.lastrowid, "username": username, "role": role}


async def _client_for(user: dict):
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_watch_unwatch_roundtrip(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Watch Me",
        "content_md": "body",
        "slug": "watch-me",
    })

    # Initially not watching
    res = await auth_client.get("/api/pages/watch-me/watch")
    assert res.status_code == 200
    assert res.json()["watching"] is False

    # Watch
    res = await auth_client.post("/api/pages/watch-me/watch")
    assert res.status_code == 200
    assert res.json()["watching"] is True

    # Verify
    res = await auth_client.get("/api/pages/watch-me/watch")
    assert res.json()["watching"] is True
    assert res.json()["watcher_count"] == 1

    # Unwatch
    res = await auth_client.delete("/api/pages/watch-me/watch")
    assert res.status_code == 200
    assert res.json()["watching"] is False


@pytest.mark.asyncio
async def test_watching_twice_is_idempotent(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Watch Idem",
        "content_md": "body",
        "slug": "watch-idem",
    })
    for _ in range(3):
        res = await auth_client.post("/api/pages/watch-idem/watch")
        assert res.status_code == 200
    res = await auth_client.get("/api/pages/watch-idem/watch")
    assert res.json()["watcher_count"] == 1


@pytest.mark.asyncio
async def test_update_creates_notification_for_watcher(auth_client, db):
    # First user creates a page
    await auth_client.post("/api/pages", json={
        "title": "Notify Page",
        "content_md": "initial",
        "slug": "notify-page",
    })

    # Second user watches it
    second = await _make_second_user(db, "watcher1")
    async with await _client_for(second) as second_client:
        await second_client.post("/api/pages/notify-page/watch")

        # First user edits — second user should get a notification
        res = await auth_client.put("/api/pages/notify-page", json={
            "content_md": "updated body",
            "base_version": 1,
        })
        assert res.status_code == 200

        # Second user now has an unread notification
        res = await second_client.get("/api/notifications")
        assert res.status_code == 200
        data = res.json()
        assert data["unread_count"] >= 1
        assert any(
            item["event"] == "page.updated" and item["page_slug"] == "notify-page"
            for item in data["items"]
        )


@pytest.mark.asyncio
async def test_actor_does_not_notify_self(auth_client, db):
    await auth_client.post("/api/pages", json={
        "title": "Self Notify",
        "content_md": "initial",
        "slug": "self-notify",
    })
    # Author watches their own page
    await auth_client.post("/api/pages/self-notify/watch")

    # Count notifications before update
    res = await auth_client.get("/api/notifications", params={"unread_only": True})
    before = res.json()["unread_count"]

    # Author edits
    await auth_client.put("/api/pages/self-notify", json={
        "content_md": "new",
        "base_version": 1,
    })

    # Should NOT get a notification for your own edit
    res = await auth_client.get("/api/notifications", params={"unread_only": True})
    after = res.json()["unread_count"]
    assert after == before, f"Expected no new notifications for self-edit; got {after - before}"


@pytest.mark.asyncio
async def test_mark_all_read(auth_client, db):
    # Use a fresh watcher so this test is isolated
    await auth_client.post("/api/pages", json={
        "title": "Mark Read",
        "content_md": "body",
        "slug": "mark-read",
    })
    second = await _make_second_user(db, "watcher2")
    async with await _client_for(second) as second_client:
        await second_client.post("/api/pages/mark-read/watch")
        await auth_client.put(
            "/api/pages/mark-read",
            json={"content_md": "v2", "base_version": 1},
        )

        res = await second_client.get("/api/notifications", params={"unread_only": True})
        assert res.json()["unread_count"] >= 1

        await second_client.post("/api/notifications/read-all")

        res = await second_client.get("/api/notifications", params={"unread_only": True})
        assert res.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_webhook_crud_admin_only(admin_client, auth_client):
    # Non-admin cannot list webhooks
    res = await auth_client.get("/api/webhooks")
    assert res.status_code == 403

    # Admin creates webhook
    res = await admin_client.post("/api/webhooks", json={
        "name": "slack",
        "url": "https://example.com/hook",
        "events": "page.updated,page.created",
    })
    assert res.status_code == 201
    hook = res.json()
    hook_id = hook["id"]
    assert hook["name"] == "slack"
    assert hook["is_active"] == 1

    # List
    res = await admin_client.get("/api/webhooks")
    assert any(h["id"] == hook_id for h in res.json())

    # Update
    res = await admin_client.put(f"/api/webhooks/{hook_id}", json={"is_active": False})
    assert res.status_code == 200
    assert res.json()["is_active"] == 0

    # Invalid URL rejected
    res = await admin_client.post("/api/webhooks", json={
        "name": "bad",
        "url": "not-a-url",
        "events": "page.updated",
    })
    assert res.status_code == 400

    # Delete
    res = await admin_client.delete(f"/api/webhooks/{hook_id}")
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_watch_deleted_page_404(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Watch Deleted",
        "content_md": "body",
        "slug": "watch-deleted",
    })
    await auth_client.delete("/api/pages/watch-deleted")
    res = await auth_client.post("/api/pages/watch-deleted/watch")
    assert res.status_code == 404
