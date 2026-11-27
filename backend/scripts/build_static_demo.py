"""Snapshot the user guide into static files for the read-only demo.

Run from ``backend/`` after building the frontend with ``VITE_DEMO=true``:

    PYTHONPATH=. python scripts/build_static_demo.py ../frontend/dist

The script boots JustWiki against a throwaway data directory with
ANONYMOUS_READ on, imports the guide from ``docs/manual/`` (see
MANUAL_PAGES), then calls every read endpoint the guest UI uses (in-process,
no server) and writes each response to ``<out>/demo-api/<path>.json`` as
``{"status": ..., "data": ...}``.
``frontend/src/lib/demoApi.js`` serves those files in place of the backend.
Media files are copied to ``<out>/api/media/``, and ``_search.json`` holds the
page text for the client-side search.

Each guide page's slug is derived from its name in MANUAL_PAGES, so page URLs
stay the same from one build to the next even as pages are added. The
first-launch "Getting Started" pages from ``app/seed/`` are added as a second
root, listed above the guide, with slugs fixed the same way.
"""
import asyncio
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[2]
MANUAL_DIR = REPO_ROOT / "docs" / "manual"
IMAGES_DIR = REPO_ROOT / "docs" / "images"

# The guide's page tree: (name, file under docs/manual/, title, parent name,
# page type). Parents come before children; siblings keep this order. Pages
# link to each other as [[name]] / [[name|text]], rewritten to the slugs.
# Renaming an entry changes that page's URL.
MANUAL_PAGES = [
    ("index", "index.md", "JustWiki 說明文件 · Documentation", None, "document"),
    ("zh-guide", "zh-TW/guide.md", "使用手冊（中文）", "index", "document"),
    ("zh-quick-start", "zh-TW/quick-start.md", "快速上手", "zh-guide", "document"),
    ("zh-shortcuts", "zh-TW/shortcuts.md", "鍵盤快捷鍵", "zh-quick-start", "document"),
    ("zh-editor", "zh-TW/editor.md", "編輯器", "zh-guide", "document"),
    ("zh-rich-content", "zh-TW/rich-content.md", "豐富內容", "zh-guide", "document"),
    ("zh-links", "zh-TW/links.md", "連結與嵌入", "zh-guide", "document"),
    ("zh-organize", "zh-TW/organize.md", "整理頁面", "zh-guide", "document"),
    ("zh-mindmap", "zh-TW/mindmap.md", "心智圖頁面", "zh-organize", "mindmap"),
    ("zh-browse", "zh-TW/browse.md", "搜尋與瀏覽", "zh-guide", "document"),
    ("zh-collaboration", "zh-TW/collaboration.md", "協作", "zh-guide", "document"),
    ("zh-permissions", "zh-TW/permissions.md", "權限與帳號", "zh-guide", "document"),
    ("zh-ai", "zh-TW/ai.md", "AI 問答", "zh-guide", "document"),
    ("zh-admin", "zh-TW/admin.md", "管理員指南", "zh-guide", "document"),
    ("zh-developer", "zh-TW/developer.md", "開發者指南", "zh-guide", "document"),
    ("en-guide", "en/guide.md", "User Guide (English)", "index", "document"),
    ("en-quick-start", "en/quick-start.md", "Quick Start", "en-guide", "document"),
    ("en-shortcuts", "en/shortcuts.md", "Keyboard Shortcuts", "en-quick-start", "document"),
    ("en-editor", "en/editor.md", "The Editor", "en-guide", "document"),
    ("en-rich-content", "en/rich-content.md", "Rich Content", "en-guide", "document"),
    ("en-links", "en/links.md", "Links & Embeds", "en-guide", "document"),
    ("en-organize", "en/organize.md", "Organizing Pages", "en-guide", "document"),
    ("en-mindmap", "en/mindmap.md", "Mindmap Page", "en-organize", "mindmap"),
    ("en-browse", "en/browse.md", "Search & Browse", "en-guide", "document"),
    ("en-collaboration", "en/collaboration.md", "Collaboration", "en-guide", "document"),
    ("en-permissions", "en/permissions.md", "Permissions & Accounts", "en-guide", "document"),
    ("en-ai", "en/ai.md", "AI Chat", "en-guide", "document"),
    ("en-admin", "en/admin.md", "Admin Guide", "en-guide", "document"),
    ("en-developer", "en/developer.md", "Developer Guide", "en-guide", "document"),
]


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


def _manual_slug(name: str) -> str:
    """A slug in the app's own format, fixed for a given page name."""
    from app.services.page_slug import PAGE_SLUG_ALPHABET, PAGE_SLUG_LENGTH

    digest = hashlib.sha256(f"justwiki-demo:{name}".encode()).digest()
    return "".join(PAGE_SLUG_ALPHABET[b % len(PAGE_SLUG_ALPHABET)] for b in digest[:PAGE_SLUG_LENGTH])


async def _seed_manual(db) -> None:
    """Insert the guide and the first-launch pages; the guide index is home."""
    from app.config import settings
    from app.database import GETTING_STARTED_PAGES, insert_getting_started_pages
    from app.services.page_slug import rewrite_page_slugs
    from app.services.search import rebuild_search_index
    from app.services.wikilink import parse_and_update_backlinks

    # Screenshots referenced by the guide as /api/media/<file>.
    media_dir = Path(settings.MEDIA_DIR)
    media_dir.mkdir(parents=True, exist_ok=True)
    for img in IMAGES_DIR.glob("*.png"):
        shutil.copyfile(img, media_dir / img.name)

    admin_id = (await db.execute_fetchall(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    ))[0]["id"]
    slug_map = {name: _manual_slug(name) for name, *_ in MANUAL_PAGES}
    # The pages a fresh install starts with, kept as a second root so the
    # demo also shows what a new wiki looks like. Guide pages can link to
    # them by seed name, e.g. [[getting-started]].
    welcome_slugs = {name: _manual_slug(f"seed:{name}") for name, *_ in GETTING_STARTED_PAGES}
    if slug_map.keys() & welcome_slugs.keys():
        sys.exit("A guide page shares its name with a first-launch seed page")
    slug_map.update(welcome_slugs)
    if len(set(slug_map.values())) != len(slug_map):
        sys.exit("Two demo pages hash to the same slug; rename one of them")

    page_ids: dict[str, int] = {}
    # Getting Started takes sort_order 0, so the guide's roots start at 1.
    next_sort: dict[str | None, int] = {None: 1}
    seeded = []
    for name, filename, title, parent, page_type in MANUAL_PAGES:
        content = (MANUAL_DIR / filename).read_text(encoding="utf-8").strip()
        # The files open with an H1 so they read well on GitHub, but the app
        # already shows the page title above the content. A mindmap keeps
        # its H1: that's the root node.
        if page_type == "document" and content.startswith("# "):
            content = content.split("\n", 1)[1].lstrip() if "\n" in content else ""
        content = content + "\n"
        content = rewrite_page_slugs(content, slug_map)
        sort_order = next_sort.get(parent, 0)
        next_sort[parent] = sort_order + 1
        cursor = await db.execute(
            """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, created_by, page_type)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (slug_map[name], title, content, page_ids.get(parent), sort_order, admin_id, page_type),
        )
        page_id = cursor.lastrowid
        page_ids[name] = page_id
        await db.execute(
            """INSERT INTO page_versions (page_id, title, content_md, edited_by, version_num)
               VALUES (?, ?, ?, ?, 1)""",
            (page_id, title, content, admin_id),
        )
        # Tag pages by language so the tag filter has something to show.
        tag = {"zh-": "中文", "en-": "English"}.get(name[:3])
        if tag:
            await db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
            await db.execute(
                "INSERT INTO page_tags (page_id, tag_id) SELECT ?, id FROM tags WHERE name = ?",
                (page_id, tag),
            )
        await rebuild_search_index(db, page_id, title, content)
        seeded.append((page_id, content))

    await insert_getting_started_pages(db, admin_id, welcome_slugs)

    # Second pass so links to pages inserted later still resolve.
    for page_id, content in seeded:
        await parse_and_update_backlinks(db, page_id, content)

    await db.execute(
        "INSERT OR REPLACE INTO site_settings (key, value) VALUES ('home_page_slug', ?)",
        (slug_map["index"],),
    )
    await db.commit()


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
        await _seed_manual(db)
        # Pages now exist, so this only copies the logo into media/ and
        # skips the first-launch welcome pages.
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
        asyncio.run(_snapshot(out_dir))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # GitHub Pages serves 404.html for unknown paths; making it the SPA shell
    # lets deep links like /page/<slug> load the app instead of a 404.
    shutil.copyfile(out_dir / "index.html", out_dir / "404.html")


if __name__ == "__main__":
    main()
