import pytest
from app.services.wikilink import extract_wikilink_slugs

def test_extract_wikilink_slugs():
    content = "Check out [[page-1]] and [[page-2|Page Two]]. Also ![[trans-1]]."
    slugs = extract_wikilink_slugs(content)
    assert slugs == {"page-1", "page-2", "trans-1"}

@pytest.mark.asyncio
async def test_backlinks_update(auth_client, db):
    # 1. Create target pages
    res1 = await auth_client.post("/api/pages", json={"title": "Target 1", "slug": "t1"})
    t1_id = res1.json()["id"]
    res2 = await auth_client.post("/api/pages", json={"title": "Target 2", "slug": "t2"})
    t2_id = res2.json()["id"]

    # 2. Create source page with links
    res_src = await auth_client.post("/api/pages", json={
        "title": "Source",
        "content_md": "Links to [[t1]] and [[t2]]."
    })
    src_id = res_src.json()["id"]

    # 3. Verify backlinks in DB
    rows = await db.execute_fetchall(
        "SELECT target_page_id FROM backlinks WHERE source_page_id = ?", (src_id,)
    )
    targets = [r["target_page_id"] for r in rows]
    assert t1_id in targets
    assert t2_id in targets

    # 4. Update source page (remove one link)
    await auth_client.put("/api/pages/source", json={
        "content_md": "Link to [[t1]] only."
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
    await auth_client.post("/api/pages", json={"title": "Target", "slug": "target-page"})
    await auth_client.post("/api/pages", json={"title": "Source", "slug": "source-page", "content_md": "[[target-page]]"})

    response = await auth_client.get("/api/pages/target-page/backlinks")
    assert response.status_code == 200
    assert any(b["slug"] == "source-page" for b in response.json())
