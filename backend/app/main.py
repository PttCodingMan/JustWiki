import logging
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db, close_db
from app.auth import ensure_admin_exists
from app.routers import auth_router, pages, media, templates, search, tags, activity, bookmarks, versions, diagrams, users, comments, backup, export

logger = logging.getLogger("justwiki")

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
    yield
    await close_db()


app = FastAPI(title="JustWiki", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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


@app.get("/api/health")
async def health():
    return {"status": "ok"}
