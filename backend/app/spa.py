"""Serve the built frontend (Vite `dist/`) from the backend process.

The Docker image ships a single container: the React bundle is copied into
the image and served here, so there is no separate nginx in front of uvicorn.
In local dev the directory doesn't exist and nothing is installed — Vite's
dev server keeps serving the frontend and proxies `/api` to us.

This is installed as the router's *default* handler rather than as a mount or
a catch-all route. Starlette only calls the default when no route matched at
all (not even on path with a different method), so:

- API routes always win, and a wrong method on an API path still gets 405;
- unknown `/api/...` paths still get FastAPI's JSON 404, never `index.html`;
- everything else falls through to a static file or the SPA shell.
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

from fastapi import FastAPI
from starlette.responses import FileResponse
from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger("justwiki")

# Vite fingerprints everything under /assets/ (content hash in the filename),
# so those can be cached forever. Everything else — index.html above all —
# must revalidate, or browsers keep loading a stale shell after an upgrade
# that points at hashed assets which no longer exist.
_IMMUTABLE = "public, max-age=31536000, immutable"
_REVALIDATE = "no-cache"


def _accepts_gzip(scope: Scope) -> bool:
    for name, value in scope.get("headers", []):
        if name == b"accept-encoding":
            return b"gzip" in value.lower()
    return False


class SPAStaticFiles:
    """ASGI app serving files from ``dist_dir`` with an ``index.html`` fallback.

    ``fallback`` handles anything this app must not answer: non-HTTP scopes,
    non-GET/HEAD methods and `/api` paths. It is the router's original
    not-found handler, so those keep their normal 404 behaviour.

    Pre-compressed ``<file>.gz`` siblings (written at image build time) are
    served when the client accepts gzip; otherwise the plain file is sent.
    """

    def __init__(self, dist_dir: Path, fallback: ASGIApp) -> None:
        self.root = dist_dir.resolve()
        self.index = self.root / "index.html"
        self.fallback = fallback

    def _resolve(self, url_path: str) -> Path | None:
        rel = url_path.lstrip("/")
        if not rel:
            return None
        try:
            candidate = (self.root / rel).resolve()
            # resolve() collapses `..`; anything that lands outside dist is a
            # traversal attempt and must not be served.
            if not candidate.is_relative_to(self.root) or not candidate.is_file():
                return None
        except (OSError, ValueError):  # e.g. embedded NUL, name too long
            return None
        return candidate

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or scope["method"] not in ("GET", "HEAD")
            or path == "/api"
            or path.startswith("/api/")
        ):
            await self.fallback(scope, receive, send)
            return

        file = self._resolve(path)
        if file is None:
            # A missing hashed asset is a real 404: answering with index.html
            # would make the browser try to run HTML as JS/CSS. Any other
            # path is a client-side route, so hand back the SPA shell.
            if path.startswith("/assets/"):
                await self.fallback(scope, receive, send)
                return
            file = self.index

        cache = _IMMUTABLE if file.parent == self.root / "assets" else _REVALIDATE
        headers = {"Cache-Control": cache, "Vary": "Accept-Encoding"}
        media_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"

        gz = file.with_name(file.name + ".gz")
        if _accepts_gzip(scope) and gz.is_file():
            headers["Content-Encoding"] = "gzip"
            response = FileResponse(gz, media_type=media_type, headers=headers)
        else:
            response = FileResponse(file, media_type=media_type, headers=headers)
        await response(scope, receive, send)


def install_spa(app: FastAPI, dist_dir: str | Path) -> bool:
    """Serve ``dist_dir`` for every request no API route matched.

    Returns False (and changes nothing) when the directory has no
    ``index.html`` — the normal case for `make dev`.
    """
    dist = Path(dist_dir)
    if not (dist / "index.html").is_file():
        return False
    app.router.default = SPAStaticFiles(dist, fallback=app.router.default)
    logger.info("Serving frontend from %s", dist.resolve())
    return True
