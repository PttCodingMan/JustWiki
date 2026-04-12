"""Tests for soft delete + trash lifecycle."""
import pytest


@pytest.mark.asyncio
async def test_delete_is_soft(auth_client):
    # Create and soft-delete a page
    await auth_client.post("/api/pages", json={
        "title": "Trash Soft",
        "content_md": "body",
        "slug": "trash-soft",
    })
    res = await auth_client.delete("/api/pages/trash-soft")
    assert res.status_code == 200

    # It should be gone from the normal GET endpoint
    res = await auth_client.get("/api/pages/trash-soft")
    assert res.status_code == 404

    # It should appear in the trash list for the creator
    res = await auth_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert "trash-soft" in slugs


@pytest.mark.asyncio
async def test_trash_hides_from_tree_and_search(auth_client):
    # Create a page then delete it
    await auth_client.post("/api/pages", json={
        "title": "Trash Hidden",
        "content_md": "searchable body 7890",
        "slug": "trash-hidden",
    })
    await auth_client.delete("/api/pages/trash-hidden")

    # Not in tree
    tree = await auth_client.get("/api/pages/tree")
    slugs = [n["slug"] for n in tree.json()]
    assert "trash-hidden" not in slugs

    # Not in search
    res = await auth_client.get("/api/search", params={"q": "7890"})
    slugs = [r["slug"] for r in res.json()["results"]]
    assert "trash-hidden" not in slugs


@pytest.mark.asyncio
async def test_restore_brings_page_back(auth_client):
    await auth_client.post("/api/pages", json={
        "title": "Trash Restore",
        "content_md": "restore body uniqueword42",
        "slug": "trash-restore",
    })
    await auth_client.delete("/api/pages/trash-restore")

    res = await auth_client.post("/api/trash/trash-restore/restore")
    assert res.status_code == 200
    assert res.json()["slug"] == "trash-restore"

    # Now visible again via normal GET
    res = await auth_client.get("/api/pages/trash-restore")
    assert res.status_code == 200

    # And back in search
    res = await auth_client.get("/api/search", params={"q": "uniqueword42"})
    slugs = [r["slug"] for r in res.json()["results"]]
    assert "trash-restore" in slugs


@pytest.mark.asyncio
async def test_restore_nonexistent_404(auth_client):
    res = await auth_client.post("/api/trash/does-not-exist/restore")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_purge_admin_only(auth_client, admin_client):
    await auth_client.post("/api/pages", json={
        "title": "Trash Purge",
        "content_md": "body",
        "slug": "trash-purge",
    })
    await auth_client.delete("/api/pages/trash-purge")

    # Non-admin cannot purge
    res = await auth_client.delete("/api/trash/trash-purge")
    assert res.status_code == 403

    # Admin can
    res = await admin_client.delete("/api/trash/trash-purge")
    assert res.status_code == 204

    # Gone from trash
    res = await admin_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert "trash-purge" not in slugs


@pytest.mark.asyncio
async def test_non_admin_sees_only_own_trash(db, auth_client, admin_client):
    # Admin creates and soft-deletes a page
    await admin_client.post("/api/pages", json={
        "title": "Admin Owned",
        "content_md": "body",
        "slug": "admin-owned",
    })
    await admin_client.delete("/api/pages/admin-owned")

    # Regular user creates and deletes their own
    await auth_client.post("/api/pages", json={
        "title": "User Owned",
        "content_md": "body",
        "slug": "user-owned",
    })
    await auth_client.delete("/api/pages/user-owned")

    # Regular user only sees their own in trash
    res = await auth_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert "user-owned" in slugs
    assert "admin-owned" not in slugs

    # Admin sees everything
    res = await admin_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert "user-owned" in slugs
    assert "admin-owned" in slugs
