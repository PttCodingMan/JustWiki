"""Versioned schema migrations for JustWiki.

Why not Alembic: JustWiki's core pitch is "single SQLite file, no external
deps." Alembic would add a CLI, a versions/ directory, an alembic.ini, and a
separate `alembic upgrade head` step in every deploy — extra weight that buys
us very little on a schema this small. Instead we keep the work in-process:
migrations are plain async functions in this module, identified by a
monotonically increasing integer version, recorded in `schema_migrations`,
and run once on startup by init_db().

Ground rules:
  * Append-only. Never renumber or rewrite a shipped migration — existing
    deployments have already recorded the version.
  * Each migration must be idempotent at the SQL level (IF NOT EXISTS, column
    probes, etc.) so partial re-runs are safe if a crash happens mid-run.
  * Use `run_migrations` as the single entry point. It returns the list of
    versions applied in this invocation; callers can use that signal to
    decide whether expensive follow-up work (full-text rebuild etc.) is
    needed.
"""
import logging
from typing import Awaitable, Callable

import aiosqlite

logger = logging.getLogger(__name__)

MigrationFn = Callable[[aiosqlite.Connection], Awaitable[None]]
Migration = tuple[int, str, MigrationFn]


async def _column_exists(db: aiosqlite.Connection, table: str, col: str) -> bool:
    # PRAGMA doesn't accept bind params for the table name, so quote the
    # identifier defensively. Today every caller passes a hard-coded literal,
    # but quoting blocks injection if a future caller ever feeds user input.
    safe = table.replace('"', '""')
    rows = await db.execute_fetchall(f'PRAGMA table_info("{safe}")')
    return any(r["name"] == col for r in rows)


# ── Migration functions ────────────────────────────────────────────────────
# New migrations go at the bottom. Never renumber or edit a shipped migration.


async def _m001_user_profile_columns(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "users", "display_name"):
        await db.execute("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''")
    if not await _column_exists(db, "users", "email"):
        await db.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")


async def _m002_user_soft_delete(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "users", "deleted_at"):
        await db.execute("ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP")
    if not await _column_exists(db, "users", "original_username"):
        await db.execute("ALTER TABLE users ADD COLUMN original_username TEXT")


async def _m003_page_version_counter(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "pages", "version"):
        await db.execute(
            "ALTER TABLE pages ADD COLUMN version INTEGER NOT NULL DEFAULT 1"
        )


async def _m004_page_soft_delete(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "pages", "deleted_at"):
        await db.execute("ALTER TABLE pages ADD COLUMN deleted_at TIMESTAMP")


async def _m005_page_is_public(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "pages", "is_public"):
        await db.execute(
            "ALTER TABLE pages ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0"
        )


async def _m006_auth_identities(db: aiosqlite.Connection) -> None:
    """Create auth_identities table to record OIDC / LDAP bindings.

    Fresh DBs already have it from SCHEMA_SQL; this migration handles upgrades
    where the CREATE TABLE would otherwise never run. The index is declared
    inside SCHEMA_SQL for fresh DBs but only gets created here for upgrades —
    without it, ON DELETE CASCADE becomes a full-table scan per user delete.
    """
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_identities (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider      TEXT    NOT NULL,
            subject       TEXT    NOT NULL,
            email         TEXT,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP,
            UNIQUE (provider, subject)
        )
        """
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id)"
    )


async def _m007_groups_ldap_dn(db: aiosqlite.Connection) -> None:
    """Add `ldap_dn` to `groups` so LDAP-mirrored groups can be reconciled.

    A group with ldap_dn IS NOT NULL is considered fully managed by the LDAP
    sync loop — user additions/removals during sync only touch those rows;
    manually-created groups (ldap_dn IS NULL) are never pruned.
    """
    if not await _column_exists(db, "groups", "ldap_dn"):
        await db.execute("ALTER TABLE groups ADD COLUMN ldap_dn TEXT")
        # SQLite can't add UNIQUE via ALTER. A partial unique index is the
        # idiomatic workaround and matches the semantics we want: only non-NULL
        # DNs must be unique (multiple manual groups with NULL dn are fine).
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_ldap_dn "
            "ON groups(ldap_dn) WHERE ldap_dn IS NOT NULL"
        )


async def _m008_api_tokens_extend(db: aiosqlite.Connection) -> None:
    """Extend api_tokens with prefix / expires_at / revoked_at.

    The earlier shape only tracked the hash and a `last_used` timestamp. The
    three new columns let the UI show a non-revealing identifier, let tokens
    expire automatically (30-day default), and let users revoke without
    losing the audit trail. All three are nullable so existing rows (if any)
    keep working — they'll read as "never expires, never revoked, no prefix".
    """
    if not await _column_exists(db, "api_tokens", "prefix"):
        await db.execute("ALTER TABLE api_tokens ADD COLUMN prefix TEXT")
    if not await _column_exists(db, "api_tokens", "expires_at"):
        await db.execute("ALTER TABLE api_tokens ADD COLUMN expires_at TIMESTAMP")
    if not await _column_exists(db, "api_tokens", "revoked_at"):
        await db.execute("ALTER TABLE api_tokens ADD COLUMN revoked_at TIMESTAMP")


async def _m009_page_type(db: aiosqlite.Connection) -> None:
    """Add `page_type` to pages so viewer can branch by rendering strategy.

    Value is a free-form TEXT (not CHECK-constrained) so we can introduce new
    types purely in Python (Pydantic Literal does the validation). Default
    'document' matches the pre-existing behavior for every row on upgrade.
    """
    if not await _column_exists(db, "pages", "page_type"):
        await db.execute(
            "ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'document'"
        )


async def _m011_mindmap_layout(db: aiosqlite.Connection) -> None:
    """Add `mindmap_layout` to pages so authors can pick LR / RL / Radial.

    Nullable TEXT — NULL means "use the frontend default" (`'lr'`), so legacy
    rows render unchanged. Validation is enforced by Pydantic Literal in
    schemas.MindmapLayout, not at the DB layer (matches `page_type`).
    """
    if not await _column_exists(db, "pages", "mindmap_layout"):
        await db.execute("ALTER TABLE pages ADD COLUMN mindmap_layout TEXT")


async def _m010_site_settings(db: aiosqlite.Connection) -> None:
    """Create site_settings for branding overrides and the home-page slug.

    Key/value rather than columns so new knobs land without an ALTER. Reads
    fall back to the in-code DEFAULT_SETTINGS map (see routers/settings.py),
    so an absent row simply means "use the built-in default".
    """
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS site_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


MIGRATIONS: list[Migration] = [
    (1, "user_profile_columns", _m001_user_profile_columns),
    (2, "user_soft_delete", _m002_user_soft_delete),
    (3, "page_version_counter", _m003_page_version_counter),
    (4, "page_soft_delete", _m004_page_soft_delete),
    (5, "page_is_public", _m005_page_is_public),
    (6, "auth_identities", _m006_auth_identities),
    (7, "groups_ldap_dn", _m007_groups_ldap_dn),
    (8, "api_tokens_extend", _m008_api_tokens_extend),
    (9, "page_type", _m009_page_type),
    (10, "site_settings", _m010_site_settings),
    (11, "mindmap_layout", _m011_mindmap_layout),
]


# ── Post-migration index invariants ────────────────────────────────────────
# These indexes reference columns added by migrations, so they can't live in
# SCHEMA_SQL (which runs first and would hit "no such column" on an upgrade).
# They can't live in the migration bodies either: when a fresh DB boots,
# every migration is detected as pre-applied and skipped, so an index baked
# into a migration body would never run. Treating them as always-ensure
# invariants after migrations is idempotent and covers both paths.
_INDEX_INVARIANTS = (
    "CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(deleted_at)",
    "CREATE INDEX IF NOT EXISTS idx_pages_public ON pages(slug) WHERE is_public = 1",
    # SQLite can't express "column-level UNIQUE only when non-NULL" in a
    # plain CREATE TABLE; the partial unique index is the standard workaround
    # and matches what groups.ldap_dn needs.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_ldap_dn "
    "ON groups(ldap_dn) WHERE ldap_dn IS NOT NULL",
    # ON DELETE CASCADE on auth_identities.user_id would be a full scan
    # without this. Declared in SCHEMA_SQL but that's skipped on upgrades
    # where the backfill marks m006 as already applied.
    "CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(page_type)",
)


async def _ensure_indexes(db: aiosqlite.Connection) -> None:
    for stmt in _INDEX_INVARIANTS:
        await db.execute(stmt)
    await db.commit()


# ── Runner ─────────────────────────────────────────────────────────────────


async def _ensure_ledger(db: aiosqlite.Connection) -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    await db.commit()


async def _applied_versions(db: aiosqlite.Connection) -> set[int]:
    rows = await db.execute_fetchall("SELECT version FROM schema_migrations")
    return {r["version"] for r in rows}


async def _detect_preexisting(db: aiosqlite.Connection) -> set[int]:
    """Infer which shipped migrations are already effectively applied.

    Needed for databases created before this module existed: the schema may
    already carry columns added by earlier in-place ALTERs. Backfilling the
    ledger here keeps the upgrade silent — no re-running of idempotent DDL,
    no spurious log lines about "applying migration v3".

    Only probes for artifacts the migration actually creates; anything more
    ambitious (row counts, index options) gets fragile fast.
    """
    applied: set[int] = set()
    if await _column_exists(db, "users", "display_name") and await _column_exists(
        db, "users", "email"
    ):
        applied.add(1)
    if await _column_exists(db, "users", "deleted_at") and await _column_exists(
        db, "users", "original_username"
    ):
        applied.add(2)
    if await _column_exists(db, "pages", "version"):
        applied.add(3)
    if await _column_exists(db, "pages", "deleted_at"):
        applied.add(4)
    if await _column_exists(db, "pages", "is_public"):
        applied.add(5)
    rows = await db.execute_fetchall(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_identities'"
    )
    if rows:
        applied.add(6)
    if await _column_exists(db, "groups", "ldap_dn"):
        applied.add(7)
    if await _column_exists(db, "api_tokens", "prefix"):
        applied.add(8)
    if await _column_exists(db, "pages", "page_type"):
        applied.add(9)
    rows = await db.execute_fetchall(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='site_settings'"
    )
    if rows:
        applied.add(10)
    if await _column_exists(db, "pages", "mindmap_layout"):
        applied.add(11)
    return applied


async def run_migrations(db: aiosqlite.Connection) -> list[int]:
    """Apply any pending migrations. Returns the versions applied this run.

    Also ensures schema-invariant indexes (see `_INDEX_INVARIANTS`) regardless
    of whether any migration ran, so fresh DBs get them too.
    """
    await _ensure_ledger(db)

    applied = await _applied_versions(db)
    # First run against a pre-existing DB: backfill the ledger from what's
    # observable in the schema, so we don't re-announce "applying v1…v5".
    if not applied:
        inferred = await _detect_preexisting(db)
        for v in sorted(inferred):
            name = next((n for (ver, n, _) in MIGRATIONS if ver == v), f"legacy_{v}")
            await db.execute(
                "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)",
                (v, name),
            )
        if inferred:
            await db.commit()
        applied = inferred

    just_applied: list[int] = []
    for version, name, fn in MIGRATIONS:
        if version in applied:
            continue
        logger.info("Applying schema migration %03d: %s", version, name)
        try:
            await fn(db)
            await db.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
                (version, name),
            )
            await db.commit()
        except Exception:
            # Leave the half-applied state on disk so an operator can inspect
            # it. The next startup will retry from this same migration.
            logger.exception("Schema migration %03d (%s) failed", version, name)
            raise
        just_applied.append(version)

    await _ensure_indexes(db)
    return just_applied
