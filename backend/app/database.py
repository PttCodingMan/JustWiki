import logging
import re
import sqlite3
from pathlib import Path

import aiosqlite
from app.config import settings

logger = logging.getLogger(__name__)

# FTS5 trigram tokenizer requires SQLite 3.43.0+ (2023-08-24)
_TRIGRAM_MIN_VERSION = (3, 43, 0)
_TOKENIZE_RE = re.compile(r"""tokenize\s*=\s*['"](\w+)['"]""", re.IGNORECASE)

_db: aiosqlite.Connection | None = None

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    username          TEXT UNIQUE NOT NULL,
    password_hash     TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'editor',
    display_name      TEXT DEFAULT '',
    email             TEXT DEFAULT '',
    original_username TEXT,
    deleted_at        TIMESTAMP,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    version     INTEGER NOT NULL DEFAULT 1,
    is_public   INTEGER NOT NULL DEFAULT 0,
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

"""

WELCOME_PAGE_CONTENT_EN = r"""# Welcome to JustWiki

> 🌐 **Language:** English · [[welcome-zh|中文]]

![JustWiki](/api/media/logo.png)

JustWiki is a lightweight, self-hosted knowledge base for small teams. Built around Markdown and backed by a single SQLite file, it needs no external database — you can be up and running in minutes.

This page walks you through every feature. Feel free to edit or delete it at any time.

---

## Quick Start

1. Click **＋ New Page** in the left sidebar or press `Ctrl+N`
2. Enter a title and content (Markdown is supported)
3. Save, and the page will appear in the sidebar tree

:::tip
When creating a page you can also pick a **template** (meeting notes, tech spec, ADR, troubleshooting, etc.). Several common templates are built in.
:::

---

## Markdown Syntax

JustWiki fully supports GitHub Flavored Markdown (GFM). Here are the most common examples:

### Headings

```
# Heading 1
## Heading 2
### Heading 3
```

### Text Formatting

| Syntax | Result |
|--------|--------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `inline code` `` | `inline code` |
| `~~strikethrough~~` | ~~strikethrough~~ |

### Lists

```
- Unordered item
- Another item
  - Nested item

1. Ordered list
2. Second item

- [x] Completed task
- [ ] Pending task
```

Rendered:

- [x] Completed task
- [ ] Pending task

### Tables

```
| Column A | Column B | Column C |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
```

### Code Blocks

Syntax highlighting is enabled — just label the language after the opening fence:

```python
def hello():
    print("Hello, JustWiki!")
```

```javascript
const greet = () => console.log("Hello!");
```

### Blockquotes

> This is a blockquote.
> It can span multiple lines.

### Images and Links

```
[Link text](https://example.com)
![Alt text](image-url)
```

---

## Wikilinks (Page Cross-Links)

Use double square brackets to link between pages:

```
Link to another page: [[page-slug]]
Custom display text:  [[page-slug|Display Text]]
```

- Typing `[[` inside the editor opens a page autocomplete popup
- Backlinks are tracked automatically and shown at the bottom of each page

---

## Callout Blocks

Use the `:::` syntax to create highlighted callouts:

:::info
This is an **info** callout — great for supplementary notes.
:::

:::warning
This is a **warning** callout — flag things that need attention.
:::

:::tip
This is a **tip** callout — share small tricks and shortcuts.
:::

:::danger
This is a **danger** callout — mark risky or destructive operations.
:::

Syntax:

```
:::info
Callout content. **Markdown** is supported inside.
:::
```

---

## Mermaid Diagrams

Draw flowcharts, sequence diagrams and more right in the page using Mermaid:

```mermaid
graph LR
    A[Write content] --> B[Save page]
    B --> C[Index automatically]
    C --> D[Search & explore]
```

```mermaid
sequenceDiagram
    participant User
    participant Wiki
    participant Database
    User->>Wiki: Edit page
    Wiki->>Database: Save content
    Database-->>Wiki: OK
    Wiki-->>User: Saved
```

Supported diagram types include flowchart, sequence, class, state, gantt, pie and more.

---

## Math (KaTeX)

Wrap content in double dollar signs to render math:

Inline: $E = mc^2$

Block:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

---

## Page Management

### Page Tree

Pages can have a **parent page**, forming a hierarchy. The left sidebar displays everything as a tree.

### Version History

Every save creates a new version. You can:
- Browse all past versions of a page
- Diff any two versions side by side
- Revert to any previous version

### Tags

Attach tags to pages for easy categorisation and filtering. The home page lists every tag for quick browsing.

---

## Search

Press `Ctrl+K` to open the search panel. It supports:
- Full-text search (powered by SQLite FTS5)
- CJK tokenisation for Chinese / Japanese / Korean
- Filter by tag

---

## Media Uploads

- **Paste images** directly into the editor to auto-upload
- **Drag and drop** files onto the editor
- Maximum file size: 20 MB

---

## Graph View

Click **Graph** in the sidebar to see all pages and their relationships as an interactive force-directed graph. Every wikilink becomes an edge, making it easy to explore how your knowledge is connected.

---

## Bookmarks and Comments

- **Bookmarks** — click the bookmark icon on any page to pin it for quick access
- **Comments** — every page has a comments section for team discussion

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New page |
| `Ctrl+K` | Open search |
| `Ctrl+E` | Toggle edit / view mode |

---

## Themes

JustWiki ships with multiple built-in themes (Light, Dark, Lavender, Forest, and more). Switch from the theme picker — your choice is remembered per browser.

---

## Admin Features

Admins can:
- Manage users (create, change role, deactivate)
- Back up the database
- Export all pages

---

## Deployment

JustWiki runs on Docker Compose with two services:
- **Backend** — FastAPI + uvicorn (port 8000)
- **Frontend** — React + nginx (port 3000)
- Both share the `./data` directory for the SQLite database and uploaded media

All configuration lives in a single `.env` file.

---

:::info
This very page was written with JustWiki's own Markdown features. Click the edit button in the top right to peek at the source — and feel free to edit or delete this page at any time.
:::

Happy writing!
"""

WELCOME_PAGE_CONTENT_ZH = r"""# 歡迎使用 JustWiki

> 🌐 **語言：** [[welcome|English]] · 中文

![JustWiki](/api/media/logo.png)

JustWiki 是一套輕量、自架式的團隊知識庫系統。以 Markdown 為核心，所有資料存放在單一 SQLite 檔案，不需要外部資料庫，幾分鐘就能上手。

這篇文章會帶你認識所有功能，你可以隨時編輯或刪除它。

---

## 快速開始

1. 按下左側邊欄的 **＋ 新增頁面** 或使用快捷鍵 `Ctrl+N`
2. 輸入標題與內容（支援 Markdown）
3. 儲存後就會出現在頁面列表中

:::tip
你也可以在新增頁面時選擇 **模板**（如會議記錄、技術文件、ADR 等），系統已內建多種常用模板。
:::

---

## Markdown 語法

JustWiki 完整支援 GitHub Flavored Markdown (GFM)，以下是常用語法範例：

### 標題

```
# 一級標題
## 二級標題
### 三級標題
```

### 文字格式

| 語法 | 效果 |
|------|------|
| `**粗體**` | **粗體** |
| `*斜體*` | *斜體* |
| `` `行內程式碼` `` | `行內程式碼` |
| `~~刪除線~~` | ~~刪除線~~ |

### 清單

```
- 無序清單項目
- 另一個項目
  - 巢狀項目

1. 有序清單
2. 第二項

- [x] 已完成任務
- [ ] 待辦任務
```

效果：

- [x] 已完成任務
- [ ] 待辦任務

### 表格

```
| 欄位 A | 欄位 B | 欄位 C |
|--------|--------|--------|
| 資料 1 | 資料 2 | 資料 3 |
```

### 程式碼區塊

支援語法高亮，在程式碼開頭標記語言名稱即可：

```python
def hello():
    print("Hello, JustWiki!")
```

```javascript
const greet = () => console.log("Hello!");
```

### 引用

> 這是一段引用文字。
> 可以跨行。

### 圖片與連結

```
[連結文字](https://example.com)
![圖片說明](圖片網址)
```

---

## Wikilinks（頁面互連）

使用雙方括號即可快速連結到其他頁面：

```
連到另一頁：[[page-slug]]
自訂顯示文字：[[page-slug|顯示文字]]
```

- 在編輯器中輸入 `[[` 會自動跳出頁面搜尋提示
- 系統會自動追蹤頁面之間的反向連結（backlinks），在頁面底部顯示

---

## 提示框（Callout Blocks）

使用 `:::` 語法可以建立醒目的提示框：

:::info
這是一個 **資訊** 提示框，適合補充說明。
:::

:::warning
這是一個 **警告** 提示框，提醒需要注意的事項。
:::

:::tip
這是一個 **提示** 框，分享小技巧。
:::

:::danger
這是一個 **危險** 提示框，標記可能造成問題的操作。
:::

語法範例：

```
:::info
提示框內容，支援 **Markdown** 格式。
:::
```

---

## Mermaid 圖表

使用 Mermaid 語法即可直接在頁面中繪製流程圖、序列圖等：

```mermaid
graph LR
    A[撰寫文件] --> B[儲存頁面]
    B --> C[自動建立索引]
    C --> D[搜尋與探索]
```

```mermaid
sequenceDiagram
    participant 使用者
    participant Wiki
    participant 資料庫
    使用者->>Wiki: 編輯頁面
    Wiki->>資料庫: 儲存內容
    資料庫-->>Wiki: 確認
    Wiki-->>使用者: 儲存成功
```

支援的圖表類型包括：flowchart、sequence、class、state、gantt、pie 等。

---

## 數學公式（KaTeX）

在內容前後各加上兩個錢號即可顯示數學公式：

行內公式：$E = mc^2$

區塊公式：

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

---

## 頁面管理

### 頁面樹狀結構

頁面可以設定 **父頁面**，形成階層式結構。左側邊欄會以樹狀方式顯示所有頁面。

### 版本歷史

每次儲存都會自動建立版本紀錄，你可以：
- 查看歷史版本列表
- 比較任意兩個版本之間的差異（diff）
- 回溯到任何歷史版本

### 標籤（Tags）

為頁面加上標籤方便分類與篩選，首頁會顯示所有標籤供快速瀏覽。

---

## 搜尋

按下 `Ctrl+K` 開啟搜尋面板，支援：
- 全文搜尋（使用 SQLite FTS5 引擎）
- 中日韓文字分詞搜尋
- 依標籤篩選

---

## 媒體上傳

- 在編輯器中直接 **貼上圖片** 即可自動上傳
- 也可以透過 **拖曳** 上傳圖片
- 支援最大 20MB 的檔案

---

## 圖譜檢視（Graph View）

點擊側邊欄的 **圖譜** 可以看到所有頁面之間的連結關係，以互動式力導向圖呈現。透過 wikilinks 建立的連結會以線條顯示，方便你探索知識之間的關聯。

---

## 書籤與留言

- **書籤**：在任何頁面點擊書籤圖示即可收藏，方便快速存取
- **留言**：每個頁面下方都有留言區，適合團隊討論

---

## 鍵盤快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `Ctrl+N` | 新增頁面 |
| `Ctrl+K` | 開啟搜尋 |
| `Ctrl+E` | 切換編輯 / 檢視模式 |

---

## 佈景主題

JustWiki 內建多種主題（亮色、暗色、薰衣草、森林等），可在設定中自由切換，偏好會自動記住。

---

## 管理功能

管理員可以：
- 管理使用者（新增、修改角色、停用）
- 備份資料庫
- 匯出所有頁面

---

## 部署方式

JustWiki 使用 Docker Compose 部署，包含：
- **後端**：FastAPI + uvicorn（port 8000）
- **前端**：React + nginx（port 3000）
- 共用 `./data` 目錄存放 SQLite 資料庫與上傳檔案

所有設定透過 `.env` 檔案管理。

---

:::info
這篇文章本身就是用 JustWiki 的 Markdown 功能撰寫的，你可以點擊右上角的編輯按鈕查看原始碼，或隨時修改、刪除這篇文章。
:::

祝你使用愉快！
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

        if current == preferred:
            return False  # Already using the right tokenizer

        logger.info(
            "Migrating search_index tokenizer from '%s' to '%s' …",
            current or "unknown",
            preferred,
        )
        await db.execute("DROP TABLE IF EXISTS search_index")

    await db.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5("
        f"page_id, title, content_segmented, tokenize='{preferred}')"
    )
    await db.commit()
    logger.info("FTS5 search_index ready (tokenizer=%s)", preferred)
    return True


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


async def rebuild_all_backlinks(db):
    """Rebuild backlinks for all existing pages."""
    from app.services.wikilink import parse_and_update_backlinks

    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM backlinks")
    if rows[0]["cnt"] > 0:
        return  # Already populated

    pages = await db.execute_fetchall("SELECT id, content_md FROM pages")
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

    pages = await db.execute_fetchall("SELECT id, content_md FROM pages")
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
            print(f"Successfully seeded logo from {logo_src} to {logo_dst}")
        except Exception as e:
            print(f"Error seeding logo: {e}")

    rows = await db.execute_fetchall("SELECT COUNT(*) as cnt FROM pages")
    if rows[0]["cnt"] > 0:
        return  # Pages already exist

    # Get admin user id for created_by
    admin_rows = await db.execute_fetchall(
        "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    )
    admin_id = admin_rows[0]["id"] if admin_rows else None

    from app.services.search import rebuild_search_index

    # Seed two welcome pages so users can switch between languages.
    # English is the default (sort_order=0); Chinese is the companion (sort_order=1).
    welcome_pages = [
        ("welcome", "Welcome to JustWiki", WELCOME_PAGE_CONTENT_EN, 0),
        ("welcome-zh", "歡迎使用 JustWiki", WELCOME_PAGE_CONTENT_ZH, 1),
    ]

    for slug, title, content, sort_order in welcome_pages:
        cursor = await db.execute(
            """INSERT INTO pages (slug, title, content_md, parent_id, sort_order, created_by)
               VALUES (?, ?, ?, NULL, ?, ?)""",
            (slug, title, content, sort_order, admin_id),
        )
        page_id = cursor.lastrowid

        # Save initial version
        await db.execute(
            """INSERT INTO page_versions (page_id, title, content_md, edited_by, version_num)
               VALUES (?, ?, ?, ?, 1)""",
            (page_id, title, content, admin_id),
        )

        # Update search index
        await rebuild_search_index(db, page_id, title, content)

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
