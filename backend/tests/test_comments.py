import pytest

@pytest.mark.asyncio
async def test_comments(auth_client):
    # Create page
    created = await auth_client.post("/api/pages", json={
        "title": "Comment Page",
        "content_md": "Content"
    })
    slug = created.json()["slug"]

    # Add comment
    response = await auth_client.post(f"/api/pages/{slug}/comments", json={"content": "Great page!"})
    assert response.status_code == 201
    comment_id = response.json()["id"]

    # List comments
    response = await auth_client.get(f"/api/pages/{slug}/comments")
    assert response.status_code == 200
    assert any(c["id"] == comment_id for c in response.json()["comments"])

    # Update comment
    response = await auth_client.put(f"/api/pages/{slug}/comments/{comment_id}", json={"content": "Updated comment"})
    assert response.status_code == 200
    assert response.json()["content"] == "Updated comment"

    # Delete comment
    response = await auth_client.delete(f"/api/pages/{slug}/comments/{comment_id}")
    assert response.status_code == 204

    # Verify deleted
    response = await auth_client.get(f"/api/pages/{slug}/comments")
    assert not any(c["id"] == comment_id for c in response.json()["comments"])


@pytest.mark.asyncio
async def test_comments_on_soft_deleted_page_returns_404(auth_client):
    """Soft-deleted pages are invisible via the normal API, so their
    comment collection must also be unreachable. A previous version of
    the endpoint looked the page up without `deleted_at IS NULL` and
    happily served comments from trashed pages.
    """
    created = await auth_client.post(
        "/api/pages",
        json={"title": "Trashable", "content_md": "bye"},
    )
    slug = created.json()["slug"]
    # Move the page to trash (soft-delete).
    res = await auth_client.delete(f"/api/pages/{slug}")
    assert res.status_code == 200

    r_list = await auth_client.get(f"/api/pages/{slug}/comments")
    assert r_list.status_code == 404
    r_post = await auth_client.post(
        f"/api/pages/{slug}/comments", json={"content": "sneak"}
    )
    assert r_post.status_code == 404
