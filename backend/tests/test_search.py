import pytest

@pytest.mark.asyncio
async def test_search(auth_client):
    # Create page to search for
    await auth_client.post("/api/pages", json={
        "title": "Search Me",
        "content_md": "Find this hidden treasure",
        "slug": "search-me"
    })

    # Search by title
    response = await auth_client.get("/api/search", params={"q": "Search"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["title"] == "Search Me" for r in data["results"])

    # Search by content
    response = await auth_client.get("/api/search", params={"q": "treasure"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["slug"] == "search-me" for r in data["results"])

    # Search with tag
    await auth_client.post("/api/pages/search-me/tags", json={"name": "findme"})
    response = await auth_client.get("/api/search", params={"q": "Search", "tag": "findme"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["slug"] == "search-me" for r in data["results"])

@pytest.mark.asyncio
async def test_search_no_results(auth_client):
    response = await auth_client.get("/api/search", params={"q": "nonexistentstuff"})
    assert response.status_code == 200
    assert response.json()["results"] == []
