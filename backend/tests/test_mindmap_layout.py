"""Backend coverage for the `pages.mindmap_layout` column.

The frontend treats NULL as `'lr'`, so existing rows must keep returning
`null` and the field must round-trip through both create and update without
bumping `pages.version`.
"""
import pytest


@pytest.mark.asyncio
async def test_create_mindmap_page_omits_layout_returns_null(auth_client):
    response = await auth_client.post(
        "/api/pages",
        json={
            "title": "ML Default",
            "page_type": "mindmap",
            "content_md": "# Root",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["page_type"] == "mindmap"
    assert "mindmap_layout" in data
    assert data["mindmap_layout"] is None


@pytest.mark.asyncio
async def test_create_with_explicit_layout_persists(auth_client):
    response = await auth_client.post(
        "/api/pages",
        json={
            "title": "ML Radial",
            "page_type": "mindmap",
            "mindmap_layout": "radial",
            "content_md": "# Root",
        },
    )
    assert response.status_code == 201
    assert response.json()["mindmap_layout"] == "radial"

    fetched = await auth_client.get(f"/api/pages/{response.json()['slug']}")
    assert fetched.status_code == 200
    assert fetched.json()["mindmap_layout"] == "radial"


@pytest.mark.asyncio
async def test_update_layout_does_not_bump_version(auth_client):
    create = await auth_client.post(
        "/api/pages",
        json={
            "title": "ML Vbump",
            "page_type": "mindmap",
            "content_md": "# Root",
        },
    )
    assert create.status_code == 201
    starting_version = create.json()["version"]

    # Layout-only edit: must persist and must NOT bump the version counter
    # (matches is_public / page_type behavior — see pages.py optimistic-lock
    # logic: only content_md / title bump version).
    res = await auth_client.put(
        f"/api/pages/{create.json()['slug']}",
        json={"mindmap_layout": "rl"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["mindmap_layout"] == "rl"
    assert body["version"] == starting_version


@pytest.mark.asyncio
async def test_update_layout_to_invalid_value_returns_422(auth_client):
    created = await auth_client.post(
        "/api/pages",
        json={
            "title": "ML Bad",
            "page_type": "mindmap",
            "content_md": "# Root",
        },
    )
    res = await auth_client.put(
        f"/api/pages/{created.json()['slug']}",
        json={"mindmap_layout": "diagonal"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_update_layout_back_to_null(auth_client):
    created = await auth_client.post(
        "/api/pages",
        json={
            "title": "ML Reset",
            "page_type": "mindmap",
            "mindmap_layout": "radial",
            "content_md": "# Root",
        },
    )
    slug = created.json()["slug"]
    res = await auth_client.put(
        f"/api/pages/{slug}",
        json={"mindmap_layout": None},
    )
    assert res.status_code == 200
    assert res.json()["mindmap_layout"] is None

    fetched = await auth_client.get(f"/api/pages/{slug}")
    assert fetched.json()["mindmap_layout"] is None


@pytest.mark.asyncio
async def test_layout_allowed_on_document_page(auth_client):
    """Layout column has no meaning for `page_type='document'`, but we accept
    it anyway so toggling page_type doesn't lose the setting."""
    res = await auth_client.post(
        "/api/pages",
        json={
            "title": "Doc With Layout",
            "page_type": "document",
            "mindmap_layout": "radial",
            "content_md": "Body",
        },
    )
    assert res.status_code == 201
    assert res.json()["mindmap_layout"] == "radial"


@pytest.mark.asyncio
async def test_get_response_always_includes_layout_key(auth_client):
    created = await auth_client.post(
        "/api/pages",
        json={"title": "Plain Doc", "content_md": "x"},
    )
    res = await auth_client.get(f"/api/pages/{created.json()['slug']}")
    assert res.status_code == 200
    assert "mindmap_layout" in res.json()
