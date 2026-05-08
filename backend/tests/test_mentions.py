"""Tests for @mention parsing and notification fan-out.

Covers the pure-extraction regex (edge cases like emails, code spans),
the ACL filter (mentioned but unreadable -> dropped), group expansion,
edit-diff (only newly added mentions notify), and the wiring through
both the page-update and comment-create code paths.
"""
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.auth import create_token, hash_password
from app.services.mention import (
    extract_mentions,
    resolve_mention_targets,
)


# ── Pure extraction ────────────────────────────────────────────────────────

def test_extract_basic_user_and_group():
    out = extract_mentions("hi @alice and @@team-x please")
    assert out["users"] == {"alice"}
    assert out["groups"] == {"team-x"}


def test_extract_ignores_email_addresses():
    out = extract_mentions("contact me at foo@bar.com or noone@example.org")
    assert out["users"] == set()
    assert out["groups"] == set()


def test_extract_ignores_inside_inline_code():
    out = extract_mentions("see `print(@alice)` for the example")
    assert out["users"] == set()


def test_extract_ignores_inside_fenced_code():
    md = "```python\n@alice = 1\n```\nthen @bob"
    out = extract_mentions(md)
    assert out["users"] == {"bob"}


def test_extract_handles_double_at_as_group_only():
    out = extract_mentions("@@admins not @admins")
    assert out["groups"] == {"admins"}
    assert out["users"] == {"admins"}  # the second one is a real user mention


def test_extract_skips_triple_at():
    # @@@bob shouldn't be parsed as either a user or group mention.
    out = extract_mentions("garbage @@@bob garbage")
    assert out["users"] == set()
    assert out["groups"] == set()


def test_extract_after_punctuation_and_brackets():
    out = extract_mentions("(@alice) [@bob] {@carol}")
    assert out["users"] == {"alice", "bob", "carol"}


def test_extract_empty_input():
    assert extract_mentions("") == {"users": set(), "groups": set()}
    assert extract_mentions(None) == {"users": set(), "groups": set()}


def test_extract_preserves_hyphen_and_underscore():
    out = extract_mentions("@alpha-beta and @user_99")
    assert out["users"] == {"alpha-beta", "user_99"}


def test_extract_ignores_indented_code_block():
    md = "ping me\n\n    @alice = 1\n\nthen done"
    out = extract_mentions(md)
    # The 4-space indent makes that line a CommonMark code block, so the
    # mention there shouldn't fire even though it isn't inside backticks.
    assert out["users"] == set()


def test_extract_does_not_strip_list_continuation_indent():
    # A list item's continuation line shares the same indent but is NOT
    # a code block — mentions inside it must still resolve.
    md = "- first line\n    @alice in the continuation"
    out = extract_mentions(md)
    assert out["users"] == {"alice"}


def test_extract_ignores_double_backtick_inline_code():
    out = extract_mentions("see ``print(@bob)`` for details")
    assert out["users"] == set()


def test_extract_ignores_tilde_fenced_code():
    out = extract_mentions("~~~\n@alice goes here\n~~~\nthen @bob")
    assert out["users"] == {"bob"}


def test_extract_ignores_mention_in_url_path():
    out = extract_mentions("see https://github.com/@octocat for details")
    assert out["users"] == set()


def test_extract_drops_leading_hyphen_username():
    # `@-bob` would never resolve to a real user — name must start alphanum.
    out = extract_mentions("hello @-bob and @alice")
    assert out["users"] == {"alice"}


def test_extract_drops_dot_username():
    # `.` is intentionally not a valid mention char; usernames containing
    # `.` are not mention-targetable.
    out = extract_mentions("@alice.smith")
    assert out["users"] == {"alice"}  # only the prefix is consumed


# ── Resolve + ACL filter (uses DB fixtures) ────────────────────────────────


async def _make_user(db, username: str, role: str = "editor") -> dict:
    rows = await db.execute_fetchall("SELECT * FROM users WHERE username = ?", (username,))
    if rows:
        return dict(rows[0])
    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (username, hash_password("pw"), role),
    )
    await db.commit()
    rows = await db.execute_fetchall("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,))
    return dict(rows[0])


async def _make_group(db, name: str, member_ids: list[int]) -> int:
    cursor = await db.execute(
        "INSERT INTO groups (name) VALUES (?)", (name,)
    )
    gid = cursor.lastrowid
    for uid in member_ids:
        await db.execute(
            "INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", (gid, uid),
        )
    await db.commit()
    return gid


@pytest.mark.asyncio
async def test_resolve_excludes_actor(auth_user, db):
    actor = auth_user["user"]
    page = await db.execute_fetchall("SELECT id FROM pages LIMIT 1")
    if not page:
        cur = await db.execute(
            "INSERT INTO pages (slug, title, content_md) VALUES ('p1','P1','')",
        )
        await db.commit()
        page_id = cur.lastrowid
    else:
        page_id = page[0]["id"]

    bob = await _make_user(db, "bob")
    targets = await resolve_mention_targets(
        db, f"@{actor['username']} @{bob['username']}", page_id, actor["id"]
    )
    assert bob["id"] in targets
    assert actor["id"] not in targets


@pytest.mark.asyncio
async def test_resolve_acl_filters_unreadable(auth_user, db):
    """A mentioned user who can't read the page must NOT be a target."""
    actor = auth_user["user"]
    locked_out = await _make_user(db, "locked_out")
    allowed = await _make_user(db, "allowed_one")

    cur = await db.execute(
        "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, '')",
        ("acl-mention-page", "ACL Mention"),
    )
    page_id = cur.lastrowid
    # Anchor: only `allowed_one` and the actor get read perm. `locked_out`
    # is excluded from the anchor and so resolves to `none`.
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'read')",
        (page_id, allowed["id"]),
    )
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'write')",
        (page_id, actor["id"]),
    )
    await db.commit()

    targets = await resolve_mention_targets(
        db,
        f"hello @{allowed['username']} and @{locked_out['username']}",
        page_id,
        actor["id"],
    )
    assert allowed["id"] in targets
    assert locked_out["id"] not in targets


@pytest.mark.asyncio
async def test_resolve_expands_group_with_acl_filter(auth_user, db):
    actor = auth_user["user"]
    member_a = await _make_user(db, "ga_member_a")
    member_b = await _make_user(db, "ga_member_b")
    group_id = await _make_group(db, "mention-group", [member_a["id"], member_b["id"]])

    cur = await db.execute(
        "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, '')",
        ("group-mention-page", "Group Mention"),
    )
    page_id = cur.lastrowid
    # Restrict to only member_a — member_b will be filtered by ACL even
    # though the @@mention-group target named them.
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'read')",
        (page_id, member_a["id"]),
    )
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'write')",
        (page_id, actor["id"]),
    )
    await db.commit()

    targets = await resolve_mention_targets(
        db, "hi @@mention-group", page_id, actor["id"]
    )
    assert member_a["id"] in targets
    assert member_b["id"] not in targets


@pytest.mark.asyncio
async def test_resolve_diff_mention_moved_into_code_block(auth_user, db):
    """An edit that wraps the mention in code should NOT re-notify it.

    The new content has the mention inside backticks, so extraction
    drops it. Diff against the old content (which had it parsed as a
    real mention) yields an empty set.
    """
    actor = auth_user["user"]
    user = await _make_user(db, "movecode_target")
    cur = await db.execute(
        "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, '')",
        ("move-code-page", "Move Code"),
    )
    page_id = cur.lastrowid
    await db.commit()

    old = f"hello @{user['username']}"
    new = f"hello `@{user['username']}` (now inside code)"
    targets = await resolve_mention_targets(
        db, new, page_id, actor["id"], old_content_md=old
    )
    assert targets == set()


@pytest.mark.asyncio
async def test_resolve_skips_soft_deleted_user(auth_user, db):
    """Mentioning a tombstoned user must not resolve to anyone."""
    actor = auth_user["user"]
    ghost = await _make_user(db, "tombstone_target")
    await db.execute(
        "UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
        (ghost["id"],),
    )
    await db.commit()

    cur = await db.execute(
        "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, '')",
        ("ghost-page", "Ghost"),
    )
    page_id = cur.lastrowid
    await db.commit()

    targets = await resolve_mention_targets(
        db, "hi @tombstone_target", page_id, actor["id"]
    )
    assert targets == set()


@pytest.mark.asyncio
async def test_resolve_diff_only_new_mentions(auth_user, db):
    """Edits should only notify mentions that weren't there before."""
    actor = auth_user["user"]
    keep = await _make_user(db, "diff_keep")
    fresh = await _make_user(db, "diff_fresh")
    cur = await db.execute(
        "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, '')",
        ("diff-page", "Diff Page"),
    )
    page_id = cur.lastrowid
    await db.commit()

    old = f"hello @{keep['username']}"
    new = f"hello @{keep['username']} and @{fresh['username']}"
    targets = await resolve_mention_targets(
        db, new, page_id, actor["id"], old_content_md=old
    )
    assert targets == {fresh["id"]}


# ── Wiring: page update + comment create end-to-end ─────────────────────────


async def _client_for(user: dict) -> AsyncClient:
    token = create_token(user["id"], user["username"], user["role"])
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_page_update_creates_mention_notification(auth_client, db):
    target = await _make_user(db, "page_mention_target")

    res = await auth_client.post(
        "/api/pages",
        json={"title": "Mentioning Page", "slug": "mention-page", "content_md": "hi"},
    )
    assert res.status_code == 201

    res = await auth_client.put(
        "/api/pages/mention-page",
        json={"content_md": "hello @page_mention_target", "base_version": 1},
    )
    assert res.status_code == 200

    async with await _client_for(target) as target_client:
        notif = await target_client.get("/api/notifications")
        assert notif.status_code == 200
        items = notif.json()["items"]
        assert any(
            i["event"] == "mention" and i["page_slug"] == "mention-page"
            for i in items
        )


@pytest.mark.asyncio
async def test_page_create_creates_mention_notification(auth_client, db):
    target = await _make_user(db, "create_mention_target")
    res = await auth_client.post(
        "/api/pages",
        json={
            "title": "Create Mention",
            "slug": "create-mention",
            "content_md": "hello @create_mention_target",
        },
    )
    assert res.status_code == 201

    async with await _client_for(target) as target_client:
        notif = await target_client.get("/api/notifications")
        items = notif.json()["items"]
        assert any(
            i["event"] == "mention" and i["page_slug"] == "create-mention"
            for i in items
        )


@pytest.mark.asyncio
async def test_comment_create_creates_mention_notification(auth_client, db):
    target = await _make_user(db, "comment_mention_target")
    await auth_client.post(
        "/api/pages",
        json={"title": "Comment Mention", "slug": "comment-mention", "content_md": "x"},
    )
    res = await auth_client.post(
        "/api/pages/comment-mention/comments",
        json={"content": "hi @comment_mention_target take a look"},
    )
    assert res.status_code == 201
    comment_id = res.json()["id"]

    async with await _client_for(target) as target_client:
        notif = await target_client.get("/api/notifications")
        items = notif.json()["items"]
        match = [i for i in items if i["event"] == "mention" and i["page_slug"] == "comment-mention"]
        assert match
        # The comment_id is recorded in metadata so the bell can deep-link.
        import json as _json
        meta = _json.loads(match[0]["metadata"])
        assert meta.get("comment_id") == comment_id


@pytest.mark.asyncio
async def test_mentionable_endpoint_returns_users_and_groups(auth_client, db):
    await _make_user(db, "mentionable_alice")
    bob = await _make_user(db, "mentionable_bob")
    await _make_group(db, "mentionable-team", [bob["id"]])

    await auth_client.post(
        "/api/pages",
        json={"title": "Mentionable", "slug": "mentionable", "content_md": "x"},
    )
    res = await auth_client.get(
        "/api/users/mentionable",
        params={"page_slug": "mentionable", "q": "mentionable"},
    )
    assert res.status_code == 200
    data = res.json()
    usernames = {u["username"] for u in data["users"]}
    assert "mentionable_alice" in usernames
    assert "mentionable_bob" in usernames
    group_names = {g["name"] for g in data["groups"]}
    assert "mentionable-team" in group_names


@pytest.mark.asyncio
async def test_mentionable_endpoint_filters_by_acl(auth_client, db, auth_user):
    actor = auth_user["user"]
    await _make_user(db, "ment_visible")
    locked = await _make_user(db, "ment_locked")

    await auth_client.post(
        "/api/pages",
        json={"title": "Mentionable ACL", "slug": "mentionable-acl", "content_md": "x"},
    )
    page_rows = await db.execute_fetchall(
        "SELECT id FROM pages WHERE slug = ?", ("mentionable-acl",)
    )
    page_id = page_rows[0]["id"]
    visible_rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE username = ?", ("ment_visible",)
    )
    visible_id = visible_rows[0]["id"]
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'read')",
        (page_id, visible_id),
    )
    await db.execute(
        "INSERT INTO page_acl (page_id, principal_type, principal_id, permission) VALUES (?, 'user', ?, 'write')",
        (page_id, actor["id"]),
    )
    await db.commit()

    res = await auth_client.get(
        "/api/users/mentionable",
        params={"page_slug": "mentionable-acl", "q": "ment_"},
    )
    usernames = {u["username"] for u in res.json()["users"]}
    assert "ment_visible" in usernames
    assert "ment_locked" not in usernames


@pytest.mark.asyncio
async def test_mentionable_endpoint_404_for_unknown_page(auth_client):
    res = await auth_client.get(
        "/api/users/mentionable",
        params={"page_slug": "definitely-not-a-page", "q": ""},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_page_update_does_not_renotify_existing_mention(auth_client, db):
    target = await _make_user(db, "renotify_target")
    await auth_client.post(
        "/api/pages",
        json={
            "title": "Renotify",
            "slug": "renotify",
            "content_md": "hi @renotify_target",
        },
    )
    async with await _client_for(target) as target_client:
        before = (await target_client.get("/api/notifications")).json()
        before_count = sum(
            1 for i in before["items"]
            if i["event"] == "mention" and i["page_slug"] == "renotify"
        )

        # Update WITHOUT adding new mentions — same target stays mentioned.
        await auth_client.put(
            "/api/pages/renotify",
            json={
                "content_md": "hi @renotify_target — and a small edit",
                "base_version": 1,
            },
        )
        after = (await target_client.get("/api/notifications")).json()
        after_count = sum(
            1 for i in after["items"]
            if i["event"] == "mention" and i["page_slug"] == "renotify"
        )
        assert after_count == before_count, "edit must not re-notify existing mentions"
