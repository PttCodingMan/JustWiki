import pytest

@pytest.mark.asyncio
async def test_tags(auth_client):
    # Create page
    created = await auth_client.post("/api/pages", json={
        "title": "Tag Page",
        "content_md": "Content"
    })
    slug = created.json()["slug"]

    # Add tag
    response = await auth_client.post(f"/api/pages/{slug}/tags", json={"name": "test-tag"})
    assert response.status_code == 200
    assert response.json()["name"] == "test-tag"

    # Get page tags
    response = await auth_client.get(f"/api/pages/{slug}/tags")
    assert response.status_code == 200
    assert any(t["name"] == "test-tag" for t in response.json())

    # List all tags
    response = await auth_client.get("/api/tags")
    assert response.status_code == 200
    assert any(t["name"] == "test-tag" for t in response.json())

    # Remove tag
    response = await auth_client.delete(f"/api/pages/{slug}/tags/test-tag")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Verify removed
    response = await auth_client.get(f"/api/pages/{slug}/tags")
    assert "test-tag" not in response.json()
