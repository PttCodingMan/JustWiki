"""OIDC access-control gates + provisioning.

We don't simulate the full authlib authorization-code exchange — that would
require a fake IdP over HTTP. Instead we test the layer directly responsible
for business logic: `authenticate_and_provision(UserInfo)` and
`check_access_gates`. This gives high-fidelity coverage of invitation-only
mode, email linking, signup, and each allowlist/group gate.
"""
import pytest

from app.config import settings
from app.services.oidc import (
    OAuthAccessError,
    UserInfo,
    authenticate_and_provision,
    check_access_gates,
    list_enabled_providers,
)


def _info(**kwargs) -> UserInfo:
    base = dict(
        provider="google",
        subject="sub-000",
        email="x@example.com",
        email_verified=True,
        display_name="X",
        groups=[],
    )
    base.update(kwargs)
    return UserInfo(**base)


# ── Gates ──────────────────────────────────────────────────────────────────


def test_domain_gate_rejects_unlisted(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "allowed.com")
    with pytest.raises(OAuthAccessError) as excinfo:
        check_access_gates(_info(email="nope@evil.com"))
    assert excinfo.value.code == "domain_not_allowed"


def test_domain_gate_passes_when_unset(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    # No raise
    check_access_gates(_info(email="anyone@any.com"))


def test_email_allowlist_gate(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "alice@ex.com,bob@ex.com")
    check_access_gates(_info(email="alice@ex.com"))
    with pytest.raises(OAuthAccessError) as excinfo:
        check_access_gates(_info(email="eve@ex.com"))
    assert excinfo.value.code == "email_not_allowed"


def test_required_groups_gate(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "wiki-users")
    check_access_gates(_info(groups=["wiki-users", "other"]))
    with pytest.raises(OAuthAccessError) as excinfo:
        check_access_gates(_info(groups=["nothing-relevant"]))
    assert excinfo.value.code == "group_not_allowed"


# ── Provisioning ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invitation_only_rejects_unknown_user(db, monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    with pytest.raises(OAuthAccessError) as excinfo:
        await authenticate_and_provision(
            _info(email="stranger@example.com", subject="sub-stranger")
        )
    assert excinfo.value.code == "not_invited"


@pytest.mark.asyncio
async def test_invitation_only_links_preprovisioned_user(db, admin_client, monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    invite = await admin_client.post(
        "/api/users/invite",
        json={"email": "preprov@example.com", "role": "editor"},
    )
    assert invite.status_code == 201
    invited_id = invite.json()["id"]

    user = await authenticate_and_provision(
        _info(email="preprov@example.com", subject="sub-preprov-1")
    )
    assert user["id"] == invited_id

    # Identity row was created and bound to the invited user
    rows = await db.execute_fetchall(
        "SELECT user_id, provider FROM auth_identities WHERE subject = ?",
        ("sub-preprov-1",),
    )
    assert len(rows) == 1
    assert rows[0]["user_id"] == invited_id
    assert rows[0]["provider"] == "google"


@pytest.mark.asyncio
async def test_second_login_returns_same_user(db, admin_client, monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    await admin_client.post(
        "/api/users/invite", json={"email": "repeat@example.com", "role": "editor"},
    )
    first = await authenticate_and_provision(
        _info(email="repeat@example.com", subject="sub-repeat")
    )
    second = await authenticate_and_provision(
        _info(email="repeat@example.com", subject="sub-repeat")
    )
    assert first["id"] == second["id"]

    # Still exactly one identity row for this (provider, subject)
    rows = await db.execute_fetchall(
        "SELECT id FROM auth_identities WHERE subject = ?", ("sub-repeat",),
    )
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_signup_enabled_creates_new_user(db, monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", True)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")
    monkeypatch.setattr(settings, "OIDC_DEFAULT_ROLE", "editor")

    user = await authenticate_and_provision(
        _info(email="newbie@example.com", subject="sub-newbie", display_name="Newbie")
    )
    assert user["email"] == "newbie@example.com"
    assert user["role"] == "editor"
    assert user["username"] == "newbie"

    # password_hash sentinel so local login stays disabled
    rows = await db.execute_fetchall(
        "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
    )
    assert rows[0]["password_hash"] == "!"


@pytest.mark.asyncio
async def test_unverified_email_does_not_link(db, admin_client, monkeypatch):
    """A provider that claims email but says email_verified=False must not
    auto-link to an existing account — that would let a malicious IdP
    impersonate any user whose email they can guess."""
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    await admin_client.post(
        "/api/users/invite",
        json={"email": "verified@example.com", "role": "editor"},
    )
    with pytest.raises(OAuthAccessError) as excinfo:
        await authenticate_and_provision(
            _info(
                email="verified@example.com",
                email_verified=False,
                subject="attacker-sub",
            )
        )
    # Falls through to signup path, which is disabled in invitation-only
    assert excinfo.value.code == "not_invited"


@pytest.mark.asyncio
async def test_reinvite_after_delete_links_to_fresh_user(db, admin_client, monkeypatch):
    """Regression: deleting a user must drop their SSO bindings so a later
    re-invite of the same email is reachable. Otherwise the old identity row
    still matches and resolves to the tombstoned user → `user_disabled`."""
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    first = await admin_client.post(
        "/api/users/invite", json={"email": "churn@example.com", "role": "editor"},
    )
    first_id = first.json()["id"]
    await authenticate_and_provision(
        _info(email="churn@example.com", subject="sub-churn")
    )
    # Admin removes them.
    await admin_client.delete(f"/api/users/{first_id}")

    # Admin re-invites same email.
    second = await admin_client.post(
        "/api/users/invite", json={"email": "churn@example.com", "role": "editor"},
    )
    assert second.status_code == 201
    second_id = second.json()["id"]

    # User signs in via SSO with the *same* provider subject. Should resolve
    # to the fresh account — the old identity must have been wiped on delete.
    user = await authenticate_and_provision(
        _info(email="churn@example.com", subject="sub-churn")
    )
    assert user["id"] == second_id


@pytest.mark.asyncio
async def test_deleted_user_cannot_sso_in(db, admin_client, monkeypatch):
    """After `delete_user` cleans up identities, a deleted user looks like
    'never invited' to the SSO path — which is the correct answer under
    invitation-only mode. The user stays locked out until admin re-invites."""
    monkeypatch.setattr(settings, "OIDC_ALLOW_SIGNUP", False)
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAIL_DOMAINS", "")
    monkeypatch.setattr(settings, "OIDC_ALLOWED_EMAILS", "")
    monkeypatch.setattr(settings, "OIDC_REQUIRED_GROUPS", "")

    invited = await admin_client.post(
        "/api/users/invite", json={"email": "doomed@example.com", "role": "editor"},
    )
    user_id = invited.json()["id"]

    # First SSO login links the identity
    await authenticate_and_provision(
        _info(email="doomed@example.com", subject="sub-doomed")
    )
    # Admin then soft-deletes the user
    await admin_client.delete(f"/api/users/{user_id}")

    with pytest.raises(OAuthAccessError) as excinfo:
        await authenticate_and_provision(
            _info(email="doomed@example.com", subject="sub-doomed")
        )
    assert excinfo.value.code == "not_invited"


# ── Provider registry ──────────────────────────────────────────────────────


def test_providers_hidden_when_oidc_disabled(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ENABLED", False)
    monkeypatch.setattr(settings, "OIDC_PROVIDERS", "google,github,generic")
    assert list_enabled_providers() == []


def test_providers_filtered_by_configuration(monkeypatch):
    monkeypatch.setattr(settings, "OIDC_ENABLED", True)
    monkeypatch.setattr(settings, "OIDC_PROVIDERS", "google,github,generic")
    monkeypatch.setattr(settings, "OIDC_GOOGLE_CLIENT_ID", "google-id")
    monkeypatch.setattr(settings, "OIDC_GOOGLE_CLIENT_SECRET", "google-secret")
    # GitHub missing a secret → excluded
    monkeypatch.setattr(settings, "OIDC_GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "OIDC_GITHUB_CLIENT_SECRET", "")
    # Generic missing discovery → excluded
    monkeypatch.setattr(settings, "OIDC_GENERIC_CLIENT_ID", "gen-id")
    monkeypatch.setattr(settings, "OIDC_GENERIC_CLIENT_SECRET", "gen-secret")
    monkeypatch.setattr(settings, "OIDC_GENERIC_DISCOVERY", "")

    ids = [p["id"] for p in list_enabled_providers()]
    assert ids == ["google"]
