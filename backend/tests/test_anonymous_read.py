"""Tests for ANONYMOUS_READ (Demo / Public Wiki Mode).

Covers both the flag-off regression path (everything still 401s) and the
flag-on path: reads succeed for open-default pages, ACL-restricted pages
stay hidden, every write/personal/admin endpoint stays login-required,
and `/api/auth/me` keeps returning 401 so the frontend can detect guest
state instead of mistaking the synthetic user for a real session.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.database import get_db
from app.main import app


# ── Helpers ───────────────────────────────────────────────────────────


@pytest.fixture
def anon_on(monkeypatch):
    """Turn ANONYMOUS_READ on for the duration of one test, then restore."""
    monkeypatch.setattr(settings, "ANONYMOUS_READ", True)
    yield


@pytest.fixture
def anon_off(monkeypatch):
    """Pin ANONYMOUS_READ off (defensive — default is already False)."""
    monkeypatch.setattr(settings, "ANONYMOUS_READ", False)
    yield


async def _make_acl_restricted_page(auth_client, slug: str, owner_user_id: int):
    """Create a page and pin a user-only ACL row so other users see 404.

    Returns the page id. The ACL anchor lives on the page itself, with one
    grant to a user that nobody but `owner_user_id` is. Editors and admins
    are unaffected (admin bypasses; the test never queries as that editor).
    """
    res = await auth_client.post("/api/pages", json={
        "title": slug, "content_md": "secret", "slug": slug,
    })
    assert res.status_code in (200, 201)
    page_id = res.json()["id"]

    db = await get_db()
    # Pin a single user grant — anyone not matching that principal (incl. the
    # synthetic anonymous user) should resolve to permission='none'.
    await db.execute(
        "DELETE FROM page_acl WHERE page_id = ?", (page_id,),
    )
    await db.execute(
        """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
           VALUES (?, 'user', ?, 'write')""",
        (page_id, owner_user_id),
    )
    await db.commit()
    # Drop the readable cache so the new ACL row takes effect immediately.
    from app.services.acl import invalidate_readable_cache
    invalidate_readable_cache()
    return page_id


# ── Flag OFF: regression baseline ────────────────────────────────────


@pytest.mark.asyncio
async def test_flag_off_blocks_all_anonymous_reads(anon_off, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Open Page", "content_md": "hi", "slug": "anon-off-open",
    })

    for path in (
        "/api/pages",
        "/api/pages/tree",
        "/api/pages/graph",
        "/api/pages/anon-off-open",
        "/api/search?q=hi",
        "/api/auth/me",
        "/api/tags",
        "/api/activity",
    ):
        res = await client.get(path)
        assert res.status_code == 401, f"{path} should 401 when flag is off; got {res.status_code}"


# ── Flag ON: reads ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_flag_on_lets_guest_read_open_page(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Demo Page", "content_md": "# Hello", "slug": "anon-demo-open",
    })
    res = await client.get("/api/pages/anon-demo-open")
    assert res.status_code == 200
    body = res.json()
    assert body["slug"] == "anon-demo-open"
    assert body["effective_permission"] == "read"


@pytest.mark.asyncio
async def test_flag_on_acl_restricted_page_404s_guest(anon_on, auth_user, auth_client, client):
    await _make_acl_restricted_page(auth_client, "anon-demo-restricted", auth_user["user"]["id"])

    res = await client.get("/api/pages/anon-demo-restricted")
    assert res.status_code == 404, "ACL-restricted page must look like 404 to guest, not 403"


@pytest.mark.asyncio
async def test_flag_on_tree_filters_restricted_pages(anon_on, auth_user, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Open A", "content_md": "x", "slug": "anon-tree-open",
    })
    await _make_acl_restricted_page(auth_client, "anon-tree-restricted", auth_user["user"]["id"])

    res = await client.get("/api/pages/tree")
    assert res.status_code == 200
    slugs = _flatten_slugs(res.json())
    assert "anon-tree-open" in slugs
    assert "anon-tree-restricted" not in slugs


def _flatten_slugs(tree):
    out = []
    nodes = tree if isinstance(tree, list) else tree.get("items") or tree.get("tree") or []
    stack = list(nodes)
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if "slug" in node:
                out.append(node["slug"])
            for child in node.get("children", []) or []:
                stack.append(child)
    return out


@pytest.mark.asyncio
async def test_flag_on_search_filters_restricted_pages(anon_on, auth_user, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "AnonSearchOpen",
        "content_md": "uniquesearchtoken123",
        "slug": "anon-search-open",
    })
    await _make_acl_restricted_page(auth_client, "anon-search-restricted", auth_user["user"]["id"])
    # Put the same token inside the restricted page so a leak would surface.
    db = await get_db()
    await db.execute(
        "UPDATE pages SET content_md = ? WHERE slug = ?",
        ("uniquesearchtoken123 leaked", "anon-search-restricted"),
    )
    await db.commit()
    from app.services.search import rebuild_search_index
    rows = await db.execute_fetchall(
        "SELECT id, title FROM pages WHERE slug = 'anon-search-restricted'"
    )
    await rebuild_search_index(db, rows[0]["id"], rows[0]["title"], "uniquesearchtoken123 leaked")
    await db.commit()

    res = await client.get("/api/search?q=uniquesearchtoken123")
    assert res.status_code == 200
    found_slugs = {r["slug"] for r in res.json().get("results", [])}
    assert "anon-search-open" in found_slugs
    assert "anon-search-restricted" not in found_slugs


@pytest.mark.asyncio
async def test_flag_on_graph_filters_restricted_pages(anon_on, auth_user, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "GraphOpen", "content_md": "x", "slug": "anon-graph-open",
    })
    await _make_acl_restricted_page(auth_client, "anon-graph-restricted", auth_user["user"]["id"])

    res = await client.get("/api/pages/graph")
    assert res.status_code == 200
    nodes = res.json().get("nodes", [])
    slugs = {n.get("slug") for n in nodes}
    assert "anon-graph-open" in slugs
    assert "anon-graph-restricted" not in slugs


@pytest.mark.asyncio
async def test_flag_on_comments_list_open_to_guest(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Anon comments page", "content_md": "x", "slug": "anon-comments-page",
    })
    res = await client.get("/api/pages/anon-comments-page/comments")
    assert res.status_code == 200


# ── Flag ON: writes still 401 ────────────────────────────────────────


@pytest.mark.asyncio
async def test_flag_on_write_endpoints_still_401(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Write target", "content_md": "x", "slug": "anon-write-target",
    })

    # POST /api/pages → 401 because viewer cap (would be 403) but anonymous
    # hits dependency before the route — endpoint uses get_current_user only,
    # so anonymous reaches the body and resolve fails. Either way, ≥400.
    res = await client.post("/api/pages", json={"title": "x", "content_md": "y"})
    assert res.status_code in (401, 403)

    # ACL-gated writes → 403 via viewer cap.
    res = await client.put("/api/pages/anon-write-target", json={
        "content_md": "z", "base_version": 1,
    })
    assert res.status_code == 403

    res = await client.delete("/api/pages/anon-write-target")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_flag_on_personal_endpoints_still_401(anon_on, auth_client, client):
    """Endpoints that don't go through ACL must reject the synthetic guest."""
    await auth_client.post("/api/pages", json={
        "title": "Personal target", "content_md": "x", "slug": "anon-personal-target",
    })

    cases = [
        ("POST", "/api/bookmarks/anon-personal-target", None),
        ("POST", "/api/pages/anon-personal-target/comments", {"content": "hi"}),
        ("POST", "/api/pages/anon-personal-target/watch", None),
        ("DELETE", "/api/pages/anon-personal-target/watch", None),
        ("GET", "/api/pages/anon-personal-target/watch", None),
        ("POST", "/api/auth/tokens", {"name": "t"}),
        ("GET", "/api/auth/tokens", None),
        ("PUT", "/api/auth/profile", {"display_name": "x"}),
        ("PUT", "/api/auth/password", {"old_password": "a", "new_password": "abcdefgh"}),
        ("GET", "/api/notifications", None),
        ("POST", "/api/ai/chat", {"message": "hi"}),
    ]
    for method, path, body in cases:
        res = await client.request(method, path, json=body)
        assert res.status_code == 401, f"{method} {path} should 401 for guest; got {res.status_code}"


@pytest.mark.asyncio
async def test_flag_on_admin_endpoints_still_403_or_401(anon_on, client):
    # Admin endpoints use require_admin, which calls get_current_user first.
    # Anonymous resolves to a viewer, then require_admin rejects with 403.
    res = await client.get("/api/dashboard/stats")
    assert res.status_code in (401, 403)
    res = await client.get("/api/users")
    assert res.status_code in (401, 403)
    res = await client.post("/api/groups", json={"name": "x"})
    assert res.status_code in (401, 403)


# ── /auth/me must always 401 unauthenticated ─────────────────────────


@pytest.mark.asyncio
async def test_flag_on_auth_me_still_401_for_guest(anon_on, client):
    """Frontend uses /auth/me 401 to detect guest mode. If it ever returned
    a synthetic user, the UI couldn't tell guest from logged-in.
    """
    res = await client.get("/api/auth/me")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_flag_on_auth_me_still_works_for_real_user(anon_on, auth_client):
    res = await auth_client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["username"] == "testuser"


# ── Settings exposure ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_settings_exposes_anonymous_read_flag(anon_on, client):
    res = await client.get("/api/settings")
    assert res.status_code == 200
    assert res.json()["anonymous_read"] is True


@pytest.mark.asyncio
async def test_settings_exposes_anonymous_read_flag_off(anon_off, client):
    res = await client.get("/api/settings")
    assert res.status_code == 200
    assert res.json()["anonymous_read"] is False


# ── view_count must not bump for guest ───────────────────────────────


@pytest.mark.asyncio
async def test_flag_on_guest_view_does_not_bump_count(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "View target", "content_md": "x", "slug": "anon-view-target",
    })
    initial = (await auth_client.get("/api/pages/anon-view-target")).json()["view_count"]

    # Two anonymous views; neither should bump the counter.
    await client.get("/api/pages/anon-view-target")
    await client.get("/api/pages/anon-view-target")

    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT view_count FROM pages WHERE slug = 'anon-view-target'"
    )
    # Count should equal `initial` (the auth_client read may have bumped it
    # by one already for the editor user — that's fine; we only assert that
    # the two anonymous reads added zero).
    assert rows[0]["view_count"] == initial


# ── is_public still works independently ──────────────────────────────


@pytest.mark.asyncio
async def test_is_public_still_works_with_flag_off(anon_off, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Public via legacy", "content_md": "hi", "slug": "anon-legacy-public",
    })
    await auth_client.put("/api/pages/anon-legacy-public", json={"is_public": True})

    res = await client.get("/api/public/pages/anon-legacy-public")
    assert res.status_code == 200


# ── Tag write paths must reject guest (regression for review BLOCKER 1) ──


@pytest.mark.asyncio
async def test_flag_on_guest_cannot_add_or_remove_tags(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Tag target", "content_md": "x", "slug": "anon-tag-target",
    })

    res = await client.post("/api/pages/anon-tag-target/tags", json={"name": "graffiti"})
    assert res.status_code == 401, "guest must not be able to add tags"

    # Add a tag as the editor first so the DELETE has something to chew on.
    await auth_client.post("/api/pages/anon-tag-target/tags", json={"name": "real"})
    res = await client.delete("/api/pages/anon-tag-target/tags/real")
    assert res.status_code == 401, "guest must not be able to remove tags"


@pytest.mark.asyncio
async def test_flag_on_guest_cannot_tag_acl_restricted_page(
    anon_on, auth_user, auth_client, client
):
    await _make_acl_restricted_page(auth_client, "anon-tag-restricted", auth_user["user"]["id"])

    # Guest gets 401 before reaching the ACL check (require_real_user fires
    # first); that's fine — the important thing is they can't write.
    res = await client.post("/api/pages/anon-tag-restricted/tags", json={"name": "leak"})
    assert res.status_code == 401


# ── Activity feed must not leak restricted page metadata (BLOCKER 2) ──


@pytest.mark.asyncio
async def test_flag_on_activity_filters_restricted_pages(
    anon_on, auth_user, auth_client, client
):
    # Open page → its create-activity row should be visible.
    await auth_client.post("/api/pages", json={
        "title": "AnonActivityOpen", "content_md": "x", "slug": "anon-activity-open",
    })
    # Restricted page → its create-activity row must be filtered out.
    await _make_acl_restricted_page(
        auth_client, "anon-activity-restricted", auth_user["user"]["id"],
    )

    res = await client.get("/api/activity")
    assert res.status_code == 200
    body = res.json()
    metas = [a.get("metadata") or {} for a in body["activities"]]
    slugs = [m.get("slug") for m in metas if isinstance(m, dict)]
    titles = [m.get("title") for m in metas if isinstance(m, dict)]
    assert "anon-activity-restricted" not in slugs
    assert "AnonActivityRestricted" not in titles  # title is "anon-activity-restricted" actually
    assert "anon-activity-restricted" not in titles


@pytest.mark.asyncio
async def test_flag_on_activity_stats_filters_restricted_pages(
    anon_on, auth_user, auth_client, client
):
    await auth_client.post("/api/pages", json={
        "title": "StatsOpen", "content_md": "x", "slug": "anon-stats-open",
    })
    await _make_acl_restricted_page(
        auth_client, "anon-stats-restricted", auth_user["user"]["id"],
    )

    res = await client.get("/api/activity/stats")
    assert res.status_code == 200
    body = res.json()
    for bucket in ("top_viewed", "recently_updated", "orphan_pages"):
        slugs = {p["slug"] for p in body[bucket]}
        assert "anon-stats-restricted" not in slugs, f"leaked in {bucket}"
    # User roster size must not be exposed to the guest.
    assert body["total_users"] == 0


# ── User / group enumeration must reject guest (BLOCKERS 3+4) ──


@pytest.mark.asyncio
async def test_flag_on_users_search_rejects_guest(anon_on, client):
    res = await client.get("/api/users/search?q=a")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_flag_on_groups_endpoints_reject_guest(anon_on, client):
    res = await client.get("/api/groups")
    assert res.status_code == 401
    res = await client.get("/api/groups/1/members")
    assert res.status_code == 401


# ── Media on open-default pages should serve to guest (SHOULD-FIX 1) ──


@pytest.mark.asyncio
async def test_flag_on_guest_can_read_media_on_open_page(
    anon_on, auth_client, client, tmp_path,
):
    # Create a page and a media row that references it. The on-disk file
    # has to exist for serve_media to reach the ACL branch; reuse the
    # MEDIA_DIR settings.
    from app.config import settings as app_settings

    await auth_client.post("/api/pages", json={
        "title": "MediaPage", "content_md": "x", "slug": "anon-media-page",
    })
    db = await get_db()
    page = (await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = 'anon-media-page'"
    ))[0]

    from pathlib import Path
    media_dir = Path(app_settings.MEDIA_DIR)
    media_dir.mkdir(parents=True, exist_ok=True)
    fname = "anon-media-test.txt"
    (media_dir / fname).write_text("hello")
    cursor = await db.execute(
        """INSERT INTO media (filename, original_name, filepath, mime_type, size_bytes, uploaded_by)
           VALUES (?, ?, ?, 'text/plain', 5, 1)""",
        (fname, fname, str(media_dir / fname)),
    )
    media_id = cursor.lastrowid
    await db.execute(
        "INSERT INTO media_references (media_id, page_id) VALUES (?, ?)",
        (media_id, page["id"]),
    )
    await db.commit()

    res = await client.get(f"/api/media/{fname}")
    assert res.status_code == 200, "guest must read media on open-default pages"


# ── Page write/admin paths via diagrams / versions / move (review gaps) ──


@pytest.mark.asyncio
async def test_flag_on_guest_blocked_on_misc_writes(anon_on, auth_client, client):
    await auth_client.post("/api/pages", json={
        "title": "Misc target", "content_md": "x", "slug": "anon-misc-target",
    })

    # Diagram create: viewer-cap inside the router → 403; require_real_user
    # would also work, but the existing endpoint uses get_current_user.
    res = await client.post("/api/diagrams", json={
        "name": "x", "xml_data": "<mxfile/>",
    })
    assert res.status_code in (401, 403)

    # Page move: viewer-cap → 403.
    res = await client.patch("/api/pages/anon-misc-target/move", json={
        "parent_id": None, "sort_order": 0,
    })
    assert res.status_code in (401, 403)
