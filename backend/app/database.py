import asyncio
import contextvars
import logging
import re
import sqlite3
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
from app.config import settings

logger = logging.getLogger(__name__)

# FTS5 trigram tokenizer requires SQLite 3.43.0+ (2023-08-24)
_TRIGRAM_MIN_VERSION = (3, 43, 0)
_TOKENIZE_RE = re.compile(r"""tokenize\s*=\s*['"](\w+)['"]""", re.IGNORECASE)

# Reader pool size. SQLite WAL allows N readers + 1 writer concurrently; the
# limit on N is just how many simultaneous in-flight requests we want to
# parallelise. 8 is comfortable for a small wiki and cheap to hold open.
_READER_POOL_SIZE = 8

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    username          TEXT UNIQUE NOT NULL,
    password_hash     TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'editor',
    display_name      TEXT DEFAULT '',
    email             TEXT DEFAULT '',
    bio               TEXT NOT NULL DEFAULT '',
    original_username TEXT,
    is_active         INTEGER NOT NULL DEFAULT 1,
    deleted_at        TIMESTAMP,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Personal API tokens for programmatic access. Plaintext is shown once on
-- creation and never stored. Only sha256(token) is persisted for lookup.
-- `prefix` stores the first 8 chars of the plaintext so the UI can
-- identify a specific token without revealing it. `expires_at` and
-- `revoked_at` let a token be invalidated without losing the audit trail.
CREATE TABLE IF NOT EXISTS api_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT UNIQUE NOT NULL,
    prefix      TEXT,
    expires_at  TIMESTAMP,
    revoked_at  TIMESTAMP,
    last_used   TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- SSO binding per user. A user may have zero or more identities alongside
-- a local password (or instead of one, in which case users.password_hash
-- is set to the sentinel '!' to disable local login while keeping the
-- column NOT NULL).
CREATE TABLE IF NOT EXISTS auth_identities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      TEXT    NOT NULL,
    subject       TEXT    NOT NULL,
    email         TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    parent_id   INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    sort_order  INTEGER DEFAULT 0,
    view_count  INTEGER DEFAULT 0,
    version     INTEGER NOT NULL DEFAULT 1,
    is_public   INTEGER NOT NULL DEFAULT 0,
    page_type   TEXT NOT NULL DEFAULT 'document',
    mindmap_layout TEXT,
    deleted_at  TIMESTAMP,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
-- idx_pages_public is created by the migration block in init_db() — if it
-- were here, an upgrade from a DB lacking the is_public column would fail
-- on the first statement (column does not exist yet).

CREATE TABLE IF NOT EXISTS page_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL,
    edited_by   INTEGER REFERENCES users(id),
    edited_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version_num INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    content_md  TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS page_tags (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, tag_id)
);

CREATE TABLE IF NOT EXISTS backlinks (
    source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    PRIMARY KEY (source_page_id, target_page_id)
);

CREATE TABLE IF NOT EXISTS media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filepath      TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size_bytes    INTEGER,
    uploaded_by   INTEGER REFERENCES users(id),
    uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_references (
    page_id  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_media_refs_media ON media_references(media_id);

CREATE TABLE IF NOT EXISTS diagrams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    xml_data   TEXT NOT NULL,
    svg_cache  TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    events     TEXT NOT NULL DEFAULT 'page.updated',
    is_active  INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS page_watchers (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_page_watchers_page ON page_watchers(page_id);

CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    page_id    INTEGER REFERENCES pages(id) ON DELETE CASCADE,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    metadata   TEXT,
    read_at    TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    metadata    TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    ldap_dn     TEXT UNIQUE,           -- non-NULL marks this group as LDAP-sourced
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS page_acl (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id        INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    principal_type TEXT    NOT NULL CHECK (principal_type IN ('user', 'group')),
    principal_id   INTEGER NOT NULL,
    permission     TEXT    NOT NULL CHECK (permission IN ('read', 'write')),
    UNIQUE (page_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_page_acl_page ON page_acl(page_id);
CREATE INDEX IF NOT EXISTS idx_page_acl_principal ON page_acl(principal_type, principal_id);

-- Short-lived dedup keys for view_count. Rows are hashes, not user ids,
-- so a plain DB dump can't be used to reconstruct a reading history.
CREATE TABLE IF NOT EXISTS view_dedup (
    dedup_key      TEXT PRIMARY KEY,
    page_id        INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    last_viewed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_view_dedup_last ON view_dedup(last_viewed_at);

-- Site-wide branding and homepage overrides. Plain key/value so new knobs
-- can be added without an ALTER. Missing keys fall back to the in-code
-- DEFAULT_SETTINGS map in routers/settings.py.
CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

"""

# First-launch content lives as plain markdown under app/seed/ so it can be
# edited without touching Python.
_SEED_DIR = Path(__file__).parent / "seed"


def _read_seed(name: str) -> str:
    return (_SEED_DIR / name).read_text(encoding="utf-8")


# (slug, title, sort_order, page_type) — nested under the "getting-started" hub.
WELCOME_PAGES = [
    ("welcome", "Welcome to JustWiki", 0, "document"),
    ("welcome-zh", "歡迎使用 JustWiki", 1, "document"),
    ("welcome-mindmap", "JustWiki Feature Mindmap", 2, "mindmap"),
    ("welcome-mindmap-zh", "JustWiki 功能心智圖", 3, "mindmap"),
]

# (name, description, file under app/seed/templates/)
DEFAULT_TEMPLATES = [
    ("會議記錄", "團隊會議記錄模板", "meeting-notes.md"),
    ("技術文件", "技術規格或系統文件模板", "tech-doc.md"),
    ("Troubleshooting", "問題排除指南模板", "troubleshooting.md"),
    ("ADR", "Architecture Decision Record", "adr.md"),
]


def _get_preferred_tokenizer() -> str:
    """Return 'trigram' if the linked SQLite supports it, else 'unicode61'."""
    version = tuple(int(x) for x in sqlite3.sqlite_version.split("."))
    if version >= _TRIGRAM_MIN_VERSION:
        return "trigram"
    logger.warning(
        "SQLite %s < 3.43.0 — falling back to 'unicode61' tokenizer. "
        "CJK phrase search will be limited.",
        sqlite3.sqlite_version,
    )
    return "unicode61"


async def _ensure_fts5_index(db) -> bool:
    """Create or migrate the FTS5 search_index with the preferred tokenizer.

    Returns True if the table was (re)created and a full rebuild is needed.
    """
    preferred = _get_preferred_tokenizer()

    rows = await db.execute_fetchall(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'"
    )

    if rows:
        create_sql = rows[0]["sql"] or ""
        match = _TOKENIZE_RE.search(create_sql)
        current = match.group(1).lower() if match else None
        # page_id must be UNINDEXED — otherwise it's part of the full-text
        # index and a numeric query (e.g. "100") matches page ids via their
        # trigrams, returning irrelevant pages. Older DBs created it indexed.
        page_id_unindexed = "page_id unindexed" in create_sql.lower()

        if current == preferred and page_id_unindexed:
            return False  # Already correct — right tokenizer, page_id excluded

        logger.info(
            "Migrating search_index (tokenizer '%s'→'%s', page_id UNINDEXED=%s) …",
            current or "unknown",
            preferred,
            page_id_unindexed,
        )
        await db.execute("DROP TABLE IF EXISTS search_index")

    await db.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5("
        f"page_id UNINDEXED, title, content_segmented, tokenize='{preferred}')"
    )
    await db.commit()
    logger.info("FTS5 search_index ready (tokenizer=%s)", preferred)
    return True


# ── Connection pool ────────────────────────────────────────────────────────
#
# WAL mode allows many readers to run in parallel against the same SQLite
# file alongside a single writer. The previous design serialised everything
# through one shared aiosqlite connection, which negated that property.
#
# Now: a small pool of reader connections + one dedicated writer connection.
# Each HTTP request borrows a reader for the duration of the handler (set by
# `request_db_middleware` in main.py); inside `write_transaction(...)` the
# bound connection is swapped to the writer for the duration of the block,
# then restored. Boot/admin code (lifespan, conftest) uses `boot_db_context()`
# to bind the writer for sequential setup work.
#
# The router-facing API is a `ConnectionProxy` returned from `get_db()`. It
# delegates every attribute lookup to whatever connection is currently bound
# to this asyncio task via `_request_conn`, so existing call sites of the
# form `db = await get_db(); await db.execute(...)` keep working without
# changes when the bound connection is later swapped to the writer inside a
# `write_transaction`.


class ConnectionPool:
    """Reader pool + single writer connection over one SQLite file.

    Connections are created lazily on first use (deferred until inside an
    asyncio loop, which keeps construction at module-import time loop-free
    and lets pytest-asyncio drive initialisation in its own loop).
    """

    def __init__(self, db_path: str, reader_size: int = _READER_POOL_SIZE):
        self._db_path = db_path
        self._reader_size = reader_size
        # Ready readers, popped on acquire and pushed back on release.
        self._readers: deque[aiosqlite.Connection] = deque()
        self._writer: aiosqlite.Connection | None = None
        # Counts how many readers exist (in-pool + checked-out).
        self._reader_count = 0
        # Lazily created on first use so the lock binds to whichever loop
        # actually drives the pool. asyncio.Lock created at import time is
        # fine on Python 3.10+, but recreating per-loop sidesteps any
        # surprises if tests reuse the pool across multiple loops.
        self._init_lock: asyncio.Lock | None = None
        self._reader_sem: asyncio.Semaphore | None = None

    def _ensure_primitives(self) -> None:
        if self._init_lock is None:
            self._init_lock = asyncio.Lock()
        if self._reader_sem is None:
            self._reader_sem = asyncio.Semaphore(self._reader_size)

    async def _make_connection(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self._db_path)
        try:
            conn.row_factory = aiosqlite.Row
            # busy_timeout lets a writer wait briefly for the WAL writer slot
            # rather than failing immediately. 5 s is generous for a small wiki.
            await conn.execute("PRAGMA busy_timeout=5000")
            await conn.execute("PRAGMA foreign_keys=ON")
        except BaseException:
            await conn.close()
            raise
        return conn

    async def get_writer(self) -> aiosqlite.Connection:
        self._ensure_primitives()
        if self._writer is not None:
            return self._writer
        async with self._init_lock:
            if self._writer is None:
                conn = await self._make_connection()
                try:
                    # journal_mode persists in the DB file itself, so a
                    # re-open of an already-WAL database doesn't need to
                    # set it again. Re-issuing `PRAGMA journal_mode=WAL`
                    # on an already-WAL connection takes a brief lock
                    # that conflicts with FTS5 shadow tables (repro:
                    # PRAGMA → DROP TABLE on an FTS5 index → "database
                    # table is locked"). Query first; only switch if not
                    # already WAL.
                    rows = await conn.execute_fetchall("PRAGMA journal_mode")
                    current_mode = str(rows[0][0]).lower() if rows else ""
                    if current_mode != "wal":
                        await conn.execute("PRAGMA journal_mode=WAL")
                except BaseException:
                    # If post-connect setup fails, close the half-built
                    # connection so we don't leak its worker thread when a
                    # retry opens a fresh one.
                    await conn.close()
                    raise
                self._writer = conn
        return self._writer

    @asynccontextmanager
    async def acquire_reader(self):
        """Borrow a reader connection. Release on exit."""
        self._ensure_primitives()
        # Make sure WAL is enabled before any reader opens, otherwise the
        # first reader could race the writer's PRAGMA and end up in rollback
        # journal mode for its lifetime.
        await self.get_writer()
        async with self._reader_sem:
            conn = await self._take_reader()
            try:
                yield conn
            finally:
                self._readers.append(conn)

    async def _take_reader(self) -> aiosqlite.Connection:
        if self._readers:
            return self._readers.popleft()
        # Pool not yet full — open another connection on demand. Bounded
        # by the semaphore above so we never exceed `_reader_size`.
        async with self._init_lock:
            if self._readers:
                return self._readers.popleft()
            if self._reader_count < self._reader_size:
                conn = await self._make_connection()
                self._reader_count += 1
                return conn
        # Semaphore granted a slot, pool is empty AND already at size: this
        # is an invariant violation (a release lost track of a connection
        # or someone changed _reader_size at runtime). Fail loudly rather
        # than silently growing the pool past its bound.
        raise RuntimeError(
            "ConnectionPool invariant violated: reader semaphore granted a "
            "slot but pool is empty and at capacity. This usually means a "
            "reader was acquired without going through acquire_reader()."
        )

    async def close(self) -> None:
        if self._writer is not None:
            await self._writer.close()
            self._writer = None
        while self._readers:
            await self._readers.popleft().close()
        self._reader_count = 0


_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(settings.DB_PATH)
    return _pool


class _BoundScope:
    """Per-request / per-boot-context binding object.

    Carries the currently-bound connection plus a `released` flag set by
    the owning context manager when its scope ends. The proxy checks the
    flag on every access so background tasks that captured the request's
    ContextVar via ``asyncio.create_task(...)`` and then try to use the
    DB after the handler returned get a loud, immediate error instead of
    silently sharing a reader connection with another request.

    `conn` is mutated in-place by ``write_transaction`` to swap the bound
    connection between reader and writer; the same scope object is shared
    by parent and any tasks spawned with the parent's context, so the
    swap is visible everywhere consistently.
    """

    __slots__ = ("conn", "released")

    def __init__(self, conn: aiosqlite.Connection):
        self.conn = conn
        self.released = False


# Scope bound to the current asyncio task. Set by request middleware (with
# a reader scope) for the duration of an HTTP handler, by `boot_db_context`
# (with a writer scope) for lifespan / test fixture setup. Inside a
# `write_transaction` the scope's `conn` is temporarily swapped to the
# writer; the scope itself is the same object, so spawned tasks observe a
# consistent view.
_request_scope: contextvars.ContextVar[_BoundScope | None] = (
    contextvars.ContextVar("_request_scope", default=None)
)


class ConnectionProxy:
    """Forwards every aiosqlite Connection method to whatever connection
    is bound to the current asyncio task via `_request_scope`.

    This indirection is what lets ``db = await get_db()`` outside a
    ``write_transaction`` later route writes to the writer connection
    when the same ``db`` is used inside the block: the proxy looks up
    the current bound connection on every attribute access, so the swap
    performed by ``write_transaction`` is transparent to call sites.
    """

    __slots__ = ()

    def _conn(self) -> aiosqlite.Connection:
        scope = _request_scope.get()
        if scope is None:
            raise RuntimeError(
                "get_db() called outside a request or boot_db_context. "
                "If this is startup/test code, wrap it in `async with "
                "boot_db_context(): ...`."
            )
        if scope.released:
            raise RuntimeError(
                "get_db() called after the bound connection scope ended. "
                "This typically means an asyncio.create_task() spawned "
                "inside a request handler kept running after the handler "
                "returned and tried to use the DB. Either await the work "
                "before returning, or open a fresh boot_db_context inside "
                "the spawned task."
            )
        return scope.conn

    def __getattr__(self, name):
        # __getattr__ only fires for names not found via normal lookup,
        # so forwarding the entire aiosqlite Connection surface (execute,
        # execute_fetchall, executemany, commit, rollback, cursor, ...)
        # works without an explicit allow-list.
        return getattr(self._conn(), name)


_proxy = ConnectionProxy()


async def get_db():
    """Return a connection proxy bound to the current request/boot scope.

    Public signature unchanged from the previous implementation: callers
    keep doing ``db = await get_db(); await db.execute(...)``. The proxy
    routes each call to whichever real connection is bound right now —
    a reader for plain handlers, the writer inside ``write_transaction``.
    """
    return _proxy


# Per-task flag set while inside an outer write_transaction so nested calls
# from helper services become no-op pass-throughs (the outer context owns the
# commit/rollback). ContextVar is task-local in asyncio, so each request gets
# its own copy.
_in_write_tx: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "_in_write_tx", default=False
)

# Serialises writer-connection statements at the Python level. SQLite itself
# would interleave concurrent writers via BEGIN IMMEDIATE / busy_timeout, but
# we share one writer connection across requests, so two tasks issuing
# statements on it would mix into one transaction. The lock keeps each
# write_transaction's statements contiguous on the writer.
_writer_lock = asyncio.Lock()


@asynccontextmanager
async def write_transaction(db=None):
    """Serialised write critical section with commit-or-rollback semantics.

    Behaviour from the caller's point of view is unchanged: wrap a block of
    writes in ``async with write_transaction(db):`` and on success the
    transaction commits, on exception it rolls back. The ``db`` argument is
    accepted for back-compat with the previous signature but ignored — the
    block always runs against the pool's writer connection regardless of
    which connection the caller picked up earlier from ``get_db()``.

    Re-entrant: if the current task is already inside a write_transaction
    (e.g. a router calls into a service that also wraps its writes), the
    inner block runs without re-acquiring the lock or committing. The
    outermost context owns the commit; on any exception anywhere inside,
    it rolls back the whole batch.

    Thread/task safety: do not span an ``asyncio.create_task(...)`` from
    inside a write_transaction. The spawned task copies the parent's
    ``_in_write_tx=True`` and would skip lock acquisition while issuing
    statements concurrently with the parent on the same writer connection.
    Either ``await`` the work inline or open a fresh write_transaction
    inside the spawned task.
    """
    del db  # accepted for back-compat; the pool decides the writer connection.
    scope = _request_scope.get()
    if scope is None:
        raise RuntimeError(
            "write_transaction used outside a request or boot_db_context. "
            "If this is startup/test code, wrap it in `async with "
            "boot_db_context(): ...`."
        )

    if _in_write_tx.get():
        # Nested: we're already on the writer with the lock held.
        yield scope.conn
        return

    pool = _get_pool()
    writer = await pool.get_writer()

    async with _writer_lock:
        prev_conn = scope.conn
        scope.conn = writer
        in_tx_token = _in_write_tx.set(True)
        try:
            yield writer
            await writer.commit()
        except BaseException:
            await writer.rollback()
            raise
        finally:
            _in_write_tx.reset(in_tx_token)
            scope.conn = prev_conn


@asynccontextmanager
async def boot_db_context():
    """Bind the writer connection for code that runs outside a request.

    Used by app lifespan (init_db, ensure_admin_exists, seed_welcome_page)
    and pytest fixtures. Inside this context, ``get_db()`` returns a proxy
    pointing at the writer connection so existing helpers keep working
    without per-call wiring. Does NOT open a transaction — boot code
    continues to use explicit ``await db.commit()`` calls as it always has.
    """
    pool = _get_pool()
    writer = await pool.get_writer()
    scope = _BoundScope(writer)
    token = _request_scope.set(scope)
    try:
        yield writer
    finally:
        scope.released = True
        _request_scope.reset(token)


@asynccontextmanager
async def request_db_context():
    """Bind a reader connection for the lifetime of one HTTP request.

    Mounted as ASGI middleware in main.py. Inside the context, ``get_db()``
    returns the borrowed reader; ``write_transaction`` temporarily swaps it
    out for the writer.

    The reader is released back to the pool on exit and the scope object
    is marked released, so any code that captured this request's context
    (via ``asyncio.create_task(...)``, etc.) and then tries to use the DB
    after the handler returns gets a loud RuntimeError from the proxy
    instead of silently sharing a reader with the next request.
    """
    pool = _get_pool()
    async with pool.acquire_reader() as reader:
        scope = _BoundScope(reader)
        token = _request_scope.set(scope)
        try:
            yield reader
        finally:
            scope.released = True
            _request_scope.reset(token)


async def rebuild_all_search_indexes(db):
    """Rebuild FTS5 search index for all existing pages."""
    from app.services.search import rebuild_search_index

    # Check if index is empty
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM search_index")
    if rows[0]["cnt"] > 0:
        return  # Already populated

    pages = await db.execute_fetchall(
        "SELECT id, title, content_md FROM pages WHERE deleted_at IS NULL"
    )
    for p in pages:
        await rebuild_search_index(db, p["id"], p["title"], p["content_md"])
    if pages:
        await db.commit()


async def rebuild_all_backlinks(db):
    """Rebuild backlinks for all existing pages."""
    from app.services.wikilink import parse_and_update_backlinks

    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM backlinks")
    if rows[0]["cnt"] > 0:
        return  # Already populated

    pages = await db.execute_fetchall(
        "SELECT id, content_md FROM pages WHERE deleted_at IS NULL"
    )
    for p in pages:
        await parse_and_update_backlinks(db, p["id"], p["content_md"])
    if pages:
        await db.commit()


async def rebuild_all_media_refs(db):
    """Rebuild media_references for all existing pages (one-time backfill).

    Tracked via PRAGMA user_version bit 0x1. The previous COUNT(*)>0 guard
    skipped the scan as soon as any row existed, which meant pages created
    before the feature shipped never got their refs backfilled on a wiki
    that had already added media after the first deploy.
    """
    from app.services.media_ref import parse_and_update_media_refs

    rows = await db.execute_fetchall("PRAGMA user_version")
    current = rows[0]["user_version"] if rows else 0
    if current & 0x1:
        return

    pages = await db.execute_fetchall(
        "SELECT id, content_md FROM pages WHERE deleted_at IS NULL"
    )
    for p in pages:
        await parse_and_update_media_refs(db, p["id"], p["content_md"])
    await db.execute(f"PRAGMA user_version = {current | 0x1}")


async def seed_welcome_page(db):
    """Create a welcome/guide page on first launch when no pages exist."""
    # Ensure logo.png exists in media directory (independent of whether pages exist)
    import shutil
    import os

    # 1. Determine base directories
    # In Docker: /app/app/database.py -> app_dir is /app
    # In Local: backend/app/database.py -> app_dir is .../backend
    app_dir = Path(__file__).resolve().parent.parent
    project_root = app_dir.parent if app_dir.name == "backend" else app_dir

    # 2. Try multiple possible source locations for the logo
    possible_sources = [
        app_dir / "docs" / "images" / "logo.png",
        project_root / "docs" / "images" / "logo.png",
        Path("/app/docs/images/logo.png"),
        Path("/app/backend/docs/images/logo.png"),
    ]
    
    logo_src = next((s for s in possible_sources if s.exists()), None)
    
    # 3. Destination (Ensure absolute path)
    media_dir = Path(settings.MEDIA_DIR).resolve()
    media_dir.mkdir(parents=True, exist_ok=True)
    logo_dst = media_dir / "logo.png"

    if logo_src and not logo_dst.exists():
        try:
            shutil.copy2(logo_src, logo_dst)
            # Make sure it's readable
            os.chmod(logo_dst, 0o644)
            logger.info("Seeded logo from %s to %s", logo_src, logo_dst)
        except OSError:
            # Best-effort — missing/broken source file shouldn't block boot.
            logger.warning("Logo seeding failed", exc_info=True)

    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM pages")
    if rows[0]["cnt"] > 0:
        return  # Pages already exist

    # Get admin user id for created_by
    admin_rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    )
    admin_id = admin_rows[0]["id"] if admin_rows else None

    from app.services.search import rebuild_search_index
    from app.services.wikilink import parse_and_update_backlinks

    # "Getting Started" hub at the top of the tree, with bilingual walkthroughs
    # and mindmap demos nested underneath. Parent is inserted first so the
    # children's parent_id resolves; wikilinks are parsed in a second pass so
    # cross-links between siblings are not silently dropped.
    hub_id = None
    seeded = []
    for slug, title, sort_order, page_type in [
        ("getting-started", "Getting Started", 0, "document"),
        *WELCOME_PAGES,
    ]:
        content = _read_seed(f"{slug}.md")
        cursor = await db.execute(
            """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, created_by, page_type)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (slug, title, content, hub_id, sort_order, admin_id, page_type),
        )
        page_id = cursor.lastrowid
        hub_id = hub_id or page_id  # the first page is the hub

        await db.execute(
            """INSERT INTO page_versions (page_id, title, content_md, edited_by, version_num)
               VALUES (?, ?, ?, ?, 1)""",
            (page_id, title, content, admin_id),
        )

        await rebuild_search_index(db, page_id, title, content)
        seeded.append((page_id, content))

    for page_id, content in seeded:
        await parse_and_update_backlinks(db, page_id, content)

    # Pin Getting Started as the default landing page so first-time visitors
    # see the guide instead of an empty "All Pages" list. Admins can clear
    # this in Admin → Site Settings. Only set when no override exists yet,
    # so an operator who deliberately blanked it isn't undone on the next
    # boot if all pages happen to be deleted and re-seeded.
    existing = await db.execute_fetchall(
        "SELECT 1 FROM site_settings WHERE key = 'home_page_slug'"
    )
    if not existing:
        await db.execute(
            "INSERT INTO site_settings (key, value) VALUES ('home_page_slug', 'getting-started')"
        )

    await db.commit()


async def init_db():
    db = await get_db()
    # Execute each statement individually to avoid blocking the event loop
    for statement in SCHEMA_SQL.split(';'):
        statement = statement.strip()
        if statement:
            await db.execute(statement)
    await db.commit()

    # Versioned schema migrations. Handles both fresh DBs (nothing to do,
    # SCHEMA_SQL already created everything) and upgrades from pre-migration
    # deployments (backfills the ledger from observed schema). See
    # app/migrations.py for the list and the rules for adding new ones.
    from app.migrations import run_migrations
    await run_migrations(db)

    # Ensure FTS5 index exists with the best available tokenizer.
    # If the tokenizer changed (e.g. unicode61 → trigram), the table is
    # recreated empty and rebuild_all_search_indexes will repopulate it.
    await _ensure_fts5_index(db)

    # Rebuild search index for existing pages
    await rebuild_all_search_indexes(db)

    # Rebuild backlinks for existing pages
    await rebuild_all_backlinks(db)

    # Rebuild media references for existing pages
    await rebuild_all_media_refs(db)

    # Seed default templates
    for name, description, filename in DEFAULT_TEMPLATES:
        existing = await db.execute_fetchall(
            "SELECT id FROM templates WHERE name = ?", (name,)
        )
        if not existing:
            await db.execute(
                "INSERT INTO templates (name, description, content_md) VALUES (?, ?, ?)",
                (name, description, _read_seed(f"templates/{filename}")),
            )
    await db.commit()


async def close_db():
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
