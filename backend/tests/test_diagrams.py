import pytest

from app.services.diagram_ref import extract_diagram_ids


@pytest.mark.asyncio
async def test_diagrams(auth_client, admin_client):
    # Create page
    response = await auth_client.post("/api/pages", json={
        "title": "Diagram Page",
        "content_md": "Content",
        "slug": "diagram-page"
    })
    page_id = response.json()["id"]

    # Create diagram
    response = await auth_client.post("/api/diagrams", json={
        "name": "Test Diagram",
        "xml_data": "<mxGraphModel>...</mxGraphModel>",
        "page_id": page_id
    })
    assert response.status_code == 201
    diagram_id = response.json()["id"]

    # List diagrams by page
    response = await auth_client.get(f"/api/diagrams/page/{page_id}")
    assert response.status_code == 200
    assert any(d["id"] == diagram_id for d in response.json())

    # Get single diagram
    response = await auth_client.get(f"/api/diagrams/{diagram_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Test Diagram"

    # Update diagram
    response = await auth_client.put(f"/api/diagrams/{diagram_id}", json={
        "name": "Updated Diagram"
    })
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Diagram"

    # Delete requires admin now
    response = await admin_client.delete(f"/api/diagrams/{diagram_id}")
    assert response.status_code == 204


def test_extract_diagram_ids_plain():
    assert extract_diagram_ids("before ::drawio[42] after") == {42}


def test_extract_diagram_ids_milkdown_escaped():
    # Milkdown escapes the square brackets when serialising back to markdown.
    assert extract_diagram_ids(r"prefix ::drawio\[7\] suffix") == {7}


def test_extract_diagram_ids_multiple():
    md = "::drawio[1] middle ::drawio[2]\n and ::drawio\\[3\\]"
    assert extract_diagram_ids(md) == {1, 2, 3}


def test_extract_diagram_ids_empty():
    assert extract_diagram_ids("") == set()
    assert extract_diagram_ids("no drawio here") == set()


@pytest.mark.asyncio
async def test_diagrams_list_empty_ok(auth_client):
    response = await auth_client.get("/api/diagrams")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_diagrams_list_reports_unused_and_refs(admin_client):
    # Create two diagrams. Only one will be referenced by a page.
    used = await admin_client.post("/api/diagrams", json={
        "name": "Used diagram",
        "xml_data": "<x/>",
    })
    assert used.status_code == 201
    used_id = used.json()["id"]

    unused = await admin_client.post("/api/diagrams", json={
        "name": "Unused diagram",
        "xml_data": "<x/>",
    })
    assert unused.status_code == 201
    unused_id = unused.json()["id"]

    # Attach svg_cache on one so has_svg can be exercised.
    await admin_client.put(f"/api/diagrams/{used_id}", json={
        "svg_cache": "<svg/>",
    })

    page_resp = await admin_client.post("/api/pages", json={
        "title": "Uses the used diagram",
        "content_md": f"Content ::drawio[{used_id}] end",
        "slug": "uses-diagram",
    })
    assert page_resp.status_code == 201
    page_slug = page_resp.json()["slug"]

    listing = await admin_client.get("/api/diagrams")
    assert listing.status_code == 200
    items = {d["id"]: d for d in listing.json()}

    assert used_id in items
    used_item = items[used_id]
    assert used_item["reference_count"] == 1
    assert used_item["has_svg"] is True
    assert used_item["referenced_pages"][0]["slug"] == page_slug
    assert used_item["referenced_pages"][0]["deleted"] is False

    assert unused_id in items
    unused_item = items[unused_id]
    assert unused_item["reference_count"] == 0
    assert unused_item["referenced_pages"] == []
    assert unused_item["has_svg"] is False


@pytest.mark.asyncio
async def test_diagrams_list_counts_milkdown_escaped_refs(admin_client):
    d = await admin_client.post("/api/diagrams", json={
        "name": "Escaped ref",
        "xml_data": "<x/>",
    })
    diagram_id = d.json()["id"]

    page_resp = await admin_client.post("/api/pages", json={
        "title": "Milkdown escaped reference",
        "content_md": f"body ::drawio\\[{diagram_id}\\] end",
        "slug": "escaped-ref",
    })
    assert page_resp.status_code == 201

    listing = await admin_client.get("/api/diagrams")
    item = next(d for d in listing.json() if d["id"] == diagram_id)
    assert item["reference_count"] == 1


@pytest.mark.asyncio
async def test_diagrams_list_counts_soft_deleted_pages(admin_client):
    d = await admin_client.post("/api/diagrams", json={
        "name": "Ref in trash",
        "xml_data": "<x/>",
    })
    diagram_id = d.json()["id"]

    page_resp = await admin_client.post("/api/pages", json={
        "title": "Will be trashed",
        "content_md": f"body ::drawio[{diagram_id}] end",
        "slug": "will-be-trashed",
    })
    slug = page_resp.json()["slug"]

    # Soft delete the page.
    del_resp = await admin_client.delete(f"/api/pages/{slug}")
    assert del_resp.status_code in (200, 204)

    listing = await admin_client.get("/api/diagrams")
    item = next(d for d in listing.json() if d["id"] == diagram_id)
    # Reference survives the soft delete so that restoring the page does not
    # turn the directive into a dangling pointer.
    assert item["reference_count"] == 1
    assert item["referenced_pages"][0]["deleted"] is True


@pytest.mark.asyncio
async def test_diagrams_list_dedupes_same_page_multiple_refs(admin_client):
    # One page can reference the same diagram more than once; the page should
    # show up once in referenced_pages and reference_count should match.
    d = await admin_client.post("/api/diagrams", json={
        "name": "Multi ref",
        "xml_data": "<x/>",
    })
    diagram_id = d.json()["id"]

    page_resp = await admin_client.post("/api/pages", json={
        "title": "Double ref",
        "content_md": f"A ::drawio[{diagram_id}] B ::drawio[{diagram_id}] C",
        "slug": "double-ref",
    })
    assert page_resp.status_code == 201

    listing = await admin_client.get("/api/diagrams")
    item = next(d for d in listing.json() if d["id"] == diagram_id)
    assert item["reference_count"] == 1
    assert len(item["referenced_pages"]) == 1


@pytest.mark.asyncio
async def test_diagrams_delete_blocked_when_referenced(admin_client):
    d = await admin_client.post("/api/diagrams", json={
        "name": "Locked",
        "xml_data": "<x/>",
    })
    diagram_id = d.json()["id"]

    page_resp = await admin_client.post("/api/pages", json={
        "title": "Uses locked",
        "content_md": f"use ::drawio[{diagram_id}]",
        "slug": "uses-locked",
    })
    slug = page_resp.json()["slug"]

    blocked = await admin_client.delete(f"/api/diagrams/{diagram_id}")
    assert blocked.status_code == 409

    # Remove the reference and delete should succeed.
    await admin_client.put(f"/api/pages/{slug}", json={"content_md": "no ref"})
    ok = await admin_client.delete(f"/api/diagrams/{diagram_id}")
    assert ok.status_code == 204


@pytest.mark.asyncio
async def test_diagrams_delete_forbidden_for_non_admin(auth_client, admin_client):
    d = await admin_client.post("/api/diagrams", json={
        "name": "Admin only",
        "xml_data": "<x/>",
    })
    diagram_id = d.json()["id"]

    response = await auth_client.delete(f"/api/diagrams/{diagram_id}")
    assert response.status_code == 403

    # Cleanup so the diagram doesn't pollute other tests.
    await admin_client.delete(f"/api/diagrams/{diagram_id}")


@pytest.mark.asyncio
async def test_diagrams_delete_not_found(admin_client):
    response = await admin_client.delete("/api/diagrams/99999999")
    assert response.status_code == 404
