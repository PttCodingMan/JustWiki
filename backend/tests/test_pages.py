import pytest

@pytest.mark.asyncio
async def test_create_and_get_page(auth_client):
    # Create
    response = await auth_client.post("/api/pages", json={
        "title": "Test Page",
        "content_md": "# Test Content",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Page"
    slug = data["slug"]

    # Get
    response = await auth_client.get(f"/api/pages/{slug}")
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
    created = await auth_client.post("/api/pages", json={
        "title": "Update Me",
        "content_md": "Old content",
    })
    slug = created.json()["slug"]

    response = await auth_client.put(f"/api/pages/{slug}", json={
        "title": "Updated Title",
        "content_md": "New content",
        "base_version": 1,
    })
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"

@pytest.mark.asyncio
async def test_delete_page_admin(admin_client, auth_client):
    # Create by regular user
    created = await auth_client.post("/api/pages", json={
        "title": "Delete Me Admin",
        "content_md": "Content",
    })
    slug = created.json()["slug"]

    # Delete by admin
    response = await admin_client.delete(f"/api/pages/{slug}")
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


@pytest.mark.asyncio
async def test_create_mindmap_page(auth_client):
    """Creating with page_type='mindmap' stores and returns the type."""
    response = await auth_client.post("/api/pages", json={
        "title": "My Mindmap",
        "content_md": "# Root\n\n## Branch",
        "page_type": "mindmap",
    })
    assert response.status_code == 201
    assert response.json()["page_type"] == "mindmap"

    got = await auth_client.get(f"/api/pages/{response.json()['slug']}")
    assert got.status_code == 200
    assert got.json()["page_type"] == "mindmap"


@pytest.mark.asyncio
async def test_create_defaults_to_document(auth_client):
    """Omitting page_type defaults to 'document'."""
    response = await auth_client.post("/api/pages", json={
        "title": "Default Type",
    })
    assert response.status_code == 201
    assert response.json()["page_type"] == "document"


@pytest.mark.asyncio
async def test_create_rejects_unknown_page_type(auth_client):
    """Pydantic Literal should reject values outside the PageType set."""
    response = await auth_client.post("/api/pages", json={
        "title": "Bad Type",
        "page_type": "not_a_real_type",
    })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_page_type_update_is_metadata_only(auth_client):
    """Flipping page_type must not need base_version and must not bump version."""
    created = await auth_client.post("/api/pages", json={
        "title": "Meta Change",
        "content_md": "# body",
    })
    slug = created.json()["slug"]

    # Metadata-only update: no base_version required, version should hold.
    response = await auth_client.put(f"/api/pages/{slug}", json={
        "page_type": "mindmap",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["page_type"] == "mindmap"
    assert body["version"] == 1  # unchanged — page_type is metadata

    # Flip back works too.
    response = await auth_client.put(f"/api/pages/{slug}", json={
        "page_type": "document",
    })
    assert response.status_code == 200
    assert response.json()["page_type"] == "document"
    assert response.json()["version"] == 1


@pytest.mark.asyncio
async def test_page_type_update_ignores_stale_base_version(auth_client):
    """page_type is metadata — PUTting it with an incorrect base_version
    should still succeed, because the optimistic lock only guards
    content / title edits. Pins D3 from the plan."""
    created = await auth_client.post("/api/pages", json={
        "title": "Stale Meta",
        "content_md": "body",
    })
    slug = created.json()["slug"]
    # Bump the version via a real content edit so current_version > 1.
    await auth_client.put(f"/api/pages/{slug}", json={
        "content_md": "new body",
        "base_version": 1,
    })

    # Now PUT page_type with a stale base_version — should be accepted
    # because touches_content=False.
    response = await auth_client.put(f"/api/pages/{slug}", json={
        "page_type": "mindmap",
        "base_version": 1,  # stale; current is 2
    })
    assert response.status_code == 200
    assert response.json()["page_type"] == "mindmap"
    assert response.json()["version"] == 2  # not bumped


@pytest.mark.asyncio
async def test_combined_update_still_requires_base_version(auth_client):
    """A payload that flips page_type AND edits content still needs base_version."""
    created = await auth_client.post("/api/pages", json={
        "title": "Combined",
        "content_md": "old",
    })
    slug = created.json()["slug"]

    # Content change without base_version → 400
    response = await auth_client.put(f"/api/pages/{slug}", json={
        "page_type": "mindmap",
        "content_md": "# new",
    })
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"] == "base_version_required"

    # With correct base_version → 200, version bumps because content changed.
    response = await auth_client.put(f"/api/pages/{slug}", json={
        "page_type": "mindmap",
        "content_md": "# new",
        "base_version": 1,
    })
    assert response.status_code == 200
    assert response.json()["page_type"] == "mindmap"
    assert response.json()["version"] == 2


@pytest.mark.asyncio
async def test_search_includes_page_type(auth_client):
    """Search results surface page_type so the UI can show per-type icons."""
    created = await auth_client.post("/api/pages", json={
        "title": "Searchable Mindmap",
        "content_md": "# findme uniqueword\n\n## node",
        "page_type": "mindmap",
    })
    slug = created.json()["slug"]
    response = await auth_client.get("/api/search", params={"q": "uniqueword"})
    assert response.status_code == 200
    results = response.json()["results"]
    mm = next((r for r in results if r["slug"] == slug), None)
    assert mm is not None
    assert mm["page_type"] == "mindmap"
