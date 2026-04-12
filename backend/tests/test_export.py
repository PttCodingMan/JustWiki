import pytest

@pytest.mark.asyncio
async def test_export_page(auth_client):
    # Create page
    await auth_client.post("/api/pages", json={
        "title": "Export Page",
        "content_md": "Export content",
        "slug": "export-page"
    })

    response = await auth_client.get("/api/export/page/export-page")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
    assert b"Export content" in response.content

@pytest.mark.asyncio
async def test_export_site(auth_client):
    response = await auth_client.get("/api/export/site")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/zip"
