"""Watch endpoints must honour page ACL.

Before the fix, GET/POST /api/pages/{slug}/watch only checked page
existence, so a user denied via ACL could confirm the slug existed and
subscribe to notifications on pages they couldn't read. The policy is
now: no read permission → indistinguishable 404.
"""
import pytest

from app.auth import create_token, hash_password
from app.database import get_db


@pytest.mark.asyncio
async def test_watch_endpoints_404_for_user_without_read_permission(admin_client):
    # Admin creates a page with an explicit ACL that grants access only to
    # one specific user. Any other user must get 404 on every watch verb.
    page = await admin_client.post(
        "/api/pages", json={"title": "watch-acl-secret", "content_md": "hush"}
    )
    assert page.status_code == 201
    slug = page.json()["slug"]
    page_id = page.json()["id"]

    db = await get_db()
    # Provision two editors.
    alice_hash = hash_password("pw")
    await db.execute(
        "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
        ("watch-alice", alice_hash),
    )
    bob_hash = hash_password("pw")
    await db.execute(
        "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
        ("watch-bob", bob_hash),
    )
    await db.commit()
    alice_rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE username = 'watch-alice'"
    )
    alice_id = alice_rows[0]["id"]
    bob_rows = await db.execute_fetchall("SELECT id FROM users WHERE username = 'watch-bob'")
    bob_id = bob_rows[0]["id"]

    # Explicit ACL: only Alice can read.
    acl_res = await admin_client.put(
        f"/api/pages/{slug}/acl",
        json={"rows": [{"principal_type": "user", "principal_id": alice_id, "permission": "read"}]},
    )
    assert acl_res.status_code == 200, acl_res.text

    bob_token = create_token(bob_id, "watch-bob", "editor")
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    from httpx import AsyncClient, ASGITransport
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=bob_headers
    ) as bob:
        r = await bob.get(f"/api/pages/{slug}/watch")
        assert r.status_code == 404
        r = await bob.post(f"/api/pages/{slug}/watch")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_watch_endpoints_work_for_authorized_user(admin_client):
    page = await admin_client.post(
        "/api/pages", json={"title": "watch-acl-open", "content_md": "hi"}
    )
    slug = page.json()["slug"]

    # No ACL → open to every editor by default.
    status = await admin_client.get(f"/api/pages/{slug}/watch")
    assert status.status_code == 200
    assert status.json()["watching"] is False

    subscribe = await admin_client.post(f"/api/pages/{slug}/watch")
    assert subscribe.status_code == 200
    assert subscribe.json()["watching"] is True
