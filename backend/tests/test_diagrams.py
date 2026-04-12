import pytest

@pytest.mark.asyncio
async def test_diagrams(auth_client):
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

    # List diagrams
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

    # Delete diagram
    response = await auth_client.delete(f"/api/diagrams/{diagram_id}")
    assert response.status_code == 204
