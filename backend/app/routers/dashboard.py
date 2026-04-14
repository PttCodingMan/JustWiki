"""Dashboard endpoint — admin-only wiki stats snapshot.

Exposes GET /api/dashboard/stats with:
  - storage { disk_total_bytes, disk_used_bytes, db_size_bytes, media_size_bytes }
    for the stacked storage bar
  - page_count / user_count
  - app_version / latest_version / check_updates_enabled for the update
    status card
  - python_version / sqlite_version for the runtime info card

Design notes:
- No psutil. Host CPU/memory inside a container reflects the host passthrough
  (not the container's real resource pressure), and admins already have
  better tools (htop, docker stats, Grafana) for that kind of monitoring.
  The dashboard focuses on data that's genuinely about the wiki itself.
- Disk usage is computed with stdlib shutil.disk_usage, which is sufficient
  for "how much free space does the volume have" — which is what a stacked
  storage bar actually needs.
- The latest_version lookup uses the ghcr.io Docker Registry v2 API
  (anonymous-accessible for public packages). Gated behind
  settings.CHECK_UPDATES so air-gapped installs don't make outbound calls,
  and cached in-process for 15 minutes to stay well under rate limits.
- Endpoint is admin-only. Exposes host paths, disk totals, and package
  metadata — must not be public.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from app import __version__
from app.auth import require_admin
from app.config import settings
from app.database import get_db

logger = logging.getLogger("justwiki.dashboard")

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# In-process cache for the remote version lookup. Tuple of (expires_at, value).
_LATEST_VERSION_CACHE: tuple[float, str | None] | None = None
_LATEST_VERSION_TTL_SECONDS = 15 * 60
_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _db_size_bytes() -> int:
    """Sum of the SQLite file plus its WAL and SHM sidecars.

    WAL mode means pending writes can sit in -wal until a checkpoint, so
    the main .db file understates the real on-disk footprint.
    """
    db_path = Path(settings.DB_PATH)
    total = 0
    for suffix in ("", "-wal", "-shm"):
        p = db_path.with_name(db_path.name + suffix) if suffix else db_path
        try:
            total += p.stat().st_size
        except OSError:
            pass
    return total


def _media_size_bytes() -> int:
    media_dir = Path(settings.MEDIA_DIR)
    if not media_dir.exists():
        return 0
    total = 0
    for root, _dirs, files in os.walk(media_dir):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def _disk_usage() -> tuple[int | None, int | None]:
    """Return (total_bytes, used_bytes) for the filesystem hosting DATA_DIR.

    Uses stdlib shutil.disk_usage — works on Linux, macOS, Windows. Inside a
    Docker container this reports the container's FS view; for a
    volume-mounted DATA_DIR that's the host volume's filesystem, which is
    what an admin actually wants to see.
    """
    try:
        du = shutil.disk_usage(settings.DATA_DIR)
        return int(du.total), int(du.used)
    except OSError as e:
        logger.warning("disk_usage failed for %s: %s", settings.DATA_DIR, e)
        return None, None


async def _fetch_latest_version() -> str | None:
    """Query ghcr.io for the highest semver tag on the backend image.

    Uses the Docker Registry v2 API (anonymous-accessible for public
    packages). Returns None on any failure — never raises.
    """
    import httpx

    image = settings.UPDATE_CHECK_IMAGE.strip("/")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            token_resp = await client.get(
                "https://ghcr.io/token",
                params={"scope": f"repository:{image}:pull", "service": "ghcr.io"},
            )
            if token_resp.status_code != 200:
                return None
            token = token_resp.json().get("token")
            if not token:
                return None

            tags_resp = await client.get(
                f"https://ghcr.io/v2/{image}/tags/list",
                headers={"Authorization": f"Bearer {token}"},
            )
            if tags_resp.status_code != 200:
                return None
            tags = tags_resp.json().get("tags") or []
    except (httpx.HTTPError, ValueError):
        return None

    semver: list[tuple[tuple[int, int, int], str]] = []
    for tag in tags:
        m = _SEMVER_RE.match(tag)
        if m:
            semver.append(((int(m[1]), int(m[2]), int(m[3])), tag))
    if not semver:
        return None
    semver.sort(key=lambda t: t[0])
    return semver[-1][1]


async def _get_latest_version_cached() -> str | None:
    global _LATEST_VERSION_CACHE
    if not settings.CHECK_UPDATES:
        return None
    now = time.monotonic()
    if _LATEST_VERSION_CACHE and _LATEST_VERSION_CACHE[0] > now:
        return _LATEST_VERSION_CACHE[1]
    value = await _fetch_latest_version()
    _LATEST_VERSION_CACHE = (now + _LATEST_VERSION_TTL_SECONDS, value)
    return value


@router.get("/stats")
async def dashboard_stats(user=Depends(require_admin)) -> dict[str, Any]:
    """Wiki stats snapshot for the admin dashboard."""
    import sqlite3
    import sys

    disk_total, disk_used = _disk_usage()

    db = await get_db()
    page_rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS c FROM pages WHERE deleted_at IS NULL"
    )
    page_count = int(page_rows[0]["c"]) if page_rows else 0
    user_rows = await db.execute_fetchall("SELECT COUNT(*) AS c FROM users")
    user_count = int(user_rows[0]["c"]) if user_rows else 0

    latest_version = await _get_latest_version_cached()

    return {
        "storage": {
            "disk_total_bytes": disk_total,
            "disk_used_bytes": disk_used,
            "db_size_bytes": _db_size_bytes(),
            "media_size_bytes": _media_size_bytes(),
        },
        "page_count": page_count,
        "user_count": user_count,
        "app_version": __version__,
        "latest_version": latest_version,
        "check_updates_enabled": settings.CHECK_UPDATES,
        "python_version": sys.version.split()[0],
        "sqlite_version": sqlite3.sqlite_version,
    }
