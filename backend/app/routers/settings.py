"""Site-wide branding and homepage settings.

GET is anonymous on purpose: the Login page renders before any user is
authenticated, and it needs to know the configured title/subtitle.
PUT is admin-only.

Storage is a key/value table; missing keys fall through to DEFAULT_SETTINGS
so the API always returns the full set and the frontend can index by key
without null-checks.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.config import settings as app_settings
from app.database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULT_SETTINGS: dict[str, str] = {
    "site_name": "JustWiki",
    "login_title": "JustWiki",
    "login_subtitle": "Just clone, run, and write.",
    "home_page_slug": "",
    "footer_text": "Powered by JustWiki",
}


class SettingsResponse(BaseModel):
    site_name: str
    login_title: str
    login_subtitle: str
    home_page_slug: str
    footer_text: str
    # Server-side toggle, surfaced read-only so the frontend can decide
    # whether an unauthenticated visitor should be rendered as a guest
    # (Layout + read-only UI) or bounced to /login. Driven by the
    # ANONYMOUS_READ env var, not stored in site_settings.
    anonymous_read: bool


class SettingsUpdate(BaseModel):
    site_name: Optional[str] = Field(default=None, max_length=80)
    login_title: Optional[str] = Field(default=None, max_length=80)
    login_subtitle: Optional[str] = Field(default=None, max_length=200)
    home_page_slug: Optional[str] = Field(default=None, max_length=200)
    footer_text: Optional[str] = Field(default=None, max_length=200)


async def _read_all() -> dict[str, str]:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT key, value FROM site_settings")
    overrides = {r["key"]: r["value"] for r in rows}
    return {k: overrides.get(k, default) for k, default in DEFAULT_SETTINGS.items()}


@router.get("", response_model=SettingsResponse)
async def get_settings():
    return {**(await _read_all()), "anonymous_read": app_settings.ANONYMOUS_READ}


@router.put("", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate, _=Depends(require_admin)):
    db = await get_db()
    payload = body.model_dump(exclude_none=True)
    for key, raw in payload.items():
        value = str(raw).strip()
        # Empty string clears the override so the next read returns the
        # built-in default. Without this, an admin couldn't blank the
        # branding fields back to "JustWiki" without redeploying.
        if value == "":
            await db.execute("DELETE FROM site_settings WHERE key = ?", (key,))
            continue
        await db.execute(
            """INSERT INTO site_settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET
                   value = excluded.value,
                   updated_at = CURRENT_TIMESTAMP""",
            (key, value),
        )
    await db.commit()
    return {**(await _read_all()), "anonymous_read": app_settings.ANONYMOUS_READ}
