import pytest

@pytest.mark.asyncio
async def test_tags(auth_client):
    # Create page
    await auth_client.post("/api/pages", json={
        "title": "Tag Page",
        "content_md": "Content",
        "slug": "tag-page"
    })

    # Add tag
    response = await auth_client.post("/api/pages/tag-page/tags", json={"name": "test-tag"})
    assert response.status_code == 200
    assert response.json()["name"] == "test-tag"

    # Get page tags
    response = await auth_client.get("/api/pages/tag-page/tags")
    assert response.status_code == 200
    assert any(t["name"] == "test-tag" for t in response.json())

    # List all tags
    response = await auth_client.get("/api/tags")
    assert response.status_code == 200
    assert any(t["name"] == "test-tag" for t in response.json())

    # Remove tag
    response = await auth_client.delete("/api/pages/tag-page/tags/test-tag")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Verify removed
    response = await auth_client.get("/api/pages/tag-page/tags")
    assert "test-tag" not in response.json()
