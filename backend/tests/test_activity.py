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
