# JustWiki

> A lightweight, self-hosted wiki for small teams. Just clone, run, and write.

## 設計哲學

- **Just works** — `docker-compose up` 或兩行指令就跑起來，不需要設定 Nginx、Redis、PostgreSQL
- **前後端分離** — Backend 是獨立的 REST API，Frontend 是獨立的 SPA，各自有完整的開發 / build / 部署流程
- **一個 SQLite 檔就是全部** — 備份 = 複製檔案，搬遷 = 複製資料夾，沒有外部依賴
- **開發者友善** — Markdown first、API first、keyboard-first、config 用 `.env` 一個檔搞定

---

## Repo 結構

```
just-wiki/
├── backend/                    # Python — FastAPI REST API
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI entry, CORS, lifespan
│   │   ├── config.py           # pydantic-settings, 讀 .env
│   │   ├── database.py         # aiosqlite 連線 + migration
│   │   ├── auth.py             # session / JWT / API token middleware
│   │   ├── routers/
│   │   │   ├── pages.py        # CRUD + slug + hierarchy
│   │   │   ├── media.py        # 圖片上傳 / 取得
│   │   │   ├── search.py       # FTS5 + AI 問答
│   │   │   ├── diagrams.py     # Draw.io XML CRUD
│   │   │   ├── tags.py         # 標籤 CRUD
│   │   │   ├── versions.py     # 版本歷史 + diff
│   │   │   ├── users.py        # 使用者管理
│   │   │   ├── templates.py    # 頁面模板 CRUD
│   │   │   ├── comments.py     # 頁面討論
│   │   │   ├── bookmarks.py    # 個人書籤
│   │   │   ├── webhooks.py     # Webhook 管理 + 觸發
│   │   │   ├── import_export.py # 匯入匯出 + 備份還原
│   │   │   └── activity.py     # Recent changes + view count
│   │   ├── services/
│   │   │   ├── markdown.py     # [[wikilink]], ![[transclusion]] 解析
│   │   │   ├── search.py       # FTS5 全文搜尋
│   │   │   ├── ai.py           # Gemini provider + ChromaDB
│   │   │   ├── webhook.py      # Webhook dispatcher (Slack/Discord/Line)
│   │   │   └── export.py       # PDF / HTML 匯出
│   │   └── schemas.py          # Pydantic request/response models
│   ├── requirements.txt
│   ├── Dockerfile
│   └── README.md
│
├── frontend/                   # React — Vite SPA
│   ├── src/
│   │   ├── api/                # axios instance, API client
│   │   ├── components/
│   │   │   ├── Editor/         # Milkdown 編輯器 + slash commands + 自訂 plugins
│   │   │   ├── Viewer/         # Markdown 渲染 + Mermaid + KaTeX + callout
│   │   │   ├── DrawIO/         # Draw.io iframe embed
│   │   │   ├── Search/         # 搜尋 + AI 問答
│   │   │   ├── Diff/           # 版本差異
│   │   │   ├── Graph/          # 知識圖譜 (D3 force-graph)
│   │   │   ├── Comments/       # 頁面討論
│   │   │   └── Layout/         # Sidebar (tree nav), Navbar, Shell
│   │   ├── pages/
│   │   ├── hooks/
│   │   │   └── useKeyboard.js  # 全域快捷鍵管理
│   │   ├── store/              # Zustand
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   │   ├── manifest.json       # PWA manifest
│   │   └── sw.js               # Service Worker
│   ├── package.json
│   ├── vite.config.js
│   ├── Dockerfile
│   └── README.md
│
├── cli/                        # Python CLI tool (Phase 7)
│   ├── just_wiki_cli.py        # `jw add "quick note"`
│   └── setup.py
│
├── data/                       # Runtime data (gitignored)
│   ├── just-wiki.db
│   ├── media/
│   └── chromadb/
│
├── .env.example
├── docker-compose.yml          # Production
├── docker-compose.dev.yml      # 開發用（Vite HMR）
├── Makefile
└── README.md
```

---

## 設定：一個 `.env` 搞定

```bash
# .env
# ── 基本 ──
SECRET_KEY=change-me-to-random-string
ADMIN_USER=admin
ADMIN_PASS=admin

# ── 路徑 ──
DATA_DIR=./data
DB_PATH=./data/just-wiki.db
MEDIA_DIR=./data/media

# ── CORS ──
ALLOWED_ORIGINS=http://localhost:3000

# ── Frontend ──
VITE_API_URL=http://localhost:8000

# ── AI (Phase 5, 可選) ──
GEMINI_API_KEY=
AI_ENABLED=false

# ── Webhook (Phase 7, 可選) ──
WEBHOOK_URLS=
```

---

## 啟動方式

```bash
# ── 方法 1：Docker (推薦部署) ──
cp .env.example .env
docker-compose up -d

# ── 方法 2：本地開發 ──
# Terminal 1 — Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev

# ── 方法 3：Makefile ──
make dev        # 同時啟動前後端
make build      # build frontend + 打包
make backup     # 備份 data/
```

### docker-compose.yml（Production — frontend build 成靜態檔由 nginx serve）

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    env_file: .env
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped
```

### docker-compose.dev.yml（開發用 — Vite dev server + HMR）

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./backend/app:/app/app
    env_file: .env

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - ./frontend/src:/app/src
    environment:
      - VITE_API_URL=http://localhost:8000
    depends_on:
      - backend
```

---

## 技術選型

| 層級     | 選擇                     | 理由                                        |
|----------|--------------------------|---------------------------------------------|
| 後端     | FastAPI + Python 3.11+   | async 原生、自動 API docs（/docs）、型別安全  |
| 資料庫   | SQLite + aiosqlite       | 零配置、單檔備份、三人規模綽綽有餘            |
| 中文搜尋 | FTS5 (unicode61)         | 不需外部服務、零依賴、SQLite 內建              |
| AI 問答  | Gemini API (免費額度)     | text-embedding-004 + gemini-2.0-flash       |
| 前端     | React 18 + Vite          | 生態成熟、HMR 快、PWA 支援好                 |
| 編輯器   | Milkdown (ProseMirror)    | Markdown-native、plugin 架構、官方 slash command |
| 樣式     | Tailwind CSS             | utility-first、dark mode 原生               |
| 圖表     | Mermaid.js               | Markdown 內嵌、零額外工具                    |
| 數學公式 | KaTeX                    | 比 MathJax 快、Markdown plugin 整合容易      |
| 知識圖譜 | D3 force-graph           | 輕量、互動性好、不需額外 server              |

---

## DB Schema

```sql
-- ============================================================
-- 使用者與認證
-- ============================================================

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'editor',  -- admin | editor | viewer
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API Token (每人可有多組)
CREATE TABLE api_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                      -- "CI/CD", "CLI" 等標記用途
    token_hash  TEXT UNIQUE NOT NULL,
    last_used   TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 個人書籤
CREATE TABLE bookmarks (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id    INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, page_id)
);

-- ============================================================
-- 頁面系統
-- ============================================================

CREATE TABLE pages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL DEFAULT '',
    parent_id   INTEGER REFERENCES pages(id) ON DELETE SET NULL,  -- 樹狀結構
    sort_order  INTEGER DEFAULT 0,                                -- 同層排序
    view_count  INTEGER DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pages_parent ON pages(parent_id);

-- 版本歷史
CREATE TABLE page_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content_md  TEXT NOT NULL,
    edited_by   INTEGER REFERENCES users(id),
    edited_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version_num INTEGER NOT NULL
);

-- 頁面模板
CREATE TABLE templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,               -- "會議記錄", "ADR", "Troubleshooting"
    description TEXT DEFAULT '',
    content_md  TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 頁面討論
CREATE TABLE comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 分類與連結
-- ============================================================

CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE page_tags (
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (page_id, tag_id)
);

CREATE TABLE backlinks (
    source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    PRIMARY KEY (source_page_id, target_page_id)
);

-- ============================================================
-- 媒體與圖表
-- ============================================================

CREATE TABLE media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    filepath      TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size_bytes    INTEGER,
    uploaded_by   INTEGER REFERENCES users(id),
    uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE diagrams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id    INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    xml_data   TEXT NOT NULL,
    svg_cache  TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 搜尋
-- ============================================================

CREATE VIRTUAL TABLE search_index USING fts5(
    page_id, title, content_segmented,
    tokenize='unicode61'
);

-- ============================================================
-- 系統
-- ============================================================

-- Webhook 設定
CREATE TABLE webhooks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    events     TEXT NOT NULL DEFAULT 'page.updated',
    is_active  INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 活動紀錄 (Recent Changes)
CREATE TABLE activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   INTEGER NOT NULL,
    metadata    TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_created ON activity_log(id DESC, created_at DESC);
```

---

## API 設計

所有 API 都在 `/api` prefix 下。Backend 自帶 Swagger UI（`/docs`）。
認證支援兩種：session cookie（前端用）、`Authorization: Bearer <api_token>`（CLI / CI 用）。

```
Auth
  POST   /api/auth/login
  POST   /api/auth/logout
  GET    /api/auth/me

API Tokens
  GET    /api/tokens
  POST   /api/tokens                            # 回傳一次明文
  DELETE /api/tokens/{id}

Pages
  GET    /api/pages                             # ?page=1&per_page=20&tag=x&parent_id=x
  POST   /api/pages                             # 可指定 template_id, parent_id
  GET    /api/pages/{slug}                      # 自動 +1 view_count
  PUT    /api/pages/{slug}
  DELETE /api/pages/{slug}
  GET    /api/pages/{slug}/backlinks
  GET    /api/pages/{slug}/children
  PATCH  /api/pages/{slug}/move                 # 改 parent_id / sort_order
  GET    /api/pages/tree                        # sidebar 用
  GET    /api/pages/graph                       # graph view 用

Versions
  GET    /api/pages/{slug}/versions
  GET    /api/pages/{slug}/versions/{num}
  GET    /api/pages/{slug}/diff?v1=3&v2=5
  POST   /api/pages/{slug}/revert/{num}

Tags
  GET    /api/tags
  POST   /api/pages/{slug}/tags
  DELETE /api/pages/{slug}/tags/{tag}

Media
  POST   /api/media/upload
  GET    /api/media/{filename}

Diagrams
  POST   /api/diagrams
  PUT    /api/diagrams/{id}
  GET    /api/diagrams/{id}
  GET    /api/diagrams/{id}/svg

Templates
  GET    /api/templates
  POST   /api/templates
  PUT    /api/templates/{id}
  DELETE /api/templates/{id}

Comments
  GET    /api/pages/{slug}/comments
  POST   /api/pages/{slug}/comments
  PUT    /api/comments/{id}
  DELETE /api/comments/{id}

Bookmarks
  GET    /api/bookmarks
  POST   /api/bookmarks/{slug}
  DELETE /api/bookmarks/{slug}

Activity
  GET    /api/activity                          # ?page=1&per_page=50
  GET    /api/activity/stats                    # 瀏覽排行、孤兒頁面等

Search
  GET    /api/search?q=...&tag=...

AI (可選)
  POST   /api/ai/ask
  GET    /api/ai/status

Webhooks
  GET    /api/webhooks
  POST   /api/webhooks
  PUT    /api/webhooks/{id}
  DELETE /api/webhooks/{id}
  POST   /api/webhooks/{id}/test

Import / Export / Backup
  GET    /api/backup
  POST   /api/restore
  POST   /api/import/markdown                   # 批次匯入 .zip (.md files)
  GET    /api/export/page/{slug}?format=pdf
  GET    /api/export/site?format=html
```

---

## 開發階段

### Phase 1 — 能用（6 天）

做完就是一個有模板、有快捷鍵的現代 Markdown wiki。

**Backend**
- [ ] FastAPI 初始化 + config (.env) + CORS
- [ ] SQLite 連線 + auto migration (啟動時建表)
- [ ] 簡易 auth：session-based, bcrypt, 首次啟動自動建 admin
- [ ] Users 基本管理：admin 可新增 / 停用使用者、指定角色（admin / editor / viewer）
- [ ] Pages CRUD + 自動 slug 生成（中文標題 → pypinyin，英文 → slugify）
- [ ] Media upload / serve
- [ ] Templates CRUD + 建立頁面時可選 template_id
- [ ] 內建預設模板：會議記錄、技術文件、Troubleshooting、ADR

**Frontend**
- [ ] Vite + React + Tailwind（`darkMode: 'class'`）+ React Router
- [ ] API client（axios, baseURL 讀 env）
- [ ] 登入頁
- [ ] 頁面列表（首頁）+ sidebar 導覽
- [ ] Milkdown 編輯器整合（commonmark + gfm + listener + clipboard）
- [ ] Slash commands — 打 `/` 跳出指令選單
- [ ] Callout blocks — `:::info` `:::warning` `:::tip` `:::danger`
- [ ] Ctrl+V 圖片貼上 → upload → 插入 `![](url)`
- [ ] Markdown viewer
- [ ] Keyboard shortcuts — `Ctrl+K` 搜尋、`Ctrl+N` 新頁面、`Ctrl+E` 編輯/瀏覽、`Ctrl+S` 儲存
- [ ] 新增頁面時的模板選擇 UI

**驗收標準**
```
啟動 → 登入 → 選模板建頁面 → 打 / 插入元件 → 貼圖 → Ctrl+S 儲存 → 瀏覽 ✓
cp data/just-wiki.db somewhere/   ← 完整備份 ✓
```

---

### Phase 2 — 找得到（5 天）

搜尋、標籤、加上讓團隊感知彼此動態的功能。

**Backend**
- [ ] FTS5 search_index 維護（頁面 CRUD 時同步更新）
- [ ] `GET /api/search?q=...` 全文搜尋 + snippet 高亮
- [ ] Tags CRUD + 搜尋支援 tag 過濾
- [ ] Activity log — 頁面 CRUD 時自動寫入 activity_log
- [ ] `GET /api/activity` — Recent changes（分頁）
- [ ] `GET /api/activity/stats` — 瀏覽排行、最近活躍、孤兒頁面
- [ ] 頁面讀取時 view_count + 1（用 `UPDATE SET view_count = view_count + 1` atomic 更新）
- [ ] Bookmarks CRUD

**Frontend**
- [ ] 搜尋列（`Ctrl+K` + command palette 風格）
- [ ] 搜尋結果頁 + 關鍵字高亮
- [ ] Tag 顯示 + 管理 + 篩選
- [ ] Recent changes 頁面 — 時間軸呈現誰改了什麼
- [ ] 書籤 — 頁面星號 toggle + sidebar 書籤區
- [ ] Sidebar 加入「最近更新」「熱門頁面」區塊

---

### Phase 3 — 有歷史 + 有結構（5 天）

版本控制、頁面階層、知識網絡。

**Backend**
- [ ] 更新頁面時自動建 page_versions
- [ ] 版本列表 / 特定版本 / diff (difflib) / 還原
- [ ] `[[slug]]` / `[[slug|顯示文字]]` 解析 → backlinks 表
- [ ] `![[slug]]` page transclusion — 解析時展開目標頁面
- [ ] `GET /api/pages/{slug}/backlinks`
- [ ] Page hierarchy — parent_id + sort_order
- [ ] `GET /api/pages/tree` — 完整樹狀結構
- [ ] `GET /api/pages/{slug}/children`
- [ ] `PATCH /api/pages/{slug}/move`
- [ ] `GET /api/pages/graph` — 全站節點 + backlink 邊

**Frontend**
- [ ] 版本歷史時間軸
- [ ] Side-by-side diff viewer
- [ ] 還原確認 UI
- [ ] `[[wikilink]]` 渲染成連結
- [ ] `![[transclusion]]` 行內展開，帶來源連結
- [ ] 編輯器 `[[` 自動完成
- [ ] 頁面底部 backlinks 區塊
- [ ] Sidebar 改為樹狀導覽（展開/收合、拖曳排序）
- [ ] Graph view — D3 force-graph，點擊跳轉

---

### Phase 4 — 畫得出（5 天）

Draw.io、Mermaid、KaTeX。

**Backend**
- [ ] Diagrams CRUD (XML 存 SQLite)
- [ ] SVG cache 生成 / 更新
- [ ] `::drawio[diagram-id]` directive

**Frontend**
- [ ] Draw.io iframe embed (PostMessage API)
- [ ] 新建 / 編輯 Draw.io 圖表
- [ ] `::drawio[id]` → SVG 渲染
- [ ] Mermaid.js ` ```mermaid ` 自動渲染
- [ ] KaTeX `$inline$` 和 `$$block$$` 數學公式
- [ ] Slash command 加入 `/mermaid`、`/drawio`、`/math`

---

### Phase 5 — 問得到（4 天）

AI 完全可選，不設 GEMINI_API_KEY 就不啟用。

**Backend**
- [ ] AIProvider 抽象 + GeminiProvider
- [ ] text-embedding-004 → ChromaDB
- [ ] 頁面儲存自動 chunking + embedding
- [ ] `POST /api/ai/ask` — RAG + SSE 串流
- [ ] `GET /api/ai/status`

**Frontend**
- [ ] AI 問答側邊面板
- [ ] 串流回應 + 引用來源連結
- [ ] 搜尋結果上方 AI 摘要

**Embedding 流程**
```
page.content_md
  → 按 ## heading 分段 (< 500 tokens)
  → Gemini text-embedding-004
  → ChromaDB

query → embedding → top-k → context → Gemini Flash → SSE
```

---

### Phase 6 — 收尾 + 協作（4 天）

**Backend**
- [ ] `GET /api/backup` — .zip 打包
- [ ] `POST /api/restore` — .zip 還原
- [ ] 單頁匯出 PDF / HTML
- [ ] 整站靜態 HTML 匯出
- [ ] Comments CRUD + activity_log 整合

**Frontend**
- [ ] 匯出選單（PDF / HTML）
- [ ] 管理頁：備份 / 還原
- [ ] 頁面討論區塊（Markdown comment thread）
- [ ] Dark mode toggle
- [ ] RWD 收尾

---

### Phase 7 — 開發者工具（4 天）

**Backend**
- [ ] API Token — CRUD、sha256 hash、建立時回傳一次明文
- [ ] auth middleware 同時支援 session + Bearer token
- [ ] Webhooks — CRUD + test endpoint
- [ ] Webhook dispatcher：偵測 Slack/Discord/Line 格式自動適配
- [ ] Markdown 批次匯入 — `POST /api/import/markdown`（.zip 內含 .md）
- [ ] 匯入自動解析 frontmatter（title, tags）和 `[[wikilink]]`

**Frontend**
- [ ] 設定頁：API Token 管理
- [ ] 設定頁：Webhook 管理 + 測試
- [ ] Markdown 匯入 UI（拖曳上傳）
- [ ] PWA — manifest.json + service worker
- [ ] About 頁：版本、系統狀態

**CLI**
- [ ] `jw` 命令列工具（click + httpx + rich）
- [ ] `jw config` — 設定 API URL + token
- [ ] `jw add "標題"` — 快速建立頁面（支援 --content / --file）
- [ ] `jw search "關鍵字"`
- [ ] `jw list` — 最近頁面
- [ ] `jw backup -o backup.zip`

---

## 時程

| Phase | 內容               | 天數 | 累計 | 可用狀態                          |
|-------|--------------------|------|------|-----------------------------------|
| 1     | 能用               | 6    | 6    | wiki + 模板 + slash + 快捷鍵 ✓    |
| 2     | 找得到             | 5    | 11   | + 搜尋 / 標籤 / 動態 / 書籤 ✓    |
| 3     | 有歷史 + 有結構    | 5    | 16   | + 版本 / 階層 / graph / 嵌入 ✓   |
| 4     | 畫得出             | 5    | 21   | + Draw.io / Mermaid / KaTeX ✓     |
| 5     | 問得到             | 4    | 25   | + AI 問答 ✓                       |
| 6     | 收尾 + 協作        | 4    | 29   | + 匯出 / 討論 / dark mode ✓      |
| 7     | 開發者工具         | 4    | 33   | + API token / webhook / CLI / PWA ✓|

約 33 個工作天（7 週），每個 Phase 結束都是完整可用的版本。

---

## 功能總覽

### 編輯體驗
- [P1] Milkdown WYSIWYG 編輯器
- [P1] Slash commands（`/` 指令選單）
- [P1] Callout blocks（`:::info` `:::warning` `:::tip` `:::danger`）
- [P1] Ctrl+V 圖片貼上
- [P1] 頁面模板（會議記錄、技術文件、ADR、Troubleshooting）
- [P1] Keyboard-first（`Ctrl+K/N/E/S`）

### 知識結構
- [P2] 標籤系統
- [P2] 書籤 / 釘選
- [P3] 雙向連結 `[[wikilink]]`
- [P3] 頁面嵌入 `![[transclusion]]`
- [P3] 頁面階層（樹狀結構 + sidebar 導覽）
- [P3] Graph view（知識圖譜視覺化）

### 搜尋與 AI
- [P2] 全文搜尋（FTS5 unicode61）
- [P5] AI RAG 問答（Gemini，可選）

### 視覺化
- [P4] Draw.io 圖表嵌入
- [P4] Mermaid 圖表
- [P4] KaTeX 數學公式

### 協作
- [P2] Recent changes feed
- [P2] 瀏覽次數統計
- [P6] 頁面討論 (comments)
- [P7] Webhook 通知（Slack / Discord / Line）

### 開發者工具
- [P7] API Token 認證
- [P7] CLI 快速筆記（`jw add`）
- [P7] Markdown 批次匯入
- [P7] PWA

### 系統
- [P1] 一個 `.env` 全域設定
- [P1] SQLite 單檔資料
- [P6] 備份 / 還原（.zip）
- [P6] 匯出（PDF / HTML / 整站靜態）

---

## 備份與搬遷

```bash
# 備份
cp data/just-wiki.db backup/
cp -r data/media backup/

# 或用 API / CLI
curl -o backup.zip http://localhost:8000/api/backup
jw backup -o backup.zip

# 搬遷
scp -r data/ newserver:/path/to/just-wiki/data/

# 還原
curl -X POST -F "file=@backup.zip" http://localhost:8000/api/restore
```

---

## Dependencies

### Backend

```
fastapi>=0.115
uvicorn[standard]>=0.30
aiosqlite>=0.20
pydantic>=2.7
pydantic-settings>=2.3
python-multipart>=0.0.9
bcrypt>=4.1
PyJWT[crypto]>=2.8
pypinyin>=0.51
httpx>=0.27
chromadb>=0.5              # Phase 5
google-genai>=1.0          # Phase 5
weasyprint>=62             # Phase 6
```

### Frontend

```json
{
  "dependencies": {
    "react": "^18.3",
    "react-dom": "^18.3",
    "react-router-dom": "^6",
    "axios": "^1.7",
    "zustand": "^4.5",
    "@milkdown/core": "7.6.2",
    "@milkdown/ctx": "7.6.2",
    "@milkdown/preset-commonmark": "7.6.2",
    "@milkdown/preset-gfm": "7.6.2",
    "@milkdown/plugin-listener": "7.6.2",
    "@milkdown/plugin-clipboard": "7.6.2",
    "@milkdown/plugin-slash": "7.6.2",
    "@milkdown/plugin-tooltip": "7.6.2",
    "@milkdown/react": "7.6.2",
    "@milkdown/theme-nord": "7.6.2",
    "mermaid": "^10.9",
    "katex": "^0.16",
    "d3": "^7",
    "react-diff-viewer-continued": "^3.4",
    "tailwindcss": "^3.4"
  }
}
```

### CLI

```
click>=8.1
httpx>=0.27
rich>=13.7
```