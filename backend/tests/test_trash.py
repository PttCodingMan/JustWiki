"""Tests for soft delete + trash lifecycle."""
import pytest


@pytest.mark.asyncio
async def test_delete_is_soft(auth_client):
    # Create and soft-delete a page
    created = await auth_client.post("/api/pages", json={
        "title": "Trash Soft",
        "content_md": "body",
    })
    slug = created.json()["slug"]
    res = await auth_client.delete(f"/api/pages/{slug}")
    assert res.status_code == 200

    # It should be gone from the normal GET endpoint
    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.status_code == 404

    # It should appear in the trash list for the creator
    res = await auth_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert slug in slugs


@pytest.mark.asyncio
async def test_trash_hides_from_tree_and_search(auth_client):
    # Create a page then delete it
    created = await auth_client.post("/api/pages", json={
        "title": "Trash Hidden",
        "content_md": "searchable body 7890",
    })
    slug = created.json()["slug"]
    await auth_client.delete(f"/api/pages/{slug}")

    # Not in tree
    tree = await auth_client.get("/api/pages/tree")
    slugs = [n["slug"] for n in tree.json()]
    assert slug not in slugs

    # Not in search
    res = await auth_client.get("/api/search", params={"q": "7890"})
    slugs = [r["slug"] for r in res.json()["results"]]
    assert slug not in slugs


@pytest.mark.asyncio
async def test_restore_brings_page_back(auth_client):
    created = await auth_client.post("/api/pages", json={
        "title": "Trash Restore",
        "content_md": "restore body uniqueword42",
    })
    slug = created.json()["slug"]
    await auth_client.delete(f"/api/pages/{slug}")

    res = await auth_client.post(f"/api/trash/{slug}/restore")
    assert res.status_code == 200
    assert res.json()["slug"] == slug

    # Now visible again via normal GET
    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.status_code == 200

    # And back in search
    res = await auth_client.get("/api/search", params={"q": "uniqueword42"})
    slugs = [r["slug"] for r in res.json()["results"]]
    assert slug in slugs


@pytest.mark.asyncio
async def test_restore_nonexistent_404(auth_client):
    res = await auth_client.post("/api/trash/does-not-exist/restore")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_purge_admin_only(auth_client, admin_client):
    created = await auth_client.post("/api/pages", json={
        "title": "Trash Purge",
        "content_md": "body",
    })
    slug = created.json()["slug"]
    await auth_client.delete(f"/api/pages/{slug}")

    # Non-admin cannot purge
    res = await auth_client.delete(f"/api/trash/{slug}")
    assert res.status_code == 403

    # Admin can
    res = await admin_client.delete(f"/api/trash/{slug}")
    assert res.status_code == 204

    # Gone from trash
    res = await admin_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert slug not in slugs


@pytest.mark.asyncio
async def test_non_admin_sees_only_own_trash(db, auth_client, admin_client):
    # Admin creates and soft-deletes a page
    admin_created = await admin_client.post("/api/pages", json={
        "title": "Admin Owned",
        "content_md": "body",
    })
    admin_slug = admin_created.json()["slug"]
    await admin_client.delete(f"/api/pages/{admin_slug}")

    # Regular user creates and deletes their own
    user_created = await auth_client.post("/api/pages", json={
        "title": "User Owned",
        "content_md": "body",
    })
    user_slug = user_created.json()["slug"]
    await auth_client.delete(f"/api/pages/{user_slug}")

    # Regular user only sees their own in trash
    res = await auth_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert user_slug in slugs
    assert admin_slug not in slugs

    # Admin sees everything
    res = await admin_client.get("/api/trash")
    slugs = [item["slug"] for item in res.json()["items"]]
    assert user_slug in slugs
    assert admin_slug in slugs
