import pytest

@pytest.mark.asyncio
async def test_read_root(client):
    # Verify we can access the health check or at least get a response from a known route
    # Looking at CLAUDE.md, /api/auth/me is a good one to check (should be 401)
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}

@pytest.mark.asyncio
async def test_pages_empty(client):
    # Should get 401 if not authenticated
    response = await client.get("/api/pages")
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}
