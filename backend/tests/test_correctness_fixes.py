"""Regression tests for the correctness-fix pass."""
import pytest


@pytest.mark.asyncio
async def test_backlink_survives_target_trash_edit_restore(auth_client):
    """An inbound backlink must not be lost when the target is trashed,
    the source is re-saved, and the target is later restored."""
    target = await auth_client.post("/api/pages", json={
        "title": "Target", "content_md": "target body",
    })
    target_slug = target.json()["slug"]
    source = await auth_client.post("/api/pages", json={
        "title": "Source", "content_md": f"see [[{target_slug}]]",
    })
    source_slug = source.json()["slug"]

    # Backlink is present initially.
    res = await auth_client.get(f"/api/pages/{target_slug}/backlinks")
    assert any(b["slug"] == source_slug for b in res.json())

    # Trash the target, then re-save the source while the target is gone.
    await auth_client.delete(f"/api/pages/{target_slug}")
    src = await auth_client.get(f"/api/pages/{source_slug}")
    await auth_client.put(f"/api/pages/{source_slug}", json={
        "content_md": f"see [[{target_slug}]] still",
        "base_version": src.json()["version"],
    })

    # Restore the target — the inbound backlink from source is intact.
    restored = await auth_client.post(f"/api/trash/{target_slug}/restore")
    assert restored.status_code in (200, 201)
    res = await auth_client.get(f"/api/pages/{target_slug}/backlinks")
    assert any(b["slug"] == source_slug for b in res.json()), \
        "backlink from source was lost across trash/edit/restore"


@pytest.mark.asyncio
async def test_revert_requires_base_version(auth_client):
    """Revert must reject a request that omits base_version (no silent fallback)."""
    created = await auth_client.post("/api/pages", json={
        "title": "Rev", "content_md": "v1",
    })
    slug = created.json()["slug"]
    await auth_client.put(f"/api/pages/{slug}", json={
        "content_md": "v2", "base_version": 1,
    })

    # Missing base_version → 400.
    res = await auth_client.post(f"/api/pages/{slug}/revert/1", json={})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "base_version_required"

    # Stale base_version → 409.
    res = await auth_client.post(
        f"/api/pages/{slug}/revert/1", json={"base_version": 1}
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_update_rejects_nonexistent_parent(auth_client):
    """Setting parent_id to a nonexistent page is a clean 400, not a 500."""
    created = await auth_client.post("/api/pages", json={
        "title": "Child", "content_md": "x",
    })
    slug = created.json()["slug"]
    cur = await auth_client.get(f"/api/pages/{slug}")
    res = await auth_client.put(f"/api/pages/{slug}", json={
        "parent_id": 999999, "base_version": cur.json()["version"],
    })
    assert res.status_code == 400
