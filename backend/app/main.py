import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.config import settings
from app.database import init_db, close_db, seed_welcome_page, get_db
from app.auth import ensure_admin_exists
from app.routers import auth_router, pages, media, templates, search, tags, activity, bookmarks, versions, diagrams, users, comments, backup, export, trash, notifications, watch, public, dashboard, acl

logger = logging.getLogger("justwiki")

_ALLOWED_ORIGINS = {"http://localhost:5173", "http://localhost:3000"}
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_CSRF_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/logout"}

_INSECURE_SECRETS = {"change-me-to-random-string", "secret", ""}


def _check_security():
    """Warn loudly about insecure defaults on startup."""
    if settings.SECRET_KEY in _INSECURE_SECRETS:
        safe_key = secrets.token_urlsafe(32)
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
    if settings.ADMIN_PASS in {"admin", "password", "123456", ""}:
        logger.warning(
            "ADMIN_PASS is set to a weak default ('%s'). "
            "Change it in .env before deploying to production.",
            settings.ADMIN_PASS,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_security()
    await init_db()
    await ensure_admin_exists()
    db = await get_db()
    await seed_welcome_page(db)
    yield
    await close_db()


app = FastAPI(title="JustWiki", version=__version__, lifespan=lifespan)


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

    # Bearer-token requests don't ride on the browser-ambient cookie, so CSRF
    # doesn't reach them. Skip the check.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return await call_next(request)

    # If there's no session cookie, there's nothing to protect: any request
    # without credentials will be rejected by the route's auth dependency,
    # and CSRF only matters for ambient-credential flows.
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

    candidate = origin or _origin_of(referer)
    if candidate not in _ALLOWED_ORIGINS:
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF check failed: origin not allowed"},
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
