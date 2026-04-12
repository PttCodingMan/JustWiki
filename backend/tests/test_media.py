import pytest

@pytest.mark.asyncio
async def test_media_upload_and_get(auth_client):
    # Mock a file upload
    file_content = b"fake image content"
    files = {"file": ("test.png", file_content, "image/png")}
    
    response = await auth_client.post("/api/media/upload", files=files)
    assert response.status_code == 201
    data = response.json()
    assert data["original_name"] == "test.png"
    filename = data["filename"]

    # Get media
    response = await auth_client.get(f"/api/media/{filename}")
    assert response.status_code == 200
    assert response.content == file_content
