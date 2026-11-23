import pytest
from app.services.wikilink import extract_wikilink_slugs

def test_extract_wikilink_slugs():
    content = "Check out [[page-1]] and [[page-2|Page Two]]. Also ![[trans-1]] and ![[trans-2|Heading]]."
    slugs = extract_wikilink_slugs(content)
    assert slugs == {"page-1", "page-2", "trans-1", "trans-2"}

@pytest.mark.asyncio
async def test_backlinks_update(auth_client, db):
    # 1. Create target pages
    res1 = await auth_client.post("/api/pages", json={"title": "Target 1"})
    t1_id = res1.json()["id"]
    t1_slug = res1.json()["slug"]
    res2 = await auth_client.post("/api/pages", json={"title": "Target 2"})
    t2_id = res2.json()["id"]
    t2_slug = res2.json()["slug"]

    # 2. Create source page with links
    res_src = await auth_client.post("/api/pages", json={
        "title": "Source",
        "content_md": f"Links to [[{t1_slug}]] and [[{t2_slug}]]."
    })
    src_id = res_src.json()["id"]
    src_slug = res_src.json()["slug"]

    # 3. Verify backlinks in DB
    rows = await db.execute_fetchall(
        "SELECT target_page_id FROM backlinks WHERE source_page_id = ?", (src_id,)
    )
    targets = [r["target_page_id"] for r in rows]
    assert t1_id in targets
    assert t2_id in targets

    # 4. Update source page (remove one link)
    await auth_client.put(f"/api/pages/{src_slug}", json={
        "content_md": f"Link to [[{t1_slug}]] only.",
        "base_version": 1,
    })

    # 5. Verify backlinks updated
    rows = await db.execute_fetchall(
        "SELECT target_page_id FROM backlinks WHERE source_page_id = ?", (src_id,)
    )
    targets = [r["target_page_id"] for r in rows]
    assert t1_id in targets
    assert t2_id not in targets

@pytest.mark.asyncio
async def test_get_backlinks_endpoint(auth_client):
    target = await auth_client.post("/api/pages", json={"title": "Target"})
    target_slug = target.json()["slug"]
    source = await auth_client.post("/api/pages", json={"title": "Source", "content_md": f"[[{target_slug}]]"})
    source_slug = source.json()["slug"]

    response = await auth_client.get(f"/api/pages/{target_slug}/backlinks")
    assert response.status_code == 200
    assert any(b["slug"] == source_slug for b in response.json())
