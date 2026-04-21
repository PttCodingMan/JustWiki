"""LDAP / Active Directory authentication.

Used only when `settings.LDAP_ENABLED=true`. The module is imported lazily by
the login router so sites that don't use LDAP never pay the `ldap3` import
cost (and the package can be skipped from requirements in minimal builds).

Flow:
  1. Bind with the service account, search for the user's DN.
  2. Re-bind as that DN with the supplied password — the only credible proof
     we can get from an LDAP server that the user knows the password.
  3. Fetch group memberships (optional) and reconcile them into the local
     `groups` + `group_members` tables.

The public surface is `authenticate(username, password)` and
`login_with_ldap_fallback(db, username, password)`, the latter keeps
router code readable.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


class LdapError(Exception):
    """Configuration or connection problem; caller should log and 500 or skip."""


@dataclass
class LdapUser:
    dn: str
    username: str       # what the user typed
    email: str
    display_name: str
    groups: list[str]   # full group DNs (for reconcile); may be empty
    # False when the group search raised / failed so the caller can't trust
    # `groups` as an authoritative list. Treating a failed fetch as
    # "no groups" would unconditionally demote admins on transient LDAP
    # failures; see admin-lockout bug from code review.
    groups_known: bool = True


# ── Config validation ─────────────────────────────────────────────────────


def _require_tls(server_url: str) -> None:
    """Reject plain `ldap://` unless the operator explicitly opted out of TLS.

    We can't silently downgrade because every login would then send the
    password in clear. The one "skip TLS" escape hatch is turning off
    LDAP_TLS_VERIFY — and even then ldaps:// is still required.
    """
    if not server_url.lower().startswith("ldaps://") and not server_url.lower().startswith("ldap://"):
        raise LdapError(f"LDAP_SERVER must start with ldaps:// or ldap:// (got '{server_url}')")
    if server_url.lower().startswith("ldap://"):
        raise LdapError(
            "LDAP_SERVER is plaintext ldap://; use ldaps:// to avoid leaking passwords."
        )


# ── CN extraction ─────────────────────────────────────────────────────────


_CN_RE = re.compile(r"^\s*cn\s*=\s*([^,]+)", re.IGNORECASE)


def cn_of(dn: str) -> str:
    """Pull the left-most CN value from a DN. Returns '' if not found."""
    m = _CN_RE.match(dn or "")
    return m.group(1).strip() if m else ""


# ── Bind + search ─────────────────────────────────────────────────────────


def _ldap_authenticate_sync(username: str, password: str) -> Optional[LdapUser]:
    """Synchronous LDAP auth — kept off-thread in `authenticate`.

    Returns None on bad credentials. Raises `LdapError` on misconfiguration
    so the router can distinguish "wrong password" from "LDAP broken".
    """
    # Deferred import: ldap3 isn't needed unless LDAP is enabled.
    import ldap3
    from ldap3.core.exceptions import LDAPException

    if not settings.LDAP_SERVER:
        raise LdapError("LDAP_SERVER is empty")
    _require_tls(settings.LDAP_SERVER)
    if not settings.LDAP_BIND_DN:
        raise LdapError("LDAP_BIND_DN is empty")

    use_ssl = settings.LDAP_SERVER.lower().startswith("ldaps://")
    host = settings.LDAP_SERVER.split("://", 1)[1]

    tls = None
    if use_ssl and settings.LDAP_TLS_VERIFY:
        import ssl
        tls = ldap3.Tls(validate=ssl.CERT_REQUIRED)
    elif use_ssl:
        import ssl
        tls = ldap3.Tls(validate=ssl.CERT_NONE)

    server = ldap3.Server(host, use_ssl=use_ssl, tls=tls, get_info=ldap3.NONE)

    # Service-account bind to perform the user search.
    try:
        svc = ldap3.Connection(
            server,
            user=settings.LDAP_BIND_DN,
            password=settings.LDAP_BIND_PASSWORD,
            auto_bind=True,
        )
    except LDAPException as e:
        raise LdapError(f"Service account bind failed: {e}") from e

    try:
        search_filter = settings.LDAP_USER_FILTER.format(username=ldap3.utils.conv.escape_filter_chars(username))
        attrs = [settings.LDAP_ATTR_EMAIL, settings.LDAP_ATTR_DISPLAY_NAME]
        svc.search(
            search_base=settings.LDAP_USER_BASE,
            search_filter=search_filter,
            attributes=attrs,
        )
        if not svc.entries:
            return None
        entry = svc.entries[0]
        user_dn = entry.entry_dn
        email = str(entry[settings.LDAP_ATTR_EMAIL]) if settings.LDAP_ATTR_EMAIL in entry else ""
        display_name = (
            str(entry[settings.LDAP_ATTR_DISPLAY_NAME])
            if settings.LDAP_ATTR_DISPLAY_NAME in entry else ""
        )
    finally:
        svc.unbind()

    # User-password bind: the canonical "they know the password" check.
    try:
        user_conn = ldap3.Connection(server, user=user_dn, password=password)
        if not user_conn.bind():
            return None
    except LDAPException:
        return None

    groups: list[str] = []
    # groups_known=True only when LDAP_SYNC_GROUPS is off (trivially known:
    # empty) or when the group search ran to completion. If the search
    # raises, downstream role recomputation and membership reconcile would
    # otherwise use `[]` as if the user genuinely belongs to no groups —
    # which silently demotes admins on flaky LDAP.
    groups_known = True
    try:
        if settings.LDAP_SYNC_GROUPS and settings.LDAP_GROUP_BASE:
            group_filter = settings.LDAP_GROUP_FILTER.format(
                user_dn=ldap3.utils.conv.escape_filter_chars(user_dn)
            )
            if not user_conn.search(
                search_base=settings.LDAP_GROUP_BASE,
                search_filter=group_filter,
                attributes=[],
            ):
                # ldap3 returns False on search error without raising.
                groups_known = False
                logger.warning(
                    "LDAP group search returned error for %s: %s",
                    username, user_conn.result,
                )
            else:
                groups = [e.entry_dn for e in user_conn.entries]
    except LDAPException as e:
        groups_known = False
        logger.warning("LDAP group search failed for %s: %s", username, e)
    finally:
        user_conn.unbind()

    return LdapUser(
        dn=user_dn,
        username=username,
        email=email,
        display_name=display_name,
        groups=groups,
        groups_known=groups_known,
    )


async def authenticate(username: str, password: str) -> Optional[LdapUser]:
    """Async wrapper around the blocking ldap3 calls."""
    return await asyncio.to_thread(_ldap_authenticate_sync, username, password)


# ── Provisioning + group sync ─────────────────────────────────────────────


async def _load_user_by_id(db, user_id: int) -> dict:
    rows = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email FROM users WHERE id = ?",
        (user_id,),
    )
    return dict(rows[0])


def _admin_groups() -> set[str]:
    return {g.strip() for g in settings.LDAP_ADMIN_GROUPS.split(",") if g.strip()}


def _derive_role(group_cns: list[str]) -> str:
    """Admin if any LDAP group CN matches LDAP_ADMIN_GROUPS, else default."""
    admin_cns = _admin_groups()
    if admin_cns.intersection(group_cns):
        return "admin"
    return settings.LDAP_DEFAULT_ROLE


async def _sync_groups(db, user_id: int, group_dns: list[str]) -> None:
    """Mirror the user's LDAP group membership into local `groups`.

    Only touches rows where `groups.ldap_dn IS NOT NULL` — manual groups are
    never pruned or edited. Groups referenced by DN are upserted with the CN
    as name, and members reconciled so the user's LDAP-sourced memberships
    exactly match the LDAP answer.
    """
    desired_dns = {dn for dn in group_dns if dn}

    # Upsert the LDAP-mirrored groups.
    id_by_dn: dict[str, int] = {}
    for dn in desired_dns:
        cn = cn_of(dn) or dn   # fallback: use the full DN as name
        rows = await db.execute_fetchall(
            "SELECT id FROM groups WHERE ldap_dn = ?", (dn,)
        )
        if rows:
            id_by_dn[dn] = rows[0]["id"]
            continue
        try:
            cursor = await db.execute(
                "INSERT INTO groups (name, description, ldap_dn) VALUES (?, '', ?)",
                (cn, dn),
            )
            id_by_dn[dn] = cursor.lastrowid
        except Exception:
            # Name collision with an existing manual group. Fall back to a
            # suffixed name so the two groups stay distinct; admins can rename
            # via the UI later.
            cursor = await db.execute(
                "INSERT INTO groups (name, description, ldap_dn) VALUES (?, 'Auto-imported from LDAP', ?)",
                (f"{cn}-ldap", dn),
            )
            id_by_dn[dn] = cursor.lastrowid

    # Current LDAP-sourced memberships for this user.
    rows = await db.execute_fetchall(
        """SELECT gm.group_id, g.ldap_dn
           FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE gm.user_id = ? AND g.ldap_dn IS NOT NULL""",
        (user_id,),
    )
    current_dn_to_gid = {r["ldap_dn"]: r["group_id"] for r in rows}

    # Remove memberships that are no longer in LDAP.
    stale_gids = [gid for dn, gid in current_dn_to_gid.items() if dn not in desired_dns]
    for gid in stale_gids:
        await db.execute(
            "DELETE FROM group_members WHERE group_id = ? AND user_id = ?",
            (gid, user_id),
        )

    # Add new memberships.
    new_dns = desired_dns - set(current_dn_to_gid.keys())
    for dn in new_dns:
        gid = id_by_dn[dn]
        await db.execute(
            "INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)",
            (gid, user_id),
        )


async def provision_ldap_user(db, lu: LdapUser) -> dict:
    """Ensure a local user + auth_identities row for this LDAP principal.

    Takeover guard: if a user already exists under this username with a real
    local password and no LDAP identity linked, refuse to bind. Otherwise a
    user who simply happens to share a username in the LDAP tree could
    hijack the local account.
    """
    # Already linked via identity?
    rows = await db.execute_fetchall(
        "SELECT user_id FROM auth_identities WHERE provider = 'ldap' AND subject = ?",
        (lu.dn,),
    )
    existing_linked_uid: Optional[int] = rows[0]["user_id"] if rows else None

    # Local user with the same username (could be a collision, or the already-linked LDAP user).
    rows = await db.execute_fetchall(
        "SELECT id, password_hash FROM users WHERE username = ? AND deleted_at IS NULL",
        (lu.username,),
    )
    username_row = dict(rows[0]) if rows else None

    # On a fresh-user creation we still have no authoritative group answer if
    # the search failed — default-role is the safest assumption for a brand
    # new account, so it's still okay to use _derive_role here.
    if existing_linked_uid is not None:
        user_id = existing_linked_uid
    elif username_row is None:
        cursor = await db.execute(
            """INSERT INTO users (username, password_hash, role, display_name, email)
               VALUES (?, '!', ?, ?, ?)""",
            (lu.username, _derive_role([cn_of(dn) for dn in lu.groups]), lu.display_name, lu.email),
        )
        user_id = cursor.lastrowid
        await db.execute(
            """INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
               VALUES (?, 'ldap', ?, ?, CURRENT_TIMESTAMP)""",
            (user_id, lu.dn, lu.email),
        )
    elif username_row["password_hash"] != "!":
        # Username taken by a real local account — refuse to avoid takeover.
        raise LdapError(
            f"User '{lu.username}' exists as a local account; an admin must link it manually."
        )
    else:
        # Username belongs to a shell account (invited for SSO). Link it.
        user_id = username_row["id"]
        await db.execute(
            """INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
               VALUES (?, 'ldap', ?, ?, CURRENT_TIMESTAMP)""",
            (user_id, lu.dn, lu.email),
        )

    # Refresh email + display_name every login (cheap and harmless).
    # Role + group sync only when we have a trustworthy group answer —
    # otherwise a flaky LDAP would demote admins / drop memberships.
    if lu.groups_known:
        role = _derive_role([cn_of(dn) for dn in lu.groups])
        await db.execute(
            "UPDATE users SET role = ?, email = ?, display_name = ? WHERE id = ?",
            (role, lu.email, lu.display_name, user_id),
        )
        if settings.LDAP_SYNC_GROUPS:
            await _sync_groups(db, user_id, lu.groups)
    else:
        logger.warning(
            "LDAP group info unavailable for user_id=%s; role and group membership preserved from previous login.",
            user_id,
        )
        await db.execute(
            "UPDATE users SET email = ?, display_name = ? WHERE id = ?",
            (lu.email, lu.display_name, user_id),
        )

    # Touch last_login_at.
    await db.execute(
        "UPDATE auth_identities SET last_login_at = CURRENT_TIMESTAMP "
        "WHERE provider = 'ldap' AND subject = ?",
        (lu.dn,),
    )
    await db.commit()
    return await _load_user_by_id(db, user_id)
