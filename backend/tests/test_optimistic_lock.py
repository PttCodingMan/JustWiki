"""Tests for optimistic-lock behavior on PUT /api/pages/{slug}."""
import pytest


@pytest.mark.asyncio
async def test_new_page_starts_at_version_1(auth_client):
    res = await auth_client.post("/api/pages", json={
        "title": "Lock Start",
        "content_md": "initial",
        "slug": "lock-start",
    })
    assert res.status_code == 201
    assert res.json()["version"] == 1


@pytest.mark.asyncio
async def test_version_bumps_on_content_change(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Lock Bump",
        "content_md": "one",
        "slug": "lock-bump",
    })
    res = await auth_client.put("/api/pages/lock-bump", json={
        "content_md": "two",
        "base_version": 1,
    })
    assert res.status_code == 200
    assert res.json()["version"] == 2

    # Another update bumps again
    res = await auth_client.put("/api/pages/lock-bump", json={
        "content_md": "three",
        "base_version": 2,
    })
    assert res.status_code == 200
    assert res.json()["version"] == 3


@pytest.mark.asyncio
async def test_content_edit_requires_base_version(auth_client):
    # A client that forgets base_version on a content edit must be rejected
    # outright — a silent pass here is exactly the "legacy client loophole"
    # that caused this check to be tightened.
    await auth_client.post("/api/pages", json={
        "title": "Lock Required",
        "content_md": "hi",
        "slug": "lock-required",
    })
    res = await auth_client.put("/api/pages/lock-required", json={
        "content_md": "bye",
    })
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "base_version_required"


@pytest.mark.asyncio
async def test_metadata_edit_does_not_require_base_version(auth_client):
    # Visibility toggles and sort/parent moves don't bump version and can't
    # clobber an editor's draft, so they skip the check by design.
    await auth_client.post("/api/pages", json={
        "title": "Lock Meta",
        "content_md": "body",
        "slug": "lock-meta",
    })
    res = await auth_client.put("/api/pages/lock-meta", json={"is_public": True})
    assert res.status_code == 200
    assert res.json()["version"] == 1


@pytest.mark.asyncio
async def test_version_does_not_bump_on_noop_update(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Lock Noop",
        "content_md": "same",
        "slug": "lock-noop",
    })
    # Only touching parent_id should not bump version — nothing about content changed
    res = await auth_client.put("/api/pages/lock-noop", json={
        "parent_id": None,
    })
    assert res.status_code == 200
    assert res.json()["version"] == 1


@pytest.mark.asyncio
async def test_conflict_when_base_version_stale(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Lock Conflict",
        "content_md": "v1",
        "slug": "lock-conflict",
    })
    # First client saves based on v1 — OK
    res = await auth_client.put("/api/pages/lock-conflict", json={
        "content_md": "first edit",
        "base_version": 1,
    })
    assert res.status_code == 200
    assert res.json()["version"] == 2

    # Second client also thought they were editing v1 → should conflict
    res = await auth_client.put("/api/pages/lock-conflict", json={
        "content_md": "second edit",
        "base_version": 1,
    })
    assert res.status_code == 409
    body = res.json()
    assert body["detail"]["error"] == "conflict"
    assert body["detail"]["current_version"] == 2
    assert body["detail"]["your_version"] == 1


@pytest.mark.asyncio
async def test_matching_base_version_allows_update(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Lock OK",
        "content_md": "v1",
        "slug": "lock-ok",
    })
    res = await auth_client.put("/api/pages/lock-ok", json={
        "content_md": "updated",
        "base_version": 1,
    })
    assert res.status_code == 200
    assert res.json()["version"] == 2


@pytest.mark.asyncio
async def test_get_page_does_not_bump_version(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Lock View",
        "content_md": "x",
        "slug": "lock-view",
    })
    for _ in range(3):
        res = await auth_client.get("/api/pages/lock-view")
        assert res.status_code == 200
    assert res.json()["version"] == 1
    # View dedup collapses the 3 refreshes by the same user into one count.
    assert res.json()["view_count"] == 1
