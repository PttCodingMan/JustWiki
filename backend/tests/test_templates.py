import pytest

@pytest.mark.asyncio
async def test_templates(admin_client):
    # Create template
    response = await admin_client.post("/api/templates", json={
        "name": "Test Template",
        "description": "Desc",
        "content_md": "# Tmpl Content"
    })
    assert response.status_code == 201
    tmpl_id = response.json()["id"]

    # List templates
    response = await admin_client.get("/api/templates")
    assert response.status_code == 200
    assert any(t["id"] == tmpl_id for t in response.json())

    # Update template
    response = await admin_client.put(f"/api/templates/{tmpl_id}", json={
        "name": "Updated Tmpl"
    })
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Tmpl"

    # Delete template
    response = await admin_client.delete(f"/api/templates/{tmpl_id}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.asyncio
async def test_create_duplicate_template_name_returns_409(admin_client):
    payload = {"name": "Unique409Name", "description": "d", "content_md": "# A"}
    r1 = await admin_client.post("/api/templates", json=payload)
    assert r1.status_code == 201

    r2 = await admin_client.post("/api/templates", json=payload)
    assert r2.status_code == 409

    # cleanup
    await admin_client.delete(f"/api/templates/{r1.json()['id']}")


@pytest.mark.asyncio
async def test_update_template_to_duplicate_name_returns_409(admin_client):
    t1 = (await admin_client.post("/api/templates", json={
        "name": "Tmpl409A", "content_md": "a"
    })).json()
    t2 = (await admin_client.post("/api/templates", json={
        "name": "Tmpl409B", "content_md": "b"
    })).json()

    r = await admin_client.put(f"/api/templates/{t2['id']}", json={"name": "Tmpl409A"})
    assert r.status_code == 409

    # cleanup
    await admin_client.delete(f"/api/templates/{t1['id']}")
    await admin_client.delete(f"/api/templates/{t2['id']}")


@pytest.mark.asyncio
async def test_delete_nonexistent_template_returns_404(admin_client):
    r = await admin_client.delete("/api/templates/999999")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_cannot_create_template(auth_client):
    r = await auth_client.post("/api/templates", json={
        "name": "Forbidden", "content_md": "x"
    })
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_non_admin_cannot_update_template(auth_client, admin_client):
    created = (await admin_client.post("/api/templates", json={
        "name": "OwnedByAdmin", "content_md": "x"
    })).json()
    try:
        r = await auth_client.put(
            f"/api/templates/{created['id']}", json={"name": "Hijacked"}
        )
        assert r.status_code == 403
    finally:
        await admin_client.delete(f"/api/templates/{created['id']}")


@pytest.mark.asyncio
async def test_non_admin_cannot_delete_template(auth_client, admin_client):
    created = (await admin_client.post("/api/templates", json={
        "name": "OwnedByAdmin2", "content_md": "x"
    })).json()
    try:
        r = await auth_client.delete(f"/api/templates/{created['id']}")
        assert r.status_code == 403
    finally:
        await admin_client.delete(f"/api/templates/{created['id']}")


@pytest.mark.asyncio
async def test_non_admin_can_still_list_templates(auth_client, admin_client):
    created = (await admin_client.post("/api/templates", json={
        "name": "Listable", "content_md": "x"
    })).json()
    try:
        r = await auth_client.get("/api/templates")
        assert r.status_code == 200
        assert any(t["id"] == created["id"] for t in r.json())
    finally:
        await admin_client.delete(f"/api/templates/{created['id']}")
