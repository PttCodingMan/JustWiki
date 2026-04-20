import pytest

@pytest.mark.asyncio
async def test_create_and_get_page(auth_client):
    # Create
    response = await auth_client.post("/api/pages", json={
        "title": "Test Page",
        "content_md": "# Test Content",
        "slug": "test-page"
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Page"
    assert data["slug"] == "test-page"

    # Get
    response = await auth_client.get("/api/pages/test-page")
    assert response.status_code == 200
    assert response.json()["title"] == "Test Page"

@pytest.mark.asyncio
async def test_list_pages(auth_client):
    response = await auth_client.get("/api/pages")
    assert response.status_code == 200
    assert "pages" in response.json()

@pytest.mark.asyncio
async def test_update_page(auth_client):
    # Ensure page exists
    await auth_client.post("/api/pages", json={
        "title": "Update Me",
        "content_md": "Old content",
        "slug": "update-me"
    })

    response = await auth_client.put("/api/pages/update-me", json={
        "title": "Updated Title",
        "content_md": "New content",
        "base_version": 1,
    })
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"

@pytest.mark.asyncio
async def test_delete_page_admin(admin_client, auth_client):
    # Create by regular user
    await auth_client.post("/api/pages", json={
        "title": "Delete Me Admin",
        "content_md": "Content",
        "slug": "delete-me-admin"
    })

    # Delete by admin
    response = await admin_client.delete("/api/pages/delete-me-admin")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

@pytest.mark.asyncio
async def test_delete_page_not_owner(auth_client, db):
    # Create page as someone else
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("otheruser", "hash", "user")
    )
    other_user_id = cursor.lastrowid
    await db.execute(
        "INSERT INTO pages (slug, title, content_md, created_by) VALUES (?, ?, ?, ?)",
        ("other-page", "Other Page", "Content", other_user_id)
    )
    await db.commit()

    # Try to delete as auth_user (not owner and not admin)
    response = await auth_client.delete("/api/pages/other-page")
    assert response.status_code == 403
    assert response.json()["detail"] == "Only the page creator or an admin can delete this page"

@pytest.mark.asyncio
async def test_page_tree(auth_client):
    response = await auth_client.get("/api/pages/tree")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_page_graph(auth_client):
    response = await auth_client.get("/api/pages/graph")
    assert response.status_code == 200
    assert "nodes" in response.json()
    assert "links" in response.json()
