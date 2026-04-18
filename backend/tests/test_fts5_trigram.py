"""Unit tests for FTS5 trigram tokenizer selection and migration logic."""

import sqlite3
from unittest.mock import patch

import pytest

from app.database import _get_preferred_tokenizer, _ensure_fts5_index, get_db


class TestGetPreferredTokenizer:
    def test_returns_trigram_on_modern_sqlite(self):
        with patch.object(sqlite3, "sqlite_version", "3.45.1"):
            assert _get_preferred_tokenizer() == "trigram"

    def test_returns_trigram_on_exact_min_version(self):
        with patch.object(sqlite3, "sqlite_version", "3.43.0"):
            assert _get_preferred_tokenizer() == "trigram"

    def test_returns_unicode61_on_old_sqlite(self):
        with patch.object(sqlite3, "sqlite_version", "3.40.1"):
            assert _get_preferred_tokenizer() == "unicode61"


@pytest.mark.asyncio
async def test_ensure_fts5_creates_index_when_missing():
    """_ensure_fts5_index should create the table if it doesn't exist."""
    db = await get_db()

    # Drop the table so we can exercise the "missing" branch.
    await db.execute("DROP TABLE IF EXISTS search_index")
    await db.commit()

    recreated = await _ensure_fts5_index(db)
    assert recreated is True

    rows = await db.execute_fetchall(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'"
    )
    assert rows, "search_index table should be created by _ensure_fts5_index"

    create_sql = rows[0]["sql"].lower()
    expected = _get_preferred_tokenizer()
    assert expected in create_sql


@pytest.mark.asyncio
async def test_ensure_fts5_migration_drops_and_recreates():
    """Simulating a tokenizer change should trigger DROP + CREATE."""
    db = await get_db()

    # Insert a test row so we can verify the table gets emptied after migration
    await db.execute(
        "INSERT OR IGNORE INTO search_index (page_id, title, content_segmented) "
        "VALUES ('99999', 'migration test', 'test content')"
    )
    await db.commit()

    # Force migration by pretending the preferred tokenizer is different
    current = _get_preferred_tokenizer()
    fake = "unicode61" if current == "trigram" else "trigram"

    with patch("app.database._get_preferred_tokenizer", return_value=fake):
        recreated = await _ensure_fts5_index(db)
    assert recreated is True

    # Table should be empty after recreation
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM search_index")
    assert rows[0]["cnt"] == 0

    # Restore the correct tokenizer
    recreated = await _ensure_fts5_index(db)
    assert recreated is True


@pytest.mark.asyncio
async def test_ensure_fts5_noop_when_correct():
    """No migration should happen if the tokenizer is already correct."""
    db = await get_db()

    # Ensure we start with the correct tokenizer
    await _ensure_fts5_index(db)

    # Call again — should be a no-op
    recreated = await _ensure_fts5_index(db)
    assert recreated is False
