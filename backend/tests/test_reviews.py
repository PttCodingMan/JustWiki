"""Periodic page review: settings, verify, listing, due reminders."""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import create_token, hash_password
from app.main import app
from app.services.page_review import review_status, send_due_reminders


async def _make_page(client, title):
    res = await client.post("/api/pages", json={"title": title, "content_md": "body"})
    assert res.status_code == 201, res.text
    return res.json()


async def _make_user(db, username, role="editor"):
    await db.execute(
        "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, hash_password("pw"), role),
    )
    await db.commit()
    rows = await db.execute_fetchall("SELECT id FROM users WHERE username = ?", (username,))
    return rows[0]["id"]


def _client_for(user_id, username, role="editor"):
    token = create_token(user_id, username, role)
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


# ── review_status ──────────────────────────────────────────────────────


def test_review_status_buckets():
    now = datetime(2026, 1, 31, 12, 0, tzinfo=timezone.utc)
    fmt = "%Y-%m-%d %H:%M:%S"
    ok = review_status((now - timedelta(days=1)).strftime(fmt), 30, now)
    assert ok["status"] == "ok"
    assert ok["days_left"] == 29

    # 30-day interval: due_soon window is 30 // 4 = 7 days.
    soon = review_status((now - timedelta(days=25)).strftime(fmt), 30, now)
    assert soon["status"] == "due_soon"

    overdue = review_status((now - timedelta(days=33)).strftime(fmt), 30, now)
    assert overdue["status"] == "overdue"
    assert overdue["days_left"] == -3

    # Time left rounds up; time overdue rounds down but is at least 1 day.
    fresh = review_status((now - timedelta(minutes=5)).strftime(fmt), 30, now)
    assert fresh["days_left"] == 30
    late = review_status((now - timedelta(days=30, hours=2)).strftime(fmt), 30, now)
    assert late["status"] == "overdue"
    assert late["days_left"] == -1
    later = review_status((now - timedelta(days=40, hours=5)).strftime(fmt), 30, now)
    assert later["days_left"] == -10

    # Weekly review isn't permanently "due soon": window is 7 // 4 = 1 day.
    weekly = review_status((now - timedelta(days=2)).strftime(fmt), 7, now)
    assert weekly["status"] == "ok"


# ── API ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_enable_verify_and_disable_review(auth_client, auth_user):
    page = await _make_page(auth_client, "review-basic")
    slug = page["slug"]

    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.json()["review"] is None

    res = await auth_client.put(
        f"/api/pages/{slug}/review",
        json={"owner_id": auth_user["user"]["id"], "interval_days": 90},
    )
    assert res.status_code == 200, res.text
    review = res.json()
    assert review["interval_days"] == 90
    assert review["owner_id"] == auth_user["user"]["id"]
    assert review["status"] == "ok"
    assert review["reviewed_by"] == auth_user["user"]["id"]

    # Exposed on the page payload too.
    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.json()["review"]["interval_days"] == 90

    res = await auth_client.post(f"/api/pages/{slug}/review/verify")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    res = await auth_client.delete(f"/api/pages/{slug}/review")
    assert res.status_code == 200
    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.json()["review"] is None

    # Verify without review enabled is a 400, not a silent no-op.
    res = await auth_client.post(f"/api/pages/{slug}/review/verify")
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_verify_logs_activity(auth_client, db):
    page = await _make_page(auth_client, "review-activity")
    slug = page["slug"]
    await auth_client.put(f"/api/pages/{slug}/review", json={"interval_days": 30})
    await auth_client.post(f"/api/pages/{slug}/review/verify")
    rows = await db.execute_fetchall(
        "SELECT action FROM activity_log WHERE target_id = ? AND action = 'verified'",
        (page["id"],),
    )
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_interval_bounds(auth_client):
    page = await _make_page(auth_client, "review-bounds")
    for bad in (0, 3651):
        res = await auth_client.put(
            f"/api/pages/{page['slug']}/review", json={"interval_days": bad}
        )
        assert res.status_code == 422


@pytest.mark.asyncio
async def test_owner_must_be_able_to_read_page(admin_client, db):
    page = await _make_page(admin_client, "review-owner-acl")
    reader_id = await _make_user(db, "review-reader")
    outsider_id = await _make_user(db, "review-outsider")
    res = await admin_client.put(
        f"/api/pages/{page['slug']}/acl",
        json={"rows": [{"principal_type": "user", "principal_id": reader_id, "permission": "read"}]},
    )
    assert res.status_code == 200, res.text

    res = await admin_client.put(
        f"/api/pages/{page['slug']}/review",
        json={"owner_id": outsider_id, "interval_days": 30},
    )
    assert res.status_code == 400

    res = await admin_client.put(
        f"/api/pages/{page['slug']}/review",
        json={"owner_id": 999999, "interval_days": 30},
    )
    assert res.status_code == 400

    res = await admin_client.put(
        f"/api/pages/{page['slug']}/review",
        json={"owner_id": reader_id, "interval_days": 30},
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_read_only_user_cannot_configure_or_verify(admin_client, db):
    page = await _make_page(admin_client, "review-readonly")
    slug = page["slug"]
    await admin_client.put(f"/api/pages/{slug}/review", json={"interval_days": 30})
    viewer_id = await _make_user(db, "review-viewer", role="viewer")
    async with _client_for(viewer_id, "review-viewer", "viewer") as viewer:
        assert (await viewer.post(f"/api/pages/{slug}/review/verify")).status_code == 403
        res = await viewer.put(f"/api/pages/{slug}/review", json={"interval_days": 5})
        assert res.status_code == 403
        assert (await viewer.delete(f"/api/pages/{slug}/review")).status_code == 403
        # But can see the status.
        assert (await viewer.get(f"/api/pages/{slug}")).json()["review"]["interval_days"] == 30


@pytest.mark.asyncio
async def test_list_reviews_respects_acl_and_scope(admin_client, db):
    owner_id = await _make_user(db, "review-lister")
    other_id = await _make_user(db, "review-lister-other")

    mine = await _make_page(admin_client, "review-list-mine")
    hidden = await _make_page(admin_client, "review-list-hidden")
    await admin_client.put(
        f"/api/pages/{mine['slug']}/review", json={"owner_id": owner_id, "interval_days": 30}
    )
    await admin_client.put(
        f"/api/pages/{hidden['slug']}/review", json={"interval_days": 30}
    )
    # Only `other` may read the hidden page.
    res = await admin_client.put(
        f"/api/pages/{hidden['slug']}/acl",
        json={"rows": [{"principal_type": "user", "principal_id": other_id, "permission": "read"}]},
    )
    assert res.status_code == 200

    async with _client_for(owner_id, "review-lister") as client:
        res = await client.get("/api/reviews")
        slugs = {i["slug"] for i in res.json()["items"]}
        assert mine["slug"] in slugs
        assert hidden["slug"] not in slugs

        res = await client.get("/api/reviews", params={"scope": "mine"})
        items = res.json()["items"]
        assert [i["slug"] for i in items] == [mine["slug"]]
        assert items[0]["owner_name"] == "review-lister"


@pytest.mark.asyncio
async def test_list_reviews_rejects_guest(client):
    res = await client.get("/api/reviews")
    assert res.status_code == 401


# ── Reminders ──────────────────────────────────────────────────────────


async def _backdate(db, page_id, days):
    await db.execute(
        "UPDATE page_reviews SET reviewed_at = datetime('now', ?) WHERE page_id = ?",
        (f"-{days} days", page_id),
    )
    await db.commit()


async def _review_notifications(db, user_id, page_id):
    return await db.execute_fetchall(
        "SELECT * FROM notifications WHERE user_id = ? AND page_id = ? AND event = 'page.review_due'",
        (user_id, page_id),
    )


@pytest.mark.asyncio
async def test_due_review_notifies_owner_once_per_cycle(admin_client, auth_user, db):
    owner_id = auth_user["user"]["id"]
    page = await _make_page(admin_client, "review-due")
    await admin_client.put(
        f"/api/pages/{page['slug']}/review", json={"owner_id": owner_id, "interval_days": 30}
    )

    # Not due yet → nothing.
    await send_due_reminders(db)
    assert await _review_notifications(db, owner_id, page["id"]) == []

    await _backdate(db, page["id"], 31)
    await send_due_reminders(db)
    rows = await _review_notifications(db, owner_id, page["id"])
    assert len(rows) == 1
    assert rows[0]["actor_id"] is None

    # Second check in the same cycle doesn't re-notify.
    await send_due_reminders(db)
    assert len(await _review_notifications(db, owner_id, page["id"])) == 1

    # Verifying starts a new cycle; once that one is due, notify again.
    await admin_client.post(f"/api/pages/{page['slug']}/review/verify")
    await _backdate(db, page["id"], 31)
    await send_due_reminders(db)
    assert len(await _review_notifications(db, owner_id, page["id"])) == 2


@pytest.mark.asyncio
async def test_due_review_falls_back_to_creator_and_skips_trashed(admin_client, admin_user, db):
    admin_id = admin_user["user"]["id"]
    page = await _make_page(admin_client, "review-no-owner")
    await admin_client.put(f"/api/pages/{page['slug']}/review", json={"interval_days": 10})
    await _backdate(db, page["id"], 11)
    await send_due_reminders(db)
    assert len(await _review_notifications(db, admin_id, page["id"])) == 1

    trashed = await _make_page(admin_client, "review-trashed")
    await admin_client.put(f"/api/pages/{trashed['slug']}/review", json={"interval_days": 10})
    await admin_client.delete(f"/api/pages/{trashed['slug']}")
    await _backdate(db, trashed["id"], 11)
    await send_due_reminders(db)
    assert await _review_notifications(db, admin_id, trashed["id"]) == []
