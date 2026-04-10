import aiosqlite
from app.config import settings

_db: aiosqlite.Connection | None = None

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'editor',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT UNIQUE NOT NULL,
    last_used   TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    parent_id   INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    sort_order  INTEGER DEFAULT 0,
    view_count  INTEGER DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);

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

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    page_id, title, content_segmented,
    tokenize='unicode61'
);
"""

DEFAULT_TEMPLATES = [
    {
        "name": "會議記錄",
        "description": "團隊會議記錄模板",
        "content_md": """# 會議記錄 — {日期}

## 參與者
-

## 議程
1.

## 討論內容

### 議題一


## 決議事項
- [ ]

## 下次會議
- 日期：
- 議題：
""",
    },
    {
        "name": "技術文件",
        "description": "技術規格或系統文件模板",
        "content_md": """# {標題}

## 概述


## 架構


## API


## 使用方式

```bash

```

## 注意事項

:::warning
:::

## 參考資料
-
""",
    },
    {
        "name": "Troubleshooting",
        "description": "問題排除指南模板",
        "content_md": """# Troubleshooting: {問題描述}

## 症狀


## 原因分析


## 解決步驟

1.

## 驗證方式

```bash

```

:::tip
如果以上步驟無法解決，請聯繫 ...
:::
""",
    },
    {
        "name": "ADR",
        "description": "Architecture Decision Record",
        "content_md": """# ADR-{編號}: {決策標題}

## 狀態
提議中 / 已接受 / 已棄用 / 已取代

## 背景


## 決策


## 理由


## 後果

### 正面
-

### 負面
-

## 參考
-
""",
    },
]


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        _db = await aiosqlite.connect(settings.DB_PATH)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
    return _db


async def rebuild_all_search_indexes(db):
    """Rebuild FTS5 search index for all existing pages."""
    from app.services.search import rebuild_search_index

    # Check if index is empty
    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM search_index")
    if rows[0]["cnt"] > 0:
        return  # Already populated

    pages = await db.execute_fetchall("SELECT id, title, content_md FROM pages")
    for p in pages:
        await rebuild_search_index(db, p["id"], p["title"], p["content_md"])
    if pages:
        await db.commit()


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA_SQL)
    await db.commit()

    # Rebuild search index for existing pages
    await rebuild_all_search_indexes(db)

    # Seed default templates
    for t in DEFAULT_TEMPLATES:
        existing = await db.execute_fetchall(
            "SELECT id FROM templates WHERE name = ?", (t["name"],)
        )
        if not existing:
            await db.execute(
                "INSERT INTO templates (name, description, content_md) VALUES (?, ?, ?)",
                (t["name"], t["description"], t["content_md"]),
            )
    await db.commit()


async def close_db():
    global _db
    if _db:
        await _db.close()
        _db = None
