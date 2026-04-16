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


@pytest.mark.asyncio
async def test_create_duplicate_template_name_returns_409(auth_client):
    payload = {"name": "Unique409Name", "description": "d", "content_md": "# A"}
    r1 = await auth_client.post("/api/templates", json=payload)
    assert r1.status_code == 201

    r2 = await auth_client.post("/api/templates", json=payload)
    assert r2.status_code == 409

    # cleanup
    await auth_client.delete(f"/api/templates/{r1.json()['id']}")


@pytest.mark.asyncio
async def test_update_template_to_duplicate_name_returns_409(auth_client):
    t1 = (await auth_client.post("/api/templates", json={
        "name": "Tmpl409A", "content_md": "a"
    })).json()
    t2 = (await auth_client.post("/api/templates", json={
        "name": "Tmpl409B", "content_md": "b"
    })).json()

    r = await auth_client.put(f"/api/templates/{t2['id']}", json={"name": "Tmpl409A"})
    assert r.status_code == 409

    # cleanup
    await auth_client.delete(f"/api/templates/{t1['id']}")
    await auth_client.delete(f"/api/templates/{t2['id']}")


@pytest.mark.asyncio
async def test_delete_nonexistent_template_returns_404(auth_client):
    r = await auth_client.delete("/api/templates/999999")
    assert r.status_code == 404
