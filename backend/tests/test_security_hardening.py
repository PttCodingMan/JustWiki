"""Regression tests for the security-hardening pass.

Covers the media stored-XSS fix (extension derived from MIME, non-image
served as a neutral attachment) and the activity-feed leak fix (group/token
activity is admin-only).
"""
import pytest


@pytest.mark.asyncio
async def test_upload_html_disguised_as_text_is_neutralized(auth_client):
    """A text/plain upload named *.html must not be stored/served as HTML."""
    files = {"file": ("evil.html", b"<script>alert(1)</script>", "text/plain")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 201
    filename = res.json()["filename"]
    # Stored extension comes from the validated MIME (text/plain → .txt),
    # never from the attacker-controlled filename.
    assert filename.endswith(".txt")

    # Uploader can fetch their own orphan media; it must come back as a
    # download with a neutral type, never text/html.
    got = await auth_client.get(f"/api/media/{filename}")
    assert got.status_code == 200
    assert got.headers["content-type"].startswith("application/octet-stream")
    assert "attachment" in got.headers.get("content-disposition", "").lower()
    assert got.headers.get("x-content-type-options") == "nosniff"


@pytest.mark.asyncio
async def test_upload_png_served_inline_with_explicit_type(auth_client):
    """Known-safe images are still served inline with an explicit type."""
    # 1x1 transparent PNG.
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d494844520000000100000001080600000"
        "01f15c4890000000d49444154789c6360000002000100" "05fe02fea7"
        "8f0f0000000049454e44ae426082"
    )
    files = {"file": ("pic.png", png, "image/png")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 201
    filename = res.json()["filename"]
    assert filename.endswith(".png")

    got = await auth_client.get(f"/api/media/{filename}")
    assert got.status_code == 200
    assert got.headers["content-type"].startswith("image/png")
    assert "attachment" not in got.headers.get("content-disposition", "").lower()


@pytest.mark.asyncio
async def test_activity_feed_hides_group_activity_from_non_admin(
    admin_client, auth_client
):
    """Group lifecycle activity must not leak to non-admin callers."""
    created = await admin_client.post("/api/groups", json={"name": "secret-team"})
    assert created.status_code in (200, 201)

    # Non-admin editor: feed carries no group/token rows.
    editor_feed = await auth_client.get("/api/activity")
    assert editor_feed.status_code == 200
    for row in editor_feed.json()["activities"]:
        assert row["target_type"] not in ("group", "api_token")

    # Admin: the group row is visible.
    admin_feed = await admin_client.get("/api/activity")
    assert admin_feed.status_code == 200
    assert any(
        row["target_type"] == "group" for row in admin_feed.json()["activities"]
    )
