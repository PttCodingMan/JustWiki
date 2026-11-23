import pytest

from app.database import get_db


@pytest.mark.asyncio
async def test_same_user_repeat_does_not_increment(auth_client):
    created = await auth_client.post("/api/pages", json={
        "title": "View Dedup Same User",
        "content_md": "x",
    })
    slug = created.json()["slug"]

    first = await auth_client.get(f"/api/pages/{slug}")
    assert first.status_code == 200
    count_after_first = first.json()["view_count"]

    second = await auth_client.get(f"/api/pages/{slug}")
    assert second.status_code == 200
    assert second.json()["view_count"] == count_after_first

    third = await auth_client.get(f"/api/pages/{slug}")
    assert third.json()["view_count"] == count_after_first


@pytest.mark.asyncio
async def test_different_users_each_count(auth_client, admin_client):
    created = await auth_client.post("/api/pages", json={
        "title": "View Dedup Two Users",
        "content_md": "x",
    })
    slug = created.json()["slug"]

    r1 = await auth_client.get(f"/api/pages/{slug}")
    first_count = r1.json()["view_count"]

    r2 = await admin_client.get(f"/api/pages/{slug}")
    assert r2.json()["view_count"] == first_count + 1

    # Each user's refresh still dedups against their own slot.
    r1b = await auth_client.get(f"/api/pages/{slug}")
    assert r1b.json()["view_count"] == first_count + 1


@pytest.mark.asyncio
async def test_expired_dedup_counts_again(auth_client):
    created = await auth_client.post("/api/pages", json={
        "title": "View Dedup Expired",
        "content_md": "x",
    })
    slug = created.json()["slug"]

    r1 = await auth_client.get(f"/api/pages/{slug}")
    count_after_first = r1.json()["view_count"]

    r2 = await auth_client.get(f"/api/pages/{slug}")
    assert r2.json()["view_count"] == count_after_first

    # Backdate every dedup row for this page past the cooldown.
    db = await get_db()
    page_rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ?", (slug,)
    )
    page_id = page_rows[0]["id"]
    await db.execute(
        "UPDATE view_dedup SET last_viewed_at = 0 WHERE page_id = ?", (page_id,)
    )
    await db.commit()

    r3 = await auth_client.get(f"/api/pages/{slug}")
    assert r3.json()["view_count"] == count_after_first + 1


@pytest.mark.asyncio
async def test_dedup_row_is_hashed(auth_client):
    """Row stores a sha256 hex digest, not a raw (user, page) pair."""
    created = await auth_client.post("/api/pages", json={
        "title": "View Dedup Hash",
        "content_md": "x",
    })
    slug = created.json()["slug"]
    await auth_client.get(f"/api/pages/{slug}")

    db = await get_db()
    page_rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ?", (slug,)
    )
    page_id = page_rows[0]["id"]
    rows = await db.execute_fetchall(
        "SELECT dedup_key FROM view_dedup WHERE page_id = ?", (page_id,)
    )
    assert rows, "expected a dedup row after first view"
    key = rows[0]["dedup_key"]
    assert len(key) == 64
    assert all(c in "0123456789abcdef" for c in key)
    # The structured plaintext form must never hit disk.
    assert "|" not in key and "u:" not in key
