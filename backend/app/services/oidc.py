"""OIDC / OAuth SSO integration.

Architecture: a registry of providers (Google, GitHub, generic OIDC) built
from settings on demand. The router hands off to `authenticate_and_provision`
which fetches the userinfo, runs access-control gates, and returns the local
user row (linking or creating as appropriate).

Three flows:
  * Identity match  — `(provider, sub)` already in `auth_identities` → log in.
  * Email link      — existing local user with the same verified email.
                      Writes a new `auth_identities` row; keeps the user row.
  * Signup          — creates a shell user (password_hash='!', disabled) iff
                      `OIDC_ALLOW_SIGNUP=true`.

All three run after the gates, which are evaluated by
`check_access_gates` (domain / email allowlist / required groups).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import Request

from app.config import settings
from app.database import get_db

logger = logging.getLogger(__name__)


class OAuthAccessError(Exception):
    """Gate failures or IdP issues that should be surfaced to the user.

    The `code` is passed back via `?error=<code>` so the Login page can
    render a localized message without exposing internals.
    """
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


@dataclass
class UserInfo:
    provider: str
    subject: str
    email: str
    email_verified: bool
    display_name: str
    groups: list[str]


# ── Registry ──────────────────────────────────────────────────────────────


def _enabled_provider_ids() -> list[str]:
    return [p.strip() for p in settings.OIDC_PROVIDERS.split(",") if p.strip()]


def _provider_configured(pid: str) -> bool:
    if pid == "google":
        return bool(
            settings.OIDC_GOOGLE_CLIENT_ID
            and settings.OIDC_GOOGLE_CLIENT_SECRET.get_secret_value()
        )
    if pid == "github":
        return bool(
            settings.OIDC_GITHUB_CLIENT_ID
            and settings.OIDC_GITHUB_CLIENT_SECRET.get_secret_value()
        )
    if pid == "generic":
        return bool(
            settings.OIDC_GENERIC_CLIENT_ID
            and settings.OIDC_GENERIC_CLIENT_SECRET.get_secret_value()
            and settings.OIDC_GENERIC_DISCOVERY
        )
    return False


def list_enabled_providers() -> list[dict]:
    """Public-facing list used by `GET /api/auth/providers` and Login page."""
    if not settings.OIDC_ENABLED:
        return []
    out: list[dict] = []
    for pid in _enabled_provider_ids():
        if not _provider_configured(pid):
            continue
        if pid == "google":
            out.append({"id": "google", "name": "Google"})
        elif pid == "github":
            out.append({"id": "github", "name": "GitHub"})
        elif pid == "generic":
            out.append({"id": "generic", "name": settings.OIDC_GENERIC_NAME or "Company SSO"})
    return out


_oauth: Optional[OAuth] = None


def get_oauth() -> OAuth:
    """Lazily build the authlib OAuth registry.

    Lazy so tests can mutate settings before first access. Registered clients
    live on the returned `OAuth` instance; `create_client(name)` returns None
    for unknown provider ids.
    """
    global _oauth
    if _oauth is not None:
        return _oauth

    oauth = OAuth()
    for pid in _enabled_provider_ids():
        if not _provider_configured(pid):
            continue
        if pid == "google":
            oauth.register(
                name="google",
                client_id=settings.OIDC_GOOGLE_CLIENT_ID,
                client_secret=settings.OIDC_GOOGLE_CLIENT_SECRET.get_secret_value(),
                server_metadata_url=settings.OIDC_GOOGLE_DISCOVERY,
                client_kwargs={"scope": "openid email profile"},
            )
        elif pid == "github":
            # GitHub is OAuth2-only (no OIDC). Profile is fetched via REST API
            # in `_fetch_github_userinfo`.
            oauth.register(
                name="github",
                client_id=settings.OIDC_GITHUB_CLIENT_ID,
                client_secret=settings.OIDC_GITHUB_CLIENT_SECRET.get_secret_value(),
                access_token_url="https://github.com/login/oauth/access_token",
                authorize_url="https://github.com/login/oauth/authorize",
                api_base_url="https://api.github.com/",
                client_kwargs={"scope": "read:user user:email"},
            )
        elif pid == "generic":
            oauth.register(
                name="generic",
                client_id=settings.OIDC_GENERIC_CLIENT_ID,
                client_secret=settings.OIDC_GENERIC_CLIENT_SECRET.get_secret_value(),
                server_metadata_url=settings.OIDC_GENERIC_DISCOVERY,
                client_kwargs={"scope": "openid email profile"},
            )
    _oauth = oauth
    return oauth


def reset_oauth_registry() -> None:
    """Clear the cached registry (used by tests that mutate settings)."""
    global _oauth
    _oauth = None


# ── Userinfo fetchers ─────────────────────────────────────────────────────


async def _fetch_github_userinfo(client, token) -> UserInfo:
    """GitHub quirks: private email → secondary API call."""
    resp = await client.get("user", token=token)
    resp.raise_for_status()
    profile = resp.json()

    email = profile.get("email")
    # Private primary → query /user/emails (needs user:email scope).
    if not email:
        emails_resp = await client.get("user/emails", token=token)
        emails_resp.raise_for_status()
        for entry in emails_resp.json():
            if entry.get("primary") and entry.get("verified"):
                email = entry.get("email")
                break
    if not email:
        raise OAuthAccessError(
            "github_no_email",
            "GitHub account has no verified primary email available.",
        )

    return UserInfo(
        provider="github",
        subject=str(profile["id"]),
        email=email.lower(),
        email_verified=True,  # we only accept GitHub's verified primary
        display_name=profile.get("name") or profile.get("login") or "",
        groups=[],            # GitHub OAuth doesn't expose org/team membership here
    )


def _fetch_oidc_userinfo(provider: str, token) -> UserInfo:
    userinfo = token.get("userinfo") or {}
    email = (userinfo.get("email") or "").lower()
    if not email:
        raise OAuthAccessError("no_email", "IdP did not return an email address.")
    return UserInfo(
        provider=provider,
        subject=str(userinfo.get("sub")),
        email=email,
        email_verified=bool(userinfo.get("email_verified", False)),
        display_name=userinfo.get("name") or userinfo.get("preferred_username") or "",
        groups=list(userinfo.get("groups") or []),
    )


# ── Access gates ──────────────────────────────────────────────────────────


def _split_csv(raw: str) -> list[str]:
    return [x.strip() for x in raw.split(",") if x.strip()]


def check_access_gates(info: UserInfo) -> None:
    """Raise OAuthAccessError if any configured gate rejects this user.

    Gates are independent: each one only applies if its config is non-empty.
    """
    if settings.OIDC_ALLOWED_EMAIL_DOMAINS:
        allowed = [d.lower() for d in _split_csv(settings.OIDC_ALLOWED_EMAIL_DOMAINS)]
        domain = info.email.rsplit("@", 1)[-1].lower() if "@" in info.email else ""
        if domain not in allowed:
            raise OAuthAccessError("domain_not_allowed", f"Email domain '{domain}' is not allowed.")

    if settings.OIDC_ALLOWED_EMAILS:
        allowed_emails = {e.lower() for e in _split_csv(settings.OIDC_ALLOWED_EMAILS)}
        if info.email.lower() not in allowed_emails:
            raise OAuthAccessError("email_not_allowed", f"Email '{info.email}' is not on the invite list.")

    if settings.OIDC_REQUIRED_GROUPS:
        required = set(_split_csv(settings.OIDC_REQUIRED_GROUPS))
        if not required.intersection(set(info.groups)):
            raise OAuthAccessError("group_not_allowed", "Required group membership is missing.")


# ── Provisioning ──────────────────────────────────────────────────────────


_USERNAME_RE = re.compile(r"[^a-zA-Z0-9._-]")


def _derive_username(email: str) -> str:
    local = email.split("@", 1)[0]
    cleaned = _USERNAME_RE.sub("-", local).strip("-")
    return cleaned or "user"


async def _username_available(db, candidate: str) -> bool:
    rows = await db.execute_fetchall(
        "SELECT 1 FROM users WHERE username = ? LIMIT 1", (candidate,)
    )
    return not rows


async def _pick_unique_username(db, email: str) -> str:
    base = _derive_username(email)
    if await _username_available(db, base):
        return base
    for i in range(2, 100):
        cand = f"{base}-{i}"
        if await _username_available(db, cand):
            return cand
    raise OAuthAccessError("username_collision", "Could not generate a unique username.")


async def _load_user_by_id(db, user_id: int) -> dict:
    rows = await db.execute_fetchall(
        "SELECT id, username, role, display_name, email FROM users WHERE id = ? AND deleted_at IS NULL",
        (user_id,),
    )
    if not rows:
        raise OAuthAccessError("user_disabled", "User account is disabled.")
    return dict(rows[0])


async def _record_login(db, identity_id: int) -> None:
    await db.execute(
        "UPDATE auth_identities SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
        (identity_id,),
    )


async def authenticate_and_provision(info: UserInfo) -> dict:
    """Resolve a UserInfo to a local user row, applying gates and provisioning.

    Returns the user dict `{id, username, role, display_name, email}` suitable
    for `create_token()`. Raises `OAuthAccessError` on any rejection so the
    caller can redirect to `/login?error=<code>`.
    """
    check_access_gates(info)

    db = await get_db()

    # 1. Identity match: (provider, sub) already linked.
    rows = await db.execute_fetchall(
        "SELECT id, user_id FROM auth_identities WHERE provider = ? AND subject = ?",
        (info.provider, info.subject),
    )
    if rows:
        identity_id = rows[0]["id"]
        user_id = rows[0]["user_id"]
        user = await _load_user_by_id(db, user_id)
        await _record_login(db, identity_id)
        await db.commit()
        return user

    # 2. Email link: an existing local user with the same email (requires
    #    verified email to avoid takeover via an unverified claim).
    if info.email_verified:
        rows = await db.execute_fetchall(
            "SELECT id FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL",
            (info.email.lower(),),
        )
        if rows:
            user_id = rows[0]["id"]
            cursor = await db.execute(
                """INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                (user_id, info.provider, info.subject, info.email),
            )
            await db.commit()
            user = await _load_user_by_id(db, user_id)
            logger.info("Linked SSO identity %s:%s to user_id=%d", info.provider, info.subject, user_id)
            return user

    # 3. Signup (only if allowed).
    if not settings.OIDC_ALLOW_SIGNUP:
        raise OAuthAccessError(
            "not_invited",
            "This wiki is invitation-only. Ask an admin to add your email.",
        )

    username = await _pick_unique_username(db, info.email)
    role = settings.OIDC_DEFAULT_ROLE
    cursor = await db.execute(
        """INSERT INTO users (username, password_hash, role, display_name, email)
           VALUES (?, '!', ?, ?, ?)""",
        (username, role, info.display_name, info.email),
    )
    user_id = cursor.lastrowid
    await db.execute(
        """INSERT INTO auth_identities (user_id, provider, subject, email, last_login_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        (user_id, info.provider, info.subject, info.email),
    )
    await db.commit()
    logger.info("Provisioned new SSO user %s (id=%d) via %s", username, user_id, info.provider)
    return await _load_user_by_id(db, user_id)


# ── Public entrypoint for the router ──────────────────────────────────────


async def exchange_and_resolve(provider: str, request: Request) -> dict:
    """Top-level callback handler: exchange code, fetch userinfo, provision.

    Raises `OAuthAccessError` for all expected failure modes (network glitches
    and bad IdP responses surface as `oauth_failed`).
    """
    oauth = get_oauth()
    client = oauth.create_client(provider)
    if client is None:
        raise OAuthAccessError("unknown_provider", f"Provider '{provider}' is not configured.")

    try:
        token = await client.authorize_access_token(request)
    except OAuthError as e:
        # The authlib message can carry IdP-specific detail (endpoint URLs,
        # scopes, client IDs). Log it server-side so operators can debug,
        # but do NOT forward it into the redirect URL where it would end up
        # in browser history and proxy logs.
        logger.warning("OAuth token exchange failed for %s: %s", provider, e)
        raise OAuthAccessError("oauth_failed", "")

    if provider == "github":
        info = await _fetch_github_userinfo(client, token)
    else:
        info = _fetch_oidc_userinfo(provider, token)

    return await authenticate_and_provision(info)
