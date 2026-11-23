import json
import os
import re
import tempfile

import aiosqlite
import pytest

from app.database import SCHEMA_SQL
from app.migrations import run_migrations

HEX_SLUG = re.compile(r"[0-9a-f]{8}")


@pytest.mark.asyncio
async def test_m014_rewrites_legacy_slugs_and_references():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        db = await aiosqlite.connect(path)
        db.row_factory = aiosqlite.Row
        try:
            for statement in SCHEMA_SQL.split(";"):
                if statement.strip():
                    await db.execute(statement)

            target = await db.execute(
                "INSERT INTO pages (slug, title, content_md) VALUES ('專案規劃', 'Plan', 'plan')"
            )
            target_id = target.lastrowid
            linking_body = (
                "See [[專案規劃]], [[專案規劃|the plan]], ![[專案規劃]], "
                "[url](/page/%E5%B0%88%E6%A1%88%E8%A6%8F%E5%8A%83/edit), "
                "[[missing-page]] and `/page/unrelated`"
            )
            source = await db.execute(
                "INSERT INTO pages (slug, title, content_md) VALUES ('notes', 'Notes', ?)",
                (linking_body,),
            )
            source_id = source.lastrowid
            await db.execute(
                "INSERT INTO pages (slug, title, content_md) VALUES ('0123abcd', 'Already hex', '')"
            )
            await db.execute(
                "INSERT INTO page_versions (page_id, title, content_md, version_num) VALUES (?, 'Notes', '[[專案規劃]]', 1)",
                (source_id,),
            )
            await db.execute(
                "INSERT INTO activity_log (action, target_type, target_id, metadata) VALUES ('created', 'page', ?, ?)",
                (target_id, json.dumps({"title": "Plan", "slug": "專案規劃"})),
            )
            await db.execute(
                "INSERT INTO site_settings (key, value) VALUES ('home_page_slug', '專案規劃')"
            )
            await db.commit()

            assert 14 in await run_migrations(db)

            slugs = {
                r["id"]: r["slug"]
                for r in await db.execute_fetchall("SELECT id, slug FROM pages")
            }
            new_target = slugs[target_id]
            assert HEX_SLUG.fullmatch(new_target)
            assert HEX_SLUG.fullmatch(slugs[source_id])
            assert "0123abcd" in slugs.values()
            assert len(set(slugs.values())) == len(slugs)

            content = (
                await db.execute_fetchall("SELECT content_md FROM pages WHERE id = ?", (source_id,))
            )[0]["content_md"]
            assert content == (
                f"See [[{new_target}|專案規劃]], [[{new_target}|the plan]], ![[{new_target}|專案規劃]], "
                f"[url](/page/{new_target}/edit), "
                "[[missing-page]] and `/page/unrelated`"
            )

            version = await db.execute_fetchall(
                "SELECT content_md FROM page_versions WHERE page_id = ?", (source_id,)
            )
            assert version[0]["content_md"] == f"[[{new_target}|專案規劃]]"

            activity = await db.execute_fetchall("SELECT metadata FROM activity_log")
            assert json.loads(activity[0]["metadata"]) == {"title": "Plan", "slug": new_target}

            home = await db.execute_fetchall(
                "SELECT value FROM site_settings WHERE key = 'home_page_slug'"
            )
            assert home[0]["value"] == new_target
        finally:
            await db.close()
    finally:
        if os.path.exists(path):
            os.remove(path)
