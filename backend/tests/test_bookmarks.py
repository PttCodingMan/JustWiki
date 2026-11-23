import pytest

@pytest.mark.asyncio
async def test_bookmarks(auth_client):
    # Create page first
    created = await auth_client.post("/api/pages", json={
        "title": "Bookmark Page",
        "content_md": "Content"
    })
    slug = created.json()["slug"]

    # Add bookmark
    response = await auth_client.post(f"/api/bookmarks/{slug}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Check
    response = await auth_client.get(f"/api/bookmarks/check/{slug}")
    assert response.status_code == 200
    assert response.json() == {"bookmarked": True}

    # List
    response = await auth_client.get("/api/bookmarks")
    assert response.status_code == 200
    assert any(b["slug"] == slug for b in response.json())

    # Remove
    response = await auth_client.delete(f"/api/bookmarks/{slug}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Check again
    response = await auth_client.get(f"/api/bookmarks/check/{slug}")
    assert response.json() == {"bookmarked": False}
