<p align="center">
  <img src="docs/images/logo.png" alt="JustWiki Logo" width="480">
</p>

<p align="center">
  <strong>中文</strong> · <a href="README.en.md">English</a>
</p>

# JustWiki

一套輕量、自架式的小團隊 Wiki。Clone 下來、執行，就能開始寫。

## 為什麼選 JustWiki

專為「小團隊、不想碰維運」的情境設計：

- **vs Outline** — 不用 PostgreSQL、Redis、MinIO，也不用 4 CPU / 8 GB 機器；一台 1 vCPU / 512 MB VM 或樹莓派就能跑
- **vs Wiki.js** — v3 自 2021 宣布至今仍無正式版、v2 進入 maintenance；JustWiki 持續更新
- **vs BookStack** — 頁面可無限巢狀，不是 Book → Chapter → Page 三層到底
- **vs Notion / Obsidian** — 自架、資料在自己機器、完整多人協作（ACL、留言、訂閱通知），不是雲端鎖定或單機筆記

所有資料 = 一個 `data/just-wiki.db` SQLite 檔 + `media/` 目錄。備份、搬家、匯出都只是複製檔案。

## 功能特色

**編輯與內容**
- **Markdown 優先** — Milkdown 所見即所得編輯器，支援 slash commands、Mermaid 流程圖、KaTeX 數學公式、Callout 提示框
- **Wikilinks** — `[[頁面]]` 語法快速連結，自動追蹤反向連結（backlinks）
- **頁面階層與範本** — 巢狀頁面結構、常用範本一鍵套用
- **Draw.io 整合** — 內建圖表編輯器

**檢視與搜尋**
- **多種檢視模式** — 樹狀、圖譜（Graph，支援 3D 與平面切換）
- **全文搜尋** — FTS5 驅動，可選用 Gemini AI 問答
- **中文 URL** — 頁面網址保留原始中文標題，不會變成 `%E4%B8...` 一長串編碼

**協作與權限**
- **多使用者 + 群組 ACL** — 頁面層級的權限控制
- **版本歷史** — 每頁修訂紀錄與差異比對
- **留言、書籤、標籤、頁面訂閱** — 小團隊協作夠用
- **活動紀錄與垃圾桶** — 近況一目了然、刪除可救回

**匯出與部署**
- **多格式匯出** — 單頁匯出為 Markdown / HTML / PDF（瀏覽器列印），整站打包為靜態 zip
- **單一 SQLite 檔案** — 免外部資料庫，備份就是複製一個檔案
- **佈景主題** — 內建 9 款配色（[預覽](#佈景主題)）
- **Docker 部署** — 一句 `docker-compose up` 搞定

## 佈景主題

<p align="center">
  <img src="docs/images/themes.png" alt="9 款內建主題：Light、Dark、Lavender、Forest、Rose、Ocean、Sand、Sunset、Nord" width="100%">
</p>

內建 9 款精選配色 — **Light、Dark、Lavender、Forest、Rose、Ocean、Sand、Sunset、Nord**。隨時可以從右上角的主題選單切換，選擇會依瀏覽器記住。

## 部署方式

### Docker (推薦)

使用 Docker Compose 是啟動 JustWiki 最快的方式。

```bash
cp .env.example .env
# 編輯 .env — 至少要修改 SECRET_KEY 與 ADMIN_PASS
docker-compose up -d
```

開啟 http://localhost:3000 即可開始使用。

### 設定

所有設定都集中在單一 `.env` 檔案。完整選項請參考 [.env.example](.env.example)。

主要變數：

| 變數              | 說明                          | 預設值                |
| ----------------- | ----------------------------- | --------------------- |
| `SECRET_KEY`      | Session 簽章金鑰              | `change-me-...`       |
| `ADMIN_USER`      | 管理員帳號                    | `admin`               |
| `ADMIN_PASS`      | 管理員密碼                    | `admin`               |
| `DB_PATH`         | SQLite 資料庫路徑             | `./data/just-wiki.db` |
| `AI_ENABLED`      | 啟用 Gemini AI 問答           | `false`               |
| `GEMINI_API_KEY`  | Gemini API key（啟用 AI 時）  |                       |

## 使用指南

### Slash 指令

<p align="center">
  <img src="docs/images/slash-commands.png" alt="在編輯器輸入 / 即可開啟 slash 指令選單" width="80%">
</p>

在編輯器中輸入 `/` 即可開啟 slash 選單，輸入後續文字可即時篩選。

| 指令 | 說明 |
| ---- | ---- |
| `/h1` | 標題 1 — 大段落標題 |
| `/h2` | 標題 2 — 中段落標題 |
| `/h3` | 標題 3 — 小段落標題 |
| `/bullet` | 無序清單 |
| `/ordered` | 有序清單 |
| `/quote` | 引用區塊 |
| `/code` | 程式碼區塊 |
| `/hr` | 分隔線 |
| `/callout-info` | 資訊提示框（`:::info`） |
| `/callout-warning` | 警告提示框（`:::warning`） |
| `/callout-tip` | 技巧提示框（`:::tip`） |
| `/callout-danger` | 危險提示框（`:::danger`） |
| `/mermaid` | Mermaid 圖表 |
| `/math` | KaTeX 數學公式 |
| `/drawio` | Draw.io 圖表 |

---

## 開發者指南

### 技術堆疊

| 層級     | 技術                                           |
| -------- | ---------------------------------------------- |
| 後端     | Python、FastAPI、aiosqlite、Pydantic           |
| 前端     | React 19、Vite、Tailwind CSS 4、Zustand        |
| 編輯器   | Milkdown（ProseMirror）                        |
| 資料庫   | SQLite（單一檔案）                             |
| 部署     | Docker Compose                                 |

### 本地開發

1. **環境設定**: 安裝後端與前端依賴、建立 `.env`
   ```bash
   make setup
   ```
   *需求環境：Python 3.11+、Node.js 20+、[uv](https://docs.astral.sh/uv/)*

2. **啟動開發伺服器**: 同時啟動後端（port 8000）與前端（port 3000）
   ```bash
   make dev
   ```

### Makefile 指令

| 指令 | 說明 |
| ---- | ---- |
| `make dev` | 以開發模式啟動後端與前端 |
| `make dev-backend` | 只啟動後端 |
| `make dev-frontend` | 只啟動前端 |
| `make build` | 建置前端 production 版本 |
| `make backup` | 依時間戳備份 SQLite 資料庫 |
| `make clean` | 清除資料庫、媒體檔與前端 dist |
| `make docker-up` | 執行 `docker-compose up -d` |
| `make docker-down` | 執行 `docker-compose down` |
| `make setup` | 首次設定（安裝依賴、建立 .env） |

### 專案結構

```
justwiki/
├── backend/          # FastAPI REST API
│   └── app/
│       ├── main.py
│       ├── routers/  # pages, search, media, tags, versions, ...
│       └── services/ # markdown, search, AI, webhook, export
├── frontend/         # React SPA (Vite)
│   └── src/
│       ├── components/
│       │   ├── Editor/   # Milkdown 編輯器
│       │   ├── Viewer/   # Markdown 渲染器
│       │   ├── Search/   # 搜尋 + AI 問答
│       │   └── Layout/   # Sidebar、Navbar
│       ├── pages/
│       ├── hooks/
│       └── store/        # Zustand
├── data/             # 執行期資料（SQLite、媒體檔）
├── docker-compose.yml
├── Makefile
└── .env.example
```

## 授權

本專案以 [MIT License](LICENSE) 授權釋出。
