import asyncio
import contextlib
import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app import __version__
from app.config import settings
from app.database import (
    boot_db_context,
    close_db,
    get_db,
    write_transaction,
    init_db,
    request_db_context,
    seed_welcome_page,
)
from app.auth import (
    ensure_admin_exists,
    hash_password_async,
    revoke_sessions,
    verify_password_async,
)
from app.services.accounts import DISABLED_PASSWORD_HASH
from app.spa import install_spa
from app.services.page_review import review_reminder_loop
from app.routers import auth_router, oauth_router, pages, media, templates, search, tags, activity, bookmarks, versions, diagrams, users, comments, backup, export, trash, notifications, watch, public, dashboard, acl, groups, ai, tokens, reviews, settings as settings_router

logger = logging.getLogger("justwiki")

_ALLOWED_ORIGINS = {"http://localhost:5173", "http://localhost:3000", "http://localhost"} | {
    o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()
}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_CSRF_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/logout"}

_INSECURE_SECRETS = {"change-me-to-random-string", "secret", ""}
_WEAK_ADMIN_PASSWORDS = {"admin", "password", "123456", ""}


def _looks_production() -> bool:
    """Heuristic for "this instance is being exposed, not run locally".

    True when any config signals a real deployment: running in the Docker
    image (which publishes the port on every interface), secure cookies are
    on, the public URL is not localhost, or explicit allowed origins were
    set. Pure localhost dev (the defaults) returns False so `make dev` keeps
    working out of the box with only a loud warning.
    """
    url = settings.PUBLIC_BASE_URL
    not_localhost = not (
        url.startswith("http://localhost")
        or url.startswith("http://127.0.0.1")
    )
    return (
        settings.RUNNING_IN_DOCKER
        or settings.COOKIE_SECURE
        or not_localhost
        or bool(settings.ALLOWED_ORIGINS.strip())
    )


def _check_security():
    """Warn on insecure defaults; refuse to start on a production-looking one.

    Insecure defaults are tolerated (with a loud warning) for localhost dev,
    but a deployment that looks internet-facing must not boot with a forgeable
    SECRET_KEY or a guessable admin password — fail closed instead.
    """
    fatal: list[str] = []
    production = _looks_production()

    if settings.SECRET_KEY.get_secret_value() in _INSECURE_SECRETS:
        safe_key = secrets.token_urlsafe(32)
        if production:
            fatal.append(
                "SECRET_KEY is set to an insecure default — anyone can forge "
                f"JWT tokens. Set SECRET_KEY in .env to a random value, e.g.: {safe_key}"
            )
        else:
            logger.critical(
                "\n"
                "╔══════════════════════════════════════════════════════╗\n"
                "║  ⚠  SECRET_KEY is set to an insecure default!      ║\n"
                "║  Anyone can forge JWT tokens with this key.         ║\n"
                "║  Set SECRET_KEY in .env to a random value, e.g.:   ║\n"
                "║  SECRET_KEY=%s  ║\n"
                "╚══════════════════════════════════════════════════════╝",
                safe_key[:44],
            )
    # ADMIN_PASS is checked against the database in `_enforce_admin_password`
    # (it only matters while the admin account actually uses it).

    if production and not settings.cookie_secure:
        logger.warning(
            "COOKIE_SECURE=false: the session cookie is sent over plain HTTP "
            "and can be sniffed on the network. Serve the app over HTTPS "
            "(e.g. behind a TLS reverse proxy) and set COOKIE_SECURE=true "
            "before exposing it to the internet."
        )

    if fatal:
        raise RuntimeError(
            "Refusing to start with insecure configuration:\n  - "
            + "\n  - ".join(fatal)
            + "\nThese are tolerated only for localhost development."
        )
    # Either SSO path issues the session cookie (OIDC state/nonce/PKCE) over
    # the wire. Without TLS marking, a passive attacker on the path can
    # replay the short-lived state cookie. We can't force HTTPS for the
    # operator, but we can refuse to stay quiet about the risk.
    if (settings.OIDC_ENABLED or settings.LDAP_ENABLED) and not settings.COOKIE_SECURE:
        if not settings.PUBLIC_BASE_URL.startswith("https://"):
            logger.warning(
                "OIDC/LDAP is enabled but COOKIE_SECURE=false and PUBLIC_BASE_URL "
                "is not https. Session cookies (OAuth state/PKCE) will travel "
                "in plaintext. Serve the app over HTTPS and set "
                "COOKIE_SECURE=true before exposing it."
            )

    # Fail loudly if the SSO toggles are on but no usable provider is
    # configured. Previously this surfaced only on the first login attempt
    # as an opaque 500; catching it here saves operators a debugging loop.
    if settings.OIDC_ENABLED:
        providers = [p.strip() for p in settings.OIDC_PROVIDERS.split(",") if p.strip()]
        if not providers:
            logger.error(
                "OIDC_ENABLED=true but OIDC_PROVIDERS is empty. "
                "Login page will show no SSO buttons."
            )
        else:
            any_configured = False
            if "google" in providers and settings.OIDC_GOOGLE_CLIENT_ID and settings.OIDC_GOOGLE_CLIENT_SECRET.get_secret_value():
                any_configured = True
            if "github" in providers and settings.OIDC_GITHUB_CLIENT_ID and settings.OIDC_GITHUB_CLIENT_SECRET.get_secret_value():
                any_configured = True
            if "generic" in providers and settings.OIDC_GENERIC_CLIENT_ID and settings.OIDC_GENERIC_CLIENT_SECRET.get_secret_value() and settings.OIDC_GENERIC_DISCOVERY:
                any_configured = True
            if not any_configured:
                logger.error(
                    "OIDC_ENABLED=true but no provider is fully configured. "
                    "Set the matching OIDC_{provider}_CLIENT_ID and _SECRET "
                    "(and _DISCOVERY for 'generic')."
                )

    if settings.LDAP_ENABLED:
        if not settings.LDAP_SERVER or not settings.LDAP_BIND_DN or not settings.LDAP_USER_BASE:
            logger.error(
                "LDAP_ENABLED=true but LDAP_SERVER/LDAP_BIND_DN/LDAP_USER_BASE "
                "is missing. LDAP login will fail."
            )


async def _enforce_admin_password() -> None:
    """Refuse to run an exposed instance whose admin password is a default.

    ADMIN_PASS only seeds the first admin, so the environment value alone
    says little: an admin who changed the password in the UI is fine even if
    .env still says "admin". What matters is the stored password:
      * no admin yet and ADMIN_PASS is weak → it would be created weak: fatal.
      * ADMIN_USER still has a weak password and ADMIN_PASS is strong → the
        stored password is replaced with ADMIN_PASS (this is the way out for
        an instance that was already deployed with admin/admin).
      * ADMIN_USER still has a weak password and ADMIN_PASS is weak too:
        fatal, with instructions.
    Outside production only the first case applies, as a warning.
    """
    production = _looks_production()
    env_pass = settings.ADMIN_PASS.get_secret_value()
    env_weak = env_pass in _WEAK_ADMIN_PASSWORDS
    db = await get_db()

    if not await db.execute_fetchall("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"):
        if env_weak:
            msg = (
                "ADMIN_PASS is set to a weak default and would become the first "
                "admin's password. Set a strong ADMIN_PASS in .env."
            )
            if production:
                raise RuntimeError(f"Refusing to start with insecure configuration:\n  - {msg}")
            logger.warning(msg)
        return
    if not production:
        # Checking the stored hash costs several bcrypt rounds; local dev
        # isn't reachable from outside, so skip it there.
        return

    rows = await db.execute_fetchall(
        "SELECT id, password_hash FROM users "
        "WHERE username = ? AND role = 'admin' AND deleted_at IS NULL",
        (settings.ADMIN_USER,),
    )
    if not rows or rows[0]["password_hash"] == DISABLED_PASSWORD_HASH:
        return
    stored = rows[0]["password_hash"]
    stored_weak = False
    for weak in _WEAK_ADMIN_PASSWORDS:
        if await verify_password_async(weak, stored):
            stored_weak = True
            break
    if not stored_weak:
        return

    if not env_weak:
        new_hash = await hash_password_async(env_pass)
        async with write_transaction(db):
            await db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, rows[0]["id"])
            )
            await revoke_sessions(db, rows[0]["id"])
        logger.warning(
            "Admin account %r still had a default password; replaced it with ADMIN_PASS.",
            settings.ADMIN_USER,
        )
        return

    raise RuntimeError(
        "Refusing to start with insecure configuration:\n  - "
        f"Admin account {settings.ADMIN_USER!r} still uses a default password. "
        "Set a strong ADMIN_PASS in .env and restart: it replaces the default "
        "password on startup."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_security()
    # Boot work runs against the writer connection. boot_db_context binds it
    # to the asyncio task so existing helpers (init_db, ensure_admin_exists,
    # seed_welcome_page) keep finding the right connection through get_db().
    async with boot_db_context() as db:
        await init_db()
        await _enforce_admin_password()
        await ensure_admin_exists()
        await seed_welcome_page(db)
    reminders = asyncio.create_task(review_reminder_loop())
    yield
    reminders.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await reminders
    await close_db()


# Default cap on any request body, enforced while the body streams in (so an
# oversized upload is rejected without being buffered). It sits just above the
# largest value the admin "max upload size" setting allows (100 MB,
# services/site_settings.py); the media router enforces the configured value.
# Routes that legitimately take more (backup restore) raise it per-route.
MAX_REQUEST_BODY = 105 * 1024 * 1024

app = FastAPI(
    title="JustWiki",
    version=__version__,
    lifespan=lifespan,
    max_body_size=MAX_REQUEST_BODY,
)


@app.middleware("http")
async def request_db_scope(request: Request, call_next):
    """Borrow a reader connection from the pool for this request.

    This binds an aiosqlite reader to the asyncio task so any subsequent
    ``await get_db()`` returns a proxy that routes to it. Inside a
    ``write_transaction(...)`` block the bound connection is temporarily
    swapped to the writer; on the way out of the block it's restored to
    this reader, which is then released back to the pool when the request
    finishes.

    Starlette wraps middleware in registration order, so the FIRST
    `add_middleware` / `@app.middleware("http")` call ends up innermost.
    This decorator is the first one in the file, which makes it the
    innermost layer — the route handler and its dependencies run inside
    the bound scope, and that's all we need. CSRF / Session / CORS run
    outside it (none of them touch the DB). If a future middleware needs
    DB access, register it AFTER this one (or move this registration
    later) so it ends up inside the bound scope.
    """
    async with request_db_context():
        return await call_next(request)


@app.middleware("http")
async def csrf_guard(request: Request, call_next):
    """Origin-based CSRF defense for cookie-authenticated state changes.

    Background: SameSite=Lax already blocks most cross-site POST attacks, but
    browsers without full SameSite support (or edge cases around top-level
    navigations) leave a gap. This middleware closes it by requiring that any
    mutating request with a session cookie carries an Origin/Referer that
    matches the allow-list.

    Bearer-token requests (the test suite and any future API client) are
    exempt — they don't rely on ambient browser credentials, so CSRF doesn't
    apply. Login/logout are exempt because the session cookie doesn't exist
    yet at login time, and logout needs to work even if the cookie is all the
    client still has.
    """
    if request.method in _SAFE_METHODS:
        return await call_next(request)

    # rstrip('/') so /api/auth/login and /api/auth/login/ both exempt.
    if request.url.path.rstrip("/") in _CSRF_EXEMPT_PATHS:
        return await call_next(request)

    # If there's no session cookie, there's nothing to protect: any request
    # without credentials will be rejected by the route's auth dependency,
    # and CSRF only matters for ambient-credential flows. This branch also
    # covers legitimate Bearer-token clients (API tokens, tests), which never
    # attach the session cookie.
    #
    # We deliberately do NOT exempt based on the Authorization header alone:
    # `get_current_user` falls back to the cookie when a Bearer token is
    # invalid, so a cross-origin attacker could otherwise pair a bogus
    # `Authorization: Bearer xyz` with the victim's session cookie to skip
    # CSRF protection on every mutating endpoint.
    if not request.cookies.get("token"):
        return await call_next(request)

    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")

    def _origin_of(url: str | None) -> str | None:
        if not url:
            return None
        try:
            from urllib.parse import urlsplit

            parts = urlsplit(url)
            if not parts.scheme or not parts.netloc:
                return None
            return f"{parts.scheme}://{parts.netloc}"
        except ValueError:
            return None

    def _is_localhost(url: str | None) -> bool:
        # Exact host match, not a prefix — startswith("http://localhost")
        # would wrongly accept attacker origins like http://localhost.evil.com.
        if not url:
            return False
        from urllib.parse import urlsplit

        return urlsplit(url).hostname in ("localhost", "127.0.0.1")

    candidate = origin or _origin_of(referer)
    is_localhost = _is_localhost(candidate)
    if not is_localhost and candidate not in _ALLOWED_ORIGINS:
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF check failed: origin not allowed"},
        )
    return await call_next(request)


# Content-Security-Policy for the SPA shell. It is the backstop if a payload
# ever slips past DOMPurify: no inline or third-party script can run, and the
# app can't be framed (clickjacking). Allowances, each needed by the frontend:
#   style 'unsafe-inline'   – Mermaid/KaTeX/editor set inline styles
#   fonts.googleapis/gstatic – web fonts in index.html
#   img https: http:        – pages may embed external images by URL
#   embed.diagrams.net      – the Draw.io editor iframe
_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src https://embed.diagrams.net",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
# Swagger UI / ReDoc pull their bundle from a CDN with an inline bootstrap
# script, so the SPA policy would blank them out.
_CSP_EXEMPT_PREFIXES = ("/docs", "/redoc")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Baseline hardening headers. `setdefault` so a route that sets a
    stricter policy of its own (e.g. the diagram SVG endpoint) keeps it."""
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if response.headers.get("content-type", "").startswith("text/html"):
        h.setdefault("X-Frame-Options", "DENY")
        if not request.url.path.startswith(_CSP_EXEMPT_PREFIXES):
            h.setdefault("Content-Security-Policy", _CSP)
    if settings.cookie_secure:
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# authlib stashes OAuth state/nonce/PKCE in the signed session cookie between
# /login and /callback. Registered before routes so the OAuth router can read it.
#
# https_only follows settings.cookie_secure: COOKIE_SECURE, or PUBLIC_BASE_URL
# is https:// — operators running behind TLS commonly forget to flip
# COOKIE_SECURE, and we don't want to leak an OAuth state cookie over
# plaintext just because of a config oversight.
_session_https_only = settings.cookie_secure
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY.get_secret_value(),
    session_cookie="justwiki_oauth",
    same_site="lax",
    https_only=_session_https_only,
    max_age=600,
)

app.include_router(auth_router.router)
app.include_router(oauth_router.router)
app.include_router(pages.router)
app.include_router(media.router)
app.include_router(templates.router)
app.include_router(search.router)
app.include_router(tags.router)
app.include_router(activity.router)
app.include_router(bookmarks.router)
app.include_router(versions.router)
app.include_router(diagrams.router)
app.include_router(users.router)
app.include_router(comments.router)
app.include_router(backup.router)
app.include_router(export.router)
app.include_router(trash.router)
app.include_router(notifications.router)
app.include_router(watch.router)
app.include_router(public.router)
app.include_router(dashboard.router)
app.include_router(acl.router)
app.include_router(groups.router)
app.include_router(ai.router)
app.include_router(tokens.router)
app.include_router(reviews.router)
app.include_router(settings_router.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve the built frontend for every non-API path (Docker image only; a no-op
# in dev). Installed as the router's fallback, so it never shadows an API route.
install_spa(app, settings.FRONTEND_DIST_DIR)
