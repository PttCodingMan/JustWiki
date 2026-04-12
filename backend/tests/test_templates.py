import pytest

@pytest.mark.asyncio
async def test_templates(auth_client):
    # Create template
    response = await auth_client.post("/api/templates", json={
        "name": "Test Template",
        "description": "Desc",
        "content_md": "# Tmpl Content"
    })
    assert response.status_code == 201
    tmpl_id = response.json()["id"]

    # List templates
    response = await auth_client.get("/api/templates")
    assert response.status_code == 200
    assert any(t["id"] == tmpl_id for t in response.json())

    # Update template
    response = await auth_client.put(f"/api/templates/{tmpl_id}", json={
        "name": "Updated Tmpl"
    })
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Tmpl"

    # Delete template
    response = await auth_client.delete(f"/api/templates/{tmpl_id}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
