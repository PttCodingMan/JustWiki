"""Regression test for m009 (page_type column + index).

Simulates the upgrade path: start from a pages table that lacks page_type,
run migrations, check the column, index, and default value all land.
"""
import os
import tempfile

import aiosqlite
import pytest

from app.migrations import run_migrations


@pytest.mark.asyncio
async def test_m009_adds_page_type_to_legacy_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        db = await aiosqlite.connect(path)
        db.row_factory = aiosqlite.Row
        try:
            # Shape: a database where migrations 1-8 are already recorded in
            # the ledger (normal upgrade case). _ensure_indexes runs after
            # every migration pass and references users / groups /
            # auth_identities, so we stub just enough schema for those
            # CREATE INDEX IF NOT EXISTS statements to succeed.
            await db.execute(
                """
                CREATE TABLE schema_migrations (
                    version    INTEGER PRIMARY KEY,
                    name       TEXT NOT NULL,
                    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            for v in range(1, 9):
                await db.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
                    (v, f"legacy_{v}"),
                )
            await db.execute(
                """
                CREATE TABLE pages (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    slug        TEXT UNIQUE NOT NULL,
                    title       TEXT NOT NULL,
                    content_md  TEXT NOT NULL DEFAULT '',
                    version     INTEGER NOT NULL DEFAULT 1,
                    is_public   INTEGER NOT NULL DEFAULT 0,
                    deleted_at  TIMESTAMP
                )
                """
            )
            await db.execute(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, deleted_at TIMESTAMP)"
            )
            await db.execute(
                "CREATE TABLE groups (id INTEGER PRIMARY KEY, ldap_dn TEXT)"
            )
            await db.execute(
                "CREATE TABLE auth_identities (id INTEGER PRIMARY KEY, user_id INTEGER)"
            )
            await db.execute(
                "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, ?)",
                ("legacy", "Legacy page", "body"),
            )
            await db.commit()

            applied = await run_migrations(db)

            # m009 should have run exactly once.
            assert 9 in applied

            # Column exists and backfills to 'document'.
            cols = {r["name"] for r in await db.execute_fetchall("PRAGMA table_info(pages)")}
            assert "page_type" in cols
            rows = await db.execute_fetchall("SELECT page_type FROM pages WHERE slug = 'legacy'")
            assert rows[0]["page_type"] == "document"

            # Index was created by _ensure_indexes regardless of fresh/upgrade.
            idx_rows = await db.execute_fetchall(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pages'"
            )
            idx_names = {r["name"] for r in idx_rows}
            assert "idx_pages_type" in idx_names

            # Re-running is a no-op (idempotent ledger).
            applied_again = await run_migrations(db)
            assert 9 not in applied_again
        finally:
            await db.close()
    finally:
        if os.path.exists(path):
            os.remove(path)
