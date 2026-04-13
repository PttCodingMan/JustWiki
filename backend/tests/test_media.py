import pytest

from app.services.media_ref import extract_media_filenames


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


def test_extract_media_filenames_markdown_image():
    md = "![alt](/api/media/abc123.png)"
    assert extract_media_filenames(md) == {"abc123.png"}


def test_extract_media_filenames_multiple_and_html():
    md = """
    ![one](/api/media/one.png)
    <img src="/api/media/two.jpg" />
    Plain link: /api/media/three.pdf
    """
    assert extract_media_filenames(md) == {"one.png", "two.jpg", "three.pdf"}


def test_extract_media_filenames_empty():
    assert extract_media_filenames("") == set()
    assert extract_media_filenames("no media here") == set()


@pytest.mark.asyncio
async def test_media_list_available_to_editors(auth_client):
    # Any authenticated user can browse the library to reuse assets.
    response = await auth_client.get("/api/media")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_media_list_shows_upload_with_zero_refs(admin_client):
    files = {"file": ("zero.png", b"zero", "image/png")}
    up = await admin_client.post("/api/media/upload", files=files)
    assert up.status_code == 201
    uploaded = up.json()

    response = await admin_client.get("/api/media")
    assert response.status_code == 200
    items = response.json()
    match = next((m for m in items if m["id"] == uploaded["id"]), None)
    assert match is not None
    assert match["reference_count"] == 0
    assert match["referenced_pages"] == []
    assert match["url"] == f"/api/media/{uploaded['filename']}"


@pytest.mark.asyncio
async def test_media_reference_tracking_and_delete(admin_client):
    files = {"file": ("ref.png", b"ref", "image/png")}
    up = await admin_client.post("/api/media/upload", files=files)
    media = up.json()

    # Create a page that references the uploaded media
    page_body = {
        "title": "References media",
        "content_md": f"Here is an image: ![x](/api/media/{media['filename']})",
    }
    page_resp = await admin_client.post("/api/pages", json=page_body)
    assert page_resp.status_code == 201
    page = page_resp.json()

    # The list endpoint should now report 1 reference
    listing = await admin_client.get("/api/media")
    match = next(m for m in listing.json() if m["id"] == media["id"])
    assert match["reference_count"] == 1
    assert len(match["referenced_pages"]) == 1
    assert match["referenced_pages"][0]["slug"] == page["slug"]

    # Delete should be blocked while referenced
    blocked = await admin_client.delete(f"/api/media/{media['id']}")
    assert blocked.status_code == 409

    # Remove the reference by updating the page
    upd = await admin_client.put(
        f"/api/pages/{page['slug']}",
        json={"content_md": "No media anymore"},
    )
    assert upd.status_code == 200

    listing2 = await admin_client.get("/api/media")
    match2 = next(m for m in listing2.json() if m["id"] == media["id"])
    assert match2["reference_count"] == 0

    # Delete should now succeed
    ok = await admin_client.delete(f"/api/media/{media['id']}")
    assert ok.status_code == 204

    # The media entry is gone
    listing3 = await admin_client.get("/api/media")
    assert all(m["id"] != media["id"] for m in listing3.json())


@pytest.mark.asyncio
async def test_media_delete_non_admin_forbidden(auth_client):
    response = await auth_client.delete("/api/media/1")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_media_delete_not_found(admin_client):
    response = await admin_client.delete("/api/media/99999999")
    assert response.status_code == 404
