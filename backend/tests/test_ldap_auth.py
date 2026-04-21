"""LDAP provisioning + group-sync reconcile.

We don't simulate an LDAP server. ldap3's MockSyncStrategy is possible but
requires OFFLINE schema setup that buys us little — the bind/search layer
is mostly `ldap3` boilerplate. Instead we test the business logic in
`provision_ldap_user` and `_sync_groups` directly, which is where the
interesting invariants live (takeover guard, group reconcile, admin-group
mapping).
"""
import pytest

from app.config import settings
from app.services.ldap_auth import (
    LdapError,
    LdapUser,
    cn_of,
    provision_ldap_user,
)


def _lu(**kwargs) -> LdapUser:
    base = dict(
        dn="uid=alice,ou=people,dc=example,dc=com",
        username="alice",
        email="alice@example.com",
        display_name="Alice",
        groups=[],
    )
    base.update(kwargs)
    return LdapUser(**base)


# ── Utility helpers ────────────────────────────────────────────────────────


def test_cn_of_extracts_leftmost_cn():
    assert cn_of("cn=wiki-admins,ou=groups,dc=ex,dc=com") == "wiki-admins"
    assert cn_of("CN=Wiki Editors,ou=groups") == "Wiki Editors"
    assert cn_of("uid=x,ou=people") == ""
    assert cn_of("") == ""


# ── Provisioning ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provisioning_creates_fresh_user(db, monkeypatch):
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", False)

    user = await provision_ldap_user(
        db,
        _lu(
            username="fresh-ldap",
            dn="uid=fresh,ou=people,dc=example,dc=com",
            email="fresh@example.com",
        ),
    )
    assert user["role"] == "editor"
    assert user["username"] == "fresh-ldap"

    rows = await db.execute_fetchall(
        "SELECT provider, subject FROM auth_identities WHERE user_id = ?",
        (user["id"],),
    )
    assert rows[0]["provider"] == "ldap"


@pytest.mark.asyncio
async def test_takeover_guard_blocks_local_username(db, monkeypatch):
    """An LDAP bind must not silently link to a pre-existing real local user."""
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", False)
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")

    await db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("takeover-target", "realbcrypthash", "editor"),
    )
    await db.commit()

    with pytest.raises(LdapError):
        await provision_ldap_user(
            db,
            _lu(username="takeover-target", dn="uid=x,ou=people,dc=example,dc=com"),
        )


@pytest.mark.asyncio
async def test_shell_account_gets_linked(db, monkeypatch):
    """An invited SSO shell account (password_hash='!') is linkable."""
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", False)
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")

    cursor = await db.execute(
        "INSERT INTO users (username, password_hash, role, email) VALUES (?, '!', ?, ?)",
        ("shell-user", "editor", "shell@example.com"),
    )
    shell_id = cursor.lastrowid
    await db.commit()

    user = await provision_ldap_user(
        db,
        _lu(
            username="shell-user",
            dn="uid=shell,ou=people,dc=example,dc=com",
            email="shell@example.com",
        ),
    )
    assert user["id"] == shell_id


@pytest.mark.asyncio
async def test_admin_group_promotes_role(db, monkeypatch):
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "wiki-admins")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", False)

    user = await provision_ldap_user(
        db,
        _lu(
            username="admin-ldap",
            dn="uid=admin-ldap,ou=people,dc=ex,dc=com",
            groups=["cn=wiki-admins,ou=groups,dc=ex,dc=com"],
        ),
    )
    assert user["role"] == "admin"


@pytest.mark.asyncio
async def test_admin_role_revoked_on_next_login(db, monkeypatch):
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "wiki-admins")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", False)

    dn = "uid=rev-admin,ou=people,dc=ex,dc=com"
    promoted = await provision_ldap_user(
        db,
        _lu(username="rev-admin", dn=dn, groups=["cn=wiki-admins,ou=groups,dc=ex,dc=com"]),
    )
    assert promoted["role"] == "admin"

    # Same user, this time without the admin group.
    demoted = await provision_ldap_user(
        db, _lu(username="rev-admin", dn=dn, groups=[])
    )
    assert demoted["id"] == promoted["id"]
    assert demoted["role"] == "editor"


@pytest.mark.asyncio
async def test_admin_not_demoted_when_group_search_failed(db, monkeypatch):
    """Regression: an LDAP group-search exception must not downgrade the
    user's role. Otherwise every admin whose login happens to race a flaky
    group-search gets silently demoted."""
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "wiki-admins")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", True)

    dn = "uid=flaky-admin,ou=people,dc=ex,dc=com"
    promoted = await provision_ldap_user(
        db,
        _lu(
            username="flaky-admin",
            dn=dn,
            groups=["cn=wiki-admins,ou=groups,dc=ex,dc=com"],
        ),
    )
    assert promoted["role"] == "admin"

    # Same user, this time group search FAILED — `groups=[]` but groups_known=False.
    # Role must stay `admin`.
    after_flaky = await provision_ldap_user(
        db,
        _lu(username="flaky-admin", dn=dn, groups=[], groups_known=False),
    )
    assert after_flaky["role"] == "admin"


@pytest.mark.asyncio
async def test_group_membership_preserved_when_search_failed(db, monkeypatch):
    """Regression: a failed group search must not prune memberships."""
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", True)

    dn = "uid=flaky-gs,ou=people,dc=ex,dc=com"
    user = await provision_ldap_user(
        db,
        _lu(
            username="flaky-gs",
            dn=dn,
            groups=["cn=dev,ou=groups,dc=ex,dc=com", "cn=qa,ou=groups,dc=ex,dc=com"],
        ),
    )

    # Now login again with a failed group search.
    await provision_ldap_user(
        db, _lu(username="flaky-gs", dn=dn, groups=[], groups_known=False)
    )

    rows = await db.execute_fetchall(
        """SELECT g.ldap_dn FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE gm.user_id = ?""",
        (user["id"],),
    )
    assert len(rows) == 2  # both memberships preserved


# ── Group sync ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_group_sync_upserts_and_removes(db, monkeypatch):
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", True)

    dev_dn = "cn=dev,ou=groups,dc=ex,dc=com"
    qa_dn = "cn=qa,ou=groups,dc=ex,dc=com"

    # First login: user in two groups.
    user = await provision_ldap_user(
        db,
        _lu(
            username="groupsync-u",
            dn="uid=gs,ou=people,dc=ex,dc=com",
            groups=[dev_dn, qa_dn],
        ),
    )

    rows = await db.execute_fetchall(
        """SELECT g.ldap_dn FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE gm.user_id = ?""",
        (user["id"],),
    )
    assert {r["ldap_dn"] for r in rows} == {dev_dn, qa_dn}

    # Second login: dropped `qa`.
    await provision_ldap_user(
        db,
        _lu(
            username="groupsync-u",
            dn="uid=gs,ou=people,dc=ex,dc=com",
            groups=[dev_dn],
        ),
    )
    rows = await db.execute_fetchall(
        """SELECT g.ldap_dn FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           WHERE gm.user_id = ?""",
        (user["id"],),
    )
    assert {r["ldap_dn"] for r in rows} == {dev_dn}


@pytest.mark.asyncio
async def test_group_sync_preserves_manual_memberships(db, monkeypatch):
    """A manually-created group (ldap_dn IS NULL) must survive LDAP reconcile."""
    monkeypatch.setattr(settings, "LDAP_SYNC_GROUPS", True)
    monkeypatch.setattr(settings, "LDAP_ADMIN_GROUPS", "")
    monkeypatch.setattr(settings, "LDAP_DEFAULT_ROLE", "editor")

    # Manual group + membership
    cursor = await db.execute(
        "INSERT INTO groups (name, description, ldap_dn) VALUES (?, '', NULL)",
        ("hand-made",),
    )
    manual_gid = cursor.lastrowid
    await db.commit()

    user = await provision_ldap_user(
        db,
        _lu(
            username="mixed",
            dn="uid=mix,ou=people,dc=ex,dc=com",
            groups=["cn=dev,ou=groups,dc=ex,dc=com"],
        ),
    )
    await db.execute(
        "INSERT INTO group_members (group_id, user_id) VALUES (?, ?)",
        (manual_gid, user["id"]),
    )
    await db.commit()

    # New LDAP login with no groups — must not prune the manual membership.
    await provision_ldap_user(
        db,
        _lu(username="mixed", dn="uid=mix,ou=people,dc=ex,dc=com", groups=[]),
    )
    rows = await db.execute_fetchall(
        "SELECT group_id FROM group_members WHERE user_id = ?", (user["id"],)
    )
    gids = {r["group_id"] for r in rows}
    assert manual_gid in gids
