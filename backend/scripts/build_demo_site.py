"""Render the seeded welcome content into a static HTML site.

Run from ``backend/`` with ``PYTHONPATH=.`` so ``app`` is importable:

    PYTHONPATH=. python scripts/build_demo_site.py ../public

The script points JustWiki at a throwaway data directory, runs the same
init + seed path the server uses on first boot, then writes every page
through ``app.routers.export.build_site_files``.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path


def main():
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "./public").resolve()

    tmp = Path(tempfile.mkdtemp(prefix="justwiki-demo-"))
    os.environ["DATA_DIR"] = str(tmp)
    os.environ["DB_PATH"] = str(tmp / "just-wiki.db")
    os.environ["MEDIA_DIR"] = str(tmp / "media")

    # Imports must happen after env vars are set so pydantic-settings reads
    # the throwaway paths instead of the repo's .env / defaults.
    from app.auth import ensure_admin_exists
    from app.database import close_db, get_db, init_db, seed_welcome_page
    from app.routers.export import build_site_files

    async def run():
        await init_db()
        await ensure_admin_exists()
        db = await get_db()
        await seed_welcome_page(db)
        pages = await db.execute_fetchall(
            "SELECT id, slug, title, content_md FROM pages "
            "WHERE deleted_at IS NULL ORDER BY title"
        )
        out_dir.mkdir(parents=True, exist_ok=True)
        for filename, content in build_site_files(pages):
            (out_dir / filename).write_text(content, encoding="utf-8")
        await close_db()

    asyncio.run(run())
    print(f"Wrote demo site to {out_dir}")


if __name__ == "__main__":
    main()
