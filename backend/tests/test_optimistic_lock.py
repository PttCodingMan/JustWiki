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
    # Update with no base_version (legacy client) still works
    res = await auth_client.put("/api/pages/lock-bump", json={
        "content_md": "two",
    })
    assert res.status_code == 200
    assert res.json()["version"] == 2

    # Another update bumps again
    res = await auth_client.put("/api/pages/lock-bump", json={
        "content_md": "three",
    })
    assert res.status_code == 200
    assert res.json()["version"] == 3


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
    assert res.json()["view_count"] == 3
