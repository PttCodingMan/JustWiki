"""@mention parsing and notification fan-out.

Extracts ``@username`` and ``@@groupname`` from page or comment markdown,
resolves them against the user/group tables, ACL-filters so users without
read permission on the page never receive a notification (and never appear
to be mentionable in autocomplete), and writes in-app notifications.

Syntax rules:

- Usernames and group names are matched as ``[A-Za-z0-9_-]+``. Usernames
  containing ``.`` (allowed by ``users.username`` itself) are intentionally
  not mention-targetable: allowing ``.`` in the regex makes ``user@host.``
  ambiguous with email-like text.
- A mention must NOT be preceded by an alphanumeric or another ``@`` —
  ``foo@bar`` is an email, not a mention; ``@@@bob`` parses cleanly as
  no match rather than a nested group/user mention.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from app.services.acl import resolve_page_permission

logger = logging.getLogger("justwiki.mentions")

# Group must be tested before user during scanning, because @@bob would
# otherwise match the user pattern (and we want it to mean group "bob").
#
# Negative lookbehind class includes `/` so URL paths like
# `https://github.com/@octocat` don't false-positive — the autocomplete
# never offered such a mention, so noticing one in a notification would
# be surprising. Mention name anchored to start with alphanum so
# `@-bob` / `@_bob` aren't surface forms (real usernames don't either).
_NAME = r"[A-Za-z0-9][A-Za-z0-9_-]*"
GROUP_MENTION_RE = re.compile(rf"(?<![A-Za-z0-9_@/])@@({_NAME})")
USER_MENTION_RE = re.compile(rf"(?<![A-Za-z0-9_@/])@(?!@)({_NAME})")

# Code spans and fenced code blocks shouldn't trigger mentions. The
# stripping below is best-effort parity with the markdown-it pipeline
# the viewer runs — we cover triple-backtick, triple-tilde, double- and
# single-backtick inline code, plus indented (4-space / tab) code blocks
# so a `print(@user)` snippet doesn't notify @user even when wrapped in
# the indented form. CommonMark only treats an indented run as code when
# it is preceded by a blank line; we follow that rule here.
_FENCE_BACKTICK_RE = re.compile(r"```.*?```", re.DOTALL)
_FENCE_TILDE_RE = re.compile(r"~~~.*?~~~", re.DOTALL)
_INLINE_CODE_DOUBLE_RE = re.compile(r"``[^`\n]+``")
_INLINE_CODE_SINGLE_RE = re.compile(r"`[^`\n]+`")


def _strip_indented_code(content: str) -> str:
    """Blank out lines that form a CommonMark indented code block.

    A line of 4+ leading spaces (or a tab) becomes code only when it
    follows a blank line (or the start of the document). Continuation
    lines inside a list item — same indentation but not preceded by a
    blank — stay parseable so mentions in nested list items still fire.
    """
    out = []
    prev_blank = True
    in_block = False
    for line in content.split("\n"):
        stripped = line.lstrip()
        is_blank = stripped == ""
        is_indented = line.startswith("    ") or line.startswith("\t")
        if is_indented and (prev_blank or in_block):
            in_block = True
            out.append("")
        else:
            in_block = False
            out.append(line)
        prev_blank = is_blank
    return "\n".join(out)


def _strip_code(content: str) -> str:
    # Fences first, then inline; otherwise an inline-code span on the
    # fence line could swallow the wrong characters. Order within each
    # tier (double before single backtick) matters: scanning `` ``...`` ``
    # with the single-backtick pattern first eats the leading backtick
    # and breaks the double-backtick match.
    content = _FENCE_BACKTICK_RE.sub("", content)
    content = _FENCE_TILDE_RE.sub("", content)
    content = _strip_indented_code(content)
    content = _INLINE_CODE_DOUBLE_RE.sub("", content)
    content = _INLINE_CODE_SINGLE_RE.sub("", content)
    return content


def extract_mentions(content_md: str) -> dict[str, set[str]]:
    """Return ``{"users": {...}, "groups": {...}}`` of names mentioned.

    Pure regex extraction — no DB lookup, case-sensitive, returns the
    surface form so callers can resolve to ids.
    """
    if not content_md:
        return {"users": set(), "groups": set()}
    scan = _strip_code(content_md)
    groups = {m.group(1) for m in GROUP_MENTION_RE.finditer(scan)}
    users = {m.group(1) for m in USER_MENTION_RE.finditer(scan)}
    return {"users": users, "groups": groups}


async def _resolve_user_ids(db, usernames: set[str]) -> dict[str, dict]:
    """Map ``username -> {id, username, display_name, role}`` for live users."""
    if not usernames:
        return {}
    placeholders = ",".join("?" for _ in usernames)
    rows = await db.execute_fetchall(
        f"""SELECT id, username, display_name, role
            FROM users
            WHERE username IN ({placeholders}) AND deleted_at IS NULL""",
        list(usernames),
    )
    return {r["username"]: dict(r) for r in rows}


async def _resolve_group_member_ids(db, group_names: set[str]) -> dict[str, set[int]]:
    """Map ``group_name -> {member_user_id, ...}`` for existing groups."""
    if not group_names:
        return {}
    placeholders = ",".join("?" for _ in group_names)
    rows = await db.execute_fetchall(
        f"""SELECT g.name, gm.user_id
            FROM groups g
            JOIN group_members gm ON gm.group_id = g.id
            JOIN users u ON u.id = gm.user_id
            WHERE g.name IN ({placeholders}) AND u.deleted_at IS NULL""",
        list(group_names),
    )
    out: dict[str, set[int]] = {}
    for r in rows:
        out.setdefault(r["name"], set()).add(r["user_id"])
    return out


async def _filter_readable(db, user_ids: set[int], page_id: int) -> set[int]:
    """Drop user_ids whose effective permission on ``page_id`` is ``none``.

    Calls ``resolve_page_permission`` per user. The set sizes here are
    bounded by how many distinct people get mentioned in a single edit,
    so the per-user round-trip is fine in practice.
    """
    if not user_ids:
        return set()
    out: set[int] = set()
    for uid in user_ids:
        # resolve_page_permission expects the user dict shape used by
        # routers/auth.py — only `id` and `role` are read.
        rows = await db.execute_fetchall(
            "SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL", (uid,)
        )
        if not rows:
            continue
        perm = await resolve_page_permission(db, dict(rows[0]), page_id)
        if perm != "none":
            out.add(uid)
    return out


async def resolve_mention_targets(
    db,
    content_md: str,
    page_id: int,
    actor_id: int,
    *,
    old_content_md: Optional[str] = None,
) -> set[int]:
    """Return user_ids to notify for the given content.

    - Resolves @user and @@group names against live users/groups
    - Expands group mentions to their member user_ids
    - Excludes the actor (no self-notify)
    - Filters by ACL — users without read permission on the page are dropped
    - If ``old_content_md`` is given, only newly-added mentions notify; this
      avoids re-notifying existing mentions on every edit. Resolution still
      runs against the new content so a renamed user/group is handled
      correctly when the surface form changes.
    """
    new_mentions = extract_mentions(content_md)
    if old_content_md is not None:
        old_mentions = extract_mentions(old_content_md)
        users_to_notify = new_mentions["users"] - old_mentions["users"]
        groups_to_notify = new_mentions["groups"] - old_mentions["groups"]
    else:
        users_to_notify = new_mentions["users"]
        groups_to_notify = new_mentions["groups"]

    if not users_to_notify and not groups_to_notify:
        return set()

    user_rows = await _resolve_user_ids(db, users_to_notify)
    group_members = await _resolve_group_member_ids(db, groups_to_notify)

    candidate_ids: set[int] = {row["id"] for row in user_rows.values()}
    for member_ids in group_members.values():
        candidate_ids |= member_ids

    candidate_ids.discard(actor_id)
    return await _filter_readable(db, candidate_ids, page_id)


async def notify_mentions(
    db,
    *,
    content_md: str,
    page_id: int,
    actor: dict,
    comment_id: Optional[int] = None,
    old_content_md: Optional[str] = None,
) -> None:
    """Insert ``event='mention'`` notifications for everyone newly mentioned.

    Failures are logged but never raised — a notification glitch must not
    block the underlying page/comment write that triggered it.
    """
    try:
        target_ids = await resolve_mention_targets(
            db,
            content_md,
            page_id,
            actor.get("id"),
            old_content_md=old_content_md,
        )
        if not target_ids:
            return

        page_rows = await db.execute_fetchall(
            "SELECT title, slug FROM pages WHERE id = ?", (page_id,)
        )
        if not page_rows:
            return
        page_title = page_rows[0]["title"]
        page_slug = page_rows[0]["slug"]

        snippet = _make_snippet(content_md)
        metadata = {
            "title": page_title,
            "slug": page_slug,
            "snippet": snippet,
        }
        if comment_id is not None:
            metadata["comment_id"] = comment_id
        metadata_json = json.dumps(metadata)

        for uid in target_ids:
            await db.execute(
                """INSERT INTO notifications (user_id, event, page_id, actor_id, metadata)
                   VALUES (?, 'mention', ?, ?, ?)""",
                (uid, page_id, actor.get("id"), metadata_json),
            )
        await db.commit()
    except Exception as exc:  # pragma: no cover — guardrail
        logger.warning("notify_mentions failed: %s", exc)


_SNIPPET_LEN = 140


def _make_snippet(content_md: str) -> str:
    """Short plaintext-ish preview of the mention context, for the bell UI.

    We do not try to render markdown — just collapse whitespace and clip.
    Sanitization happens at render time in the frontend.
    """
    if not content_md:
        return ""
    flat = " ".join(content_md.split())
    if len(flat) <= _SNIPPET_LEN:
        return flat
    return flat[: _SNIPPET_LEN - 1] + "…"
