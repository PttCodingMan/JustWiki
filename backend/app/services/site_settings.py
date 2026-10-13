"""Admin-editable site settings stored in the `site_settings` key/value table.

Lives in services/ (not the router) so auth and upload code can read the
knobs without importing a router. Missing or malformed values fall back to
the defaults below, so readers never have to null-check.
"""
from typing import Optional

from app.database import get_db

# Branding strings; '' in the PUT clears the override back to these.
DEFAULT_SETTINGS: dict[str, str] = {
    "site_name": "JustWiki",
    "login_title": "JustWiki",
    "login_subtitle": "Just clone, run, and write.",
    "home_page_slug": "",
    "footer_text": "Powered by JustWiki",
}

# Integer knobs: key -> (default, min, max). Changing session_days only
# affects sessions issued afterwards; existing cookies keep their exp.
INT_SETTINGS: dict[str, tuple[int, int, int]] = {
    "session_days": (1, 1, 365),
    # Capped well under nginx's client_max_body_size in frontend/nginx.conf.
    "max_upload_mb": (20, 1, 100),
    # Floor of 8 so the setting can only tighten the historical rule.
    "password_min_length": (8, 8, 128),
}

# Boolean knobs: key -> default. Stored as "1"/"0".
BOOL_SETTINGS: dict[str, bool] = {
    # Re-issue the session cookie on each app load (/api/auth/me), so a
    # session only expires after `session_days` of inactivity.
    "session_auto_renew": False,
}


def parse_int(key: str, raw: Optional[str]) -> int:
    default, lo, hi = INT_SETTINGS[key]
    try:
        value = int(raw) if raw is not None else default
    except ValueError:
        return default
    return min(max(value, lo), hi)


def parse_bool(key: str, raw: Optional[str]) -> bool:
    if raw is None:
        return BOOL_SETTINGS[key]
    return raw == "1"


async def read_all() -> dict:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT key, value FROM site_settings")
    overrides = {r["key"]: r["value"] for r in rows}
    result: dict = {k: overrides.get(k, default) for k, default in DEFAULT_SETTINGS.items()}
    for key in INT_SETTINGS:
        result[key] = parse_int(key, overrides.get(key))
    for key in BOOL_SETTINGS:
        result[key] = parse_bool(key, overrides.get(key))
    return result


async def _read_one(key: str) -> Optional[str]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT value FROM site_settings WHERE key = ?", (key,)
    )
    return rows[0]["value"] if rows else None


async def get_int(key: str) -> int:
    return parse_int(key, await _read_one(key))


async def get_bool(key: str) -> bool:
    return parse_bool(key, await _read_one(key))


async def get_session_max_age() -> int:
    """Seconds a newly issued login session stays valid."""
    return await get_int("session_days") * 86400
