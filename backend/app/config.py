from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me-to-random-string"
    ADMIN_USER: str = "admin"
    ADMIN_PASS: str = "admin"

    DATA_DIR: str = "./data"
    DB_PATH: str = "./data/just-wiki.db"
    MEDIA_DIR: str = "./data/media"

    VITE_API_URL: str = "http://localhost:8000"
    COOKIE_SECURE: bool = False  # Set to True in production with HTTPS

    # Comma-separated list of origins allowed for CSRF/CORS on top of the
    # always-included localhost dev origins. Set this to your public URL(s)
    # in production, e.g. "https://wiki.example.com".
    ALLOWED_ORIGINS: str = ""

    # ── AI chat (optional, OpenAI-compatible) ──
    # Default targets Gemini's OpenAI-compatible endpoint, but any provider
    # that speaks the same wire format works (OpenAI, Ollama, Groq, DeepSeek…).
    AI_ENABLED: bool = False
    AI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gemini-2.0-flash"
    AI_MAX_CONTEXT_PAGES: int = 5       # top-K pages stuffed into the prompt
    AI_EXCERPT_CHARS: int = 1500        # max chars per page content excerpt
    AI_RATE_LIMIT_PER_HOUR: int = 20    # per-user request cap
    # Legacy; kept as a read-only alias so existing deployments don't break.
    # Use AI_API_KEY instead.
    GEMINI_API_KEY: str = ""

    # Dashboard / updates
    # Off by default so air-gapped installs never make an outbound call.
    CHECK_UPDATES: bool = False
    # Repo on ghcr.io for the image-tag lookup. Matches docker-compose.yml.
    UPDATE_CHECK_IMAGE: str = "pttcodingman/justwiki/backend"

    # Repeat views by the same user within this window don't re-increment
    # a page's view_count. Keeps counts meaningful across refreshes / tab
    # switches without permanently storing per-user reading history.
    VIEW_DEDUP_MINUTES: int = 30

    # Look for .env in both the cwd (docker image's /app) and the repo root
    # one directory up (so `make dev-backend`, which cds into backend/, still
    # picks up the project-root .env). pydantic-settings uses the first file
    # that exists.
    model_config = {
        "env_file": (".env", "../.env"),
        "env_file_encoding": "utf-8",
    }


settings = Settings()

# Ensure directories exist
Path(settings.DATA_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.MEDIA_DIR).mkdir(parents=True, exist_ok=True)
