"""Snapshot a freshly seeded wiki into static files for the read-only demo.

Run from ``backend/`` after building the frontend with ``VITE_DEMO=true``:

    PYTHONPATH=. python scripts/build_static_demo.py ../frontend/dist

The script boots JustWiki against a throwaway data directory with
ANONYMOUS_READ on, seeds the first-launch content, then calls every read
endpoint the guest UI uses (in-process, no server) and writes each response
to ``<out>/demo-api/<path>.json`` as ``{"status": ..., "data": ...}``.
``frontend/src/lib/demoApi.js`` serves those files in place of the backend.
Media files are copied to ``<out>/api/media/``, and ``_search.json`` holds the
page text for the client-side search.

Slugs are drawn from a fixed-seed generator so page URLs stay the same from
one build to the next.
"""
import asyncio
import json
import os
import random
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote


def _configure_env(tmp: Path) -> None:
    # Must run before anything imports app.config (pydantic-settings reads
    # the environment once, at import time).
    os.environ.update({
        "DATA_DIR": str(tmp),
        "DB_PATH": str(tmp / "just-wiki.db"),
        "MEDIA_DIR": str(tmp / "media"),
        "ANONYMOUS_READ": "true",
        "AI_ENABLED": "false",
        "CHECK_UPDATES": "false",
        # Throwaway values: the database never leaves this temp directory.
        "SECRET_KEY": os.urandom(32).hex(),
        "ADMIN_PASS": os.urandom(16).hex(),
    })


def _stable_slugs():
    from app.services import page_slug

    rng = random.Random(20261127)

    def new_page_slug() -> str:
        return "".join(rng.choice(page_slug.PAGE_SLUG_ALPHABET) for _ in range(page_slug.PAGE_SLUG_LENGTH))

    page_slug.new_page_slug = new_page_slug


# Endpoints the guest UI calls that don't depend on a page. Query params are
# ignored by the demo client, so each is captured once with the widest page.
GLOBAL_ENDPOINTS = [
    "/auth/me",
    "/settings",
    "/pages/tree",
    "/pages/graph",
    "/auth/providers",
    "/pages?page=1&per_page=100",
    "/tags",
    "/activity?page=1&per_page=100",
    "/activity/stats",
    "/ai/status",
    "/bookmarks",
    "/notifications",
    "/groups",
    "/reviews?scope=all",
    "/dashboard/stats",
    "/trash",
    "/templates",
    "/diagrams",
    "/media",
]

PAGE_ENDPOINTS = [
    "",
    "/tags",
    "/backlinks",
    "/children",
    "/comments",
    "/versions",
    "/my-permission",
    "/watch",
    "/acl",
]


def _out_path(root: Path, endpoint: str) -> Path:
    path = endpoint.split("?", 1)[0].strip("/")
    # Each segment is percent-encoded so a slug or tag can't escape the
    # output directory; demoApi.js encodes the same way.
    parts = [quote(p, safe="") for p in path.split("/")]
    return root.joinpath(*parts[:-1], parts[-1] + ".json")


async def _snapshot(out_dir: Path) -> None:
    from httpx import ASGITransport, AsyncClient

    from app.auth import ensure_admin_exists
    from app.config import settings
    from app.database import boot_db_context, close_db, init_db, seed_welcome_page
    from app.main import app

    async with boot_db_context() as db:
        await init_db()
        await ensure_admin_exists()
        await seed_welcome_page(db)
        pages = [dict(r) for r in await db.execute_fetchall(
            """SELECT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count, p.page_type,
                      COALESCE((SELECT json_group_array(t.name) FROM page_tags pt
                                JOIN tags t ON t.id = pt.tag_id WHERE pt.page_id = p.id), '[]') AS tags
               FROM pages p WHERE p.deleted_at IS NULL ORDER BY p.title"""
        )]
        diagram_ids = [r["id"] for r in await db.execute_fetchall("SELECT id FROM diagrams")]
    await close_db()

    api_root = out_dir / "demo-api"
    if api_root.exists():
        shutil.rmtree(api_root)

    endpoints = list(GLOBAL_ENDPOINTS)
    for p in pages:
        endpoints += [f"/pages/{p['slug']}{suffix}" for suffix in PAGE_ENDPOINTS]
    endpoints += [f"/diagrams/{i}" for i in diagram_ids]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://demo") as client:
        for ep in endpoints:
            res = await client.get("/api" + ep)
            try:
                data = res.json()
            except ValueError:
                data = None
            target = _out_path(api_root, ep)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                json.dumps({"status": res.status_code, "data": data}, ensure_ascii=False),
                encoding="utf-8",
            )
    await close_db()

    for p in pages:
        p["tags"] = json.loads(p["tags"])
    (api_root / "_search.json").write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")

    media_out = out_dir / "api" / "media"
    if media_out.exists():
        shutil.rmtree(media_out)
    shutil.copytree(settings.MEDIA_DIR, media_out)

    print(f"Wrote {len(endpoints)} responses and {len(pages)} pages to {api_root}")


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "../frontend/dist").resolve()
    if not (out_dir / "index.html").is_file():
        sys.exit(f"{out_dir} has no index.html; build the frontend with VITE_DEMO=true first")

    tmp = Path(tempfile.mkdtemp(prefix="justwiki-demo-"))
    try:
        _configure_env(tmp)
        _stable_slugs()
        asyncio.run(_snapshot(out_dir))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # GitHub Pages serves 404.html for unknown paths; making it the SPA shell
    # lets deep links like /page/<slug> load the app instead of a 404.
    shutil.copyfile(out_dir / "index.html", out_dir / "404.html")


if __name__ == "__main__":
    main()
