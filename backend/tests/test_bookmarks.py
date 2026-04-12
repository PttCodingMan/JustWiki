import pytest

@pytest.mark.asyncio
async def test_bookmarks(auth_client):
    # Create page first
    await auth_client.post("/api/pages", json={
        "title": "Bookmark Page",
        "content_md": "Content",
        "slug": "bookmark-page"
    })

    # Add bookmark
    response = await auth_client.post("/api/bookmarks/bookmark-page")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Check
    response = await auth_client.get("/api/bookmarks/check/bookmark-page")
    assert response.status_code == 200
    assert response.json() == {"bookmarked": True}

    # List
    response = await auth_client.get("/api/bookmarks")
    assert response.status_code == 200
    assert any(b["slug"] == "bookmark-page" for b in response.json())

    # Remove
    response = await auth_client.delete("/api/bookmarks/bookmark-page")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    # Check again
    response = await auth_client.get("/api/bookmarks/check/bookmark-page")
    assert response.json() == {"bookmarked": False}
