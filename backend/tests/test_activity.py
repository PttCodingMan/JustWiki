import pytest

@pytest.mark.asyncio
async def test_activity_list(auth_client):
    # Log some activity first by creating a page
    await auth_client.post("/api/pages", json={
        "title": "Activity Page",
        "content_md": "Content",
        "slug": "activity-page"
    })

    response = await auth_client.get("/api/activity")
    assert response.status_code == 200
    data = response.json()
    assert "activities" in data
    assert any(a["metadata"]["slug"] == "activity-page" for a in data["activities"] if a["metadata"])

@pytest.mark.asyncio
async def test_activity_stats(auth_client):
    response = await auth_client.get("/api/activity/stats")
    assert response.status_code == 200
    data = response.json()
    # stats might be empty but should be a dict
    assert isinstance(data, dict)


@pytest.mark.asyncio
async def test_deleted_pages_excluded_from_stats(admin_client):
    # Create two pages and bump view counts.
    await admin_client.post("/api/pages", json={
        "title": "Keep Me", "content_md": "x", "slug": "stats-keep",
    })
    await admin_client.post("/api/pages", json={
        "title": "Delete Me", "content_md": "x", "slug": "stats-delete",
    })
    # View the to-be-deleted one a few times so it would top the list.
    for ua in ("a", "b", "c"):
        await admin_client.get(
            "/api/pages/stats-delete", headers={"User-Agent": ua}
        )
    await admin_client.get("/api/pages/stats-keep")

    # Soft-delete it.
    r = await admin_client.delete("/api/pages/stats-delete")
    assert r.status_code == 200

    stats = (await admin_client.get("/api/activity/stats")).json()
    slugs_top = {p["slug"] for p in stats["top_viewed"]}
    slugs_recent = {p["slug"] for p in stats["recently_updated"]}
    slugs_orphan = {p["slug"] for p in stats["orphan_pages"]}
    assert "stats-delete" not in slugs_top
    assert "stats-delete" not in slugs_recent
    assert "stats-delete" not in slugs_orphan
