import pytest
from app.routers.pages import slugify

def test_slugify():
    assert slugify("Hello World") == "hello-world"
    assert slugify("測試標題") == "測試標題"
    assert slugify("Mixed Title 測試") == "mixed-title-測試"
    assert slugify("!@#$%^&*()") == "untitled"
    assert slugify("中文 標題！with 英文") == "中文-標題with-英文"

@pytest.mark.asyncio
async def test_unique_slug_collision(auth_client):
    # Create two pages with same title
    await auth_client.post("/api/pages", json={
        "title": "Duplicate",
        "content_md": "Content 1"
    })
    response = await auth_client.post("/api/pages", json={
        "title": "Duplicate",
        "content_md": "Content 2"
    })
    assert response.status_code == 201
    assert response.json()["slug"] == "duplicate-1"

@pytest.mark.asyncio
async def test_page_with_parent(auth_client):
    res1 = await auth_client.post("/api/pages", json={
        "title": "Parent",
        "content_md": "Parent content"
    })
    parent_id = res1.json()["id"]

    res2 = await auth_client.post("/api/pages", json={
        "title": "Child",
        "content_md": "Child content",
        "parent_id": parent_id
    })
    assert res2.status_code == 201
    assert res2.json()["parent_id"] == parent_id

    # List with parent filter
    response = await auth_client.get("/api/pages", params={"parent_id": parent_id})
    assert response.status_code == 200
    assert len(response.json()["pages"]) == 1
    assert response.json()["pages"][0]["title"] == "Child"

@pytest.mark.asyncio
async def test_page_move(auth_client):
    res1 = await auth_client.post("/api/pages", json={"title": "Page to Move"})
    slug = res1.json()["slug"]
    
    res2 = await auth_client.post("/api/pages", json={"title": "New Parent"})
    parent_id = res2.json()["id"]

    response = await auth_client.patch(f"/api/pages/{slug}/move", json={
        "parent_id": parent_id,
        "sort_order": 5
    })
    assert response.status_code == 200
    
    # Verify moved
    response = await auth_client.get(f"/api/pages/{slug}")
    assert response.json()["parent_id"] == parent_id
    assert response.json()["sort_order"] == 5

@pytest.mark.asyncio
async def test_create_page_with_template(auth_client):
    # 1. Create template
    res_tmpl = await auth_client.post("/api/templates", json={
        "name": "Tmpl",
        "content_md": "Template Content"
    })
    tmpl_id = res_tmpl.json()["id"]

    # 2. Create page using template
    response = await auth_client.post("/api/pages", json={
        "title": "Tmpl Page",
        "template_id": tmpl_id
    })
    assert response.status_code == 201
    assert response.json()["content_md"] == "Template Content"

@pytest.mark.asyncio
async def test_get_children(auth_client):
    res_p = await auth_client.post("/api/pages", json={"title": "Parent"})
    parent_slug = res_p.json()["slug"]
    parent_id = res_p.json()["id"]
    
    await auth_client.post("/api/pages", json={"title": "Child 1", "parent_id": parent_id})
    await auth_client.post("/api/pages", json={"title": "Child 2", "parent_id": parent_id})

    response = await auth_client.get(f"/api/pages/{parent_slug}/children")
    assert response.status_code == 200
    assert len(response.json()) == 2

@pytest.mark.asyncio
async def test_page_not_found_errors(auth_client):
    slug = "non-existent"
    
    # Get
    res = await auth_client.get(f"/api/pages/{slug}")
    assert res.status_code == 404
    
    # Update
    res = await auth_client.put(f"/api/pages/{slug}", json={"title": "New"})
    assert res.status_code == 404
    
    # Delete
    res = await auth_client.delete(f"/api/pages/{slug}")
    assert res.status_code == 404
    
    # Children
    res = await auth_client.get(f"/api/pages/{slug}/children")
    assert res.status_code == 404
    
    # Backlinks
    res = await auth_client.get(f"/api/pages/{slug}/backlinks")
    assert res.status_code == 404
    
    # Move
    res = await auth_client.patch(f"/api/pages/{slug}/move", json={"sort_order": 1})
    assert res.status_code == 404
