"""Regression tests for the correctness-fix pass."""
import pytest


@pytest.mark.asyncio
async def test_backlink_survives_target_trash_edit_restore(auth_client):
    """An inbound backlink must not be lost when the target is trashed,
    the source is re-saved, and the target is later restored."""
    await auth_client.post("/api/pages", json={
        "title": "Target", "content_md": "target body", "slug": "bl-target",
    })
    await auth_client.post("/api/pages", json={
        "title": "Source", "content_md": "see [[bl-target]]", "slug": "bl-source",
    })

    # Backlink is present initially.
    res = await auth_client.get("/api/pages/bl-target/backlinks")
    assert any(b["slug"] == "bl-source" for b in res.json())

    # Trash the target, then re-save the source while the target is gone.
    await auth_client.delete("/api/pages/bl-target")
    src = await auth_client.get("/api/pages/bl-source")
    await auth_client.put("/api/pages/bl-source", json={
        "content_md": "see [[bl-target]] still",
        "base_version": src.json()["version"],
    })

    # Restore the target — the inbound backlink from source is intact.
    restored = await auth_client.post("/api/trash/bl-target/restore")
    assert restored.status_code in (200, 201)
    res = await auth_client.get("/api/pages/bl-target/backlinks")
    assert any(b["slug"] == "bl-source" for b in res.json()), \
        "backlink from source was lost across trash/edit/restore"


@pytest.mark.asyncio
async def test_revert_requires_base_version(auth_client):
    """Revert must reject a request that omits base_version (no silent fallback)."""
    await auth_client.post("/api/pages", json={
        "title": "Rev", "content_md": "v1", "slug": "rev-page",
    })
    await auth_client.put("/api/pages/rev-page", json={
        "content_md": "v2", "base_version": 1,
    })

    # Missing base_version → 400.
    res = await auth_client.post("/api/pages/rev-page/revert/1", json={})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "base_version_required"

    # Stale base_version → 409.
    res = await auth_client.post(
        "/api/pages/rev-page/revert/1", json={"base_version": 1}
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_update_rejects_nonexistent_parent(auth_client):
    """Setting parent_id to a nonexistent page is a clean 400, not a 500."""
    await auth_client.post("/api/pages", json={
        "title": "Child", "content_md": "x", "slug": "parent-child",
    })
    cur = await auth_client.get("/api/pages/parent-child")
    res = await auth_client.put("/api/pages/parent-child", json={
        "parent_id": 999999, "base_version": cur.json()["version"],
    })
    assert res.status_code == 400
