"""Site-wide branding, homepage, session and upload settings.

GET is anonymous on purpose: the Login page renders before any user is
authenticated, and it needs to know the configured title/subtitle.
PUT is admin-only.

Storage and defaults live in services/site_settings.py; missing keys fall
through to the defaults so the API always returns the full set and the
frontend can index by key without null-checks.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.config import settings as app_settings
from app.database import get_db, write_transaction
from app.services.site_settings import (
    BOOL_SETTINGS,
    INT_SETTINGS,
    read_all,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _int_field(key: str):
    _, lo, hi = INT_SETTINGS[key]
    return Field(default=None, ge=lo, le=hi)


class SettingsResponse(BaseModel):
    site_name: str
    login_title: str
    login_subtitle: str
    home_page_slug: str
    footer_text: str
    session_days: int
    session_auto_renew: bool
    max_upload_mb: int
    password_min_length: int
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
    session_days: Optional[int] = _int_field("session_days")
    session_auto_renew: Optional[bool] = None
    max_upload_mb: Optional[int] = _int_field("max_upload_mb")
    password_min_length: Optional[int] = _int_field("password_min_length")


@router.get("", response_model=SettingsResponse)
async def get_settings():
    return {**(await read_all()), "anonymous_read": app_settings.ANONYMOUS_READ}


@router.put("", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate, _=Depends(require_admin)):
    db = await get_db()
    payload = body.model_dump(exclude_none=True)
    async with write_transaction(db):
        for key, raw in payload.items():
            if key in BOOL_SETTINGS:
                value = "1" if raw else "0"
            else:
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
    return {**(await read_all()), "anonymous_read": app_settings.ANONYMOUS_READ}
