"""Public read-only page access.

No authentication required. Rate-limited by IP.
Strips HTML comments, inlines drawio SVGs, does not touch view_count.
"""
import re
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request

from app.database import get_db
from app.services.client_ip import client_ip
from app.services.diagram_ref import DRAWIO_ID_RE as _DRAWIO_ID_RE

router = APIRouter(prefix="/api/public", tags=["public"])

_HTML_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")

# In-memory rate limit: 60 requests per IP per 60 seconds.
# Single-process only — see to-do Known Limitations.
_access_log: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 60
_RATE_LIMIT_WINDOW = 60  # seconds


def _check_rate_limit(ip: str):
    now = time.monotonic()
    log = _access_log[ip]
    pruned = [t for t in log if now - t < _RATE_LIMIT_WINDOW]
    _access_log[ip] = pruned
    if len(pruned) >= _RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many requests")
    pruned.append(now)


@router.get("/pages/{slug}")
async def get_public_page(slug: str, request: Request):
    _check_rate_limit(client_ip(request))

    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.slug, p.title, p.content_md, p.page_type, p.mindmap_layout, p.updated_at,
                  CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                       THEN u.display_name ELSE u.username END AS author_name
           FROM pages p
           LEFT JOIN users u ON u.id = p.created_by
           WHERE p.slug = ? AND p.is_public = 1 AND p.deleted_at IS NULL""",
        (slug,),
    )
    if not rows:
        # Identical response for "not found" vs "exists but not public"
        # to prevent slug enumeration.
        raise HTTPException(status_code=404, detail="Not found")

    page = dict(rows[0])

    # Strip HTML comments from source (Q8).
    page["content_md"] = _HTML_COMMENT_RE.sub("", page["content_md"])

    # Inline drawio SVGs (Q3).
    ids = set(_DRAWIO_ID_RE.findall(page["content_md"]))
    diagrams: dict[str, str] = {}
    if ids:
        placeholders = ",".join("?" * len(ids))
        diag_rows = await db.execute_fetchall(
            f"SELECT id, svg_cache FROM diagrams WHERE id IN ({placeholders})",
            list(ids),
        )
        diagrams = {
            str(r["id"]): r["svg_cache"] for r in diag_rows if r["svg_cache"]
        }
    page["diagrams"] = diagrams

    # Note: intentionally does NOT update view_count (Q10).
    return page
