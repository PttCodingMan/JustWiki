import pytest

@pytest.mark.asyncio
async def test_create_backup(admin_client):
    response = await admin_client.get("/api/backup")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/zip"
