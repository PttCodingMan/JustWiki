import pytest

@pytest.mark.asyncio
async def test_versions(auth_client):
    # Create page
    created = await auth_client.post("/api/pages", json={
        "title": "Version Page",
        "content_md": "Original content"
    })
    slug = created.json()["slug"]

    # Update page to create a version
    await auth_client.put(f"/api/pages/{slug}", json={
        "title": "Updated Title",
        "content_md": "New content",
        "base_version": 1,
    })

    # List versions
    response = await auth_client.get(f"/api/pages/{slug}/versions")
    assert response.status_code == 200
    versions = response.json()["versions"]
    assert len(versions) >= 1
    version_num = versions[0]["version_num"]

    # Get single version
    response = await auth_client.get(f"/api/pages/{slug}/versions/{version_num}")
    assert response.status_code == 200
    assert response.json()["title"] == "Version Page"

    # Restore version — base_version is required (page is at v2 after the edit).
    response = await auth_client.post(
        f"/api/pages/{slug}/revert/{version_num}", json={"base_version": 2}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Version Page"

    # Verify page restored
    response = await auth_client.get(f"/api/pages/{slug}")
    assert response.json()["title"] == "Version Page"
    assert response.json()["content_md"] == "Original content"
