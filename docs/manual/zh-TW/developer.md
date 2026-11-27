# 開發者指南

## 技術堆疊

| 層級 | 技術 |
|------|------|
| 後端 | Python 3.11+、FastAPI、aiosqlite、Pydantic |
| 前端 | React 19、Vite、Tailwind CSS 4、Zustand |
| 編輯器 | Milkdown（ProseMirror） |
| 資料庫 | SQLite 單一檔案（WAL 模式、FTS5 全文索引） |
| 部署 | 單一 Docker image，FastAPI 同時提供 API 與前端 |

## 本地開發

需求：Python 3.11+、Node.js 20+、[uv](https://docs.astral.sh/uv/)。

```bash
git clone https://github.com/PttCodingMan/JustWiki.git
cd JustWiki
make setup   # 安裝後端與前端依賴、建立 .env
make dev     # 後端 http://localhost:8000 + 前端 http://localhost:5173
```

開發時開 http://localhost:5173，Vite 會把 `/api` 轉給後端。

## Makefile 指令

| 指令 | 說明 |
|------|------|
| `make setup` | 首次設定（安裝依賴、建立 .env） |
| `make dev` | 同時啟動後端與前端 |
| `make dev-backend` | 只啟動後端（uvicorn --reload，port 8000） |
| `make dev-frontend` | 只啟動前端（Vite，port 5173） |
| `make build` | 建置前端 production 版本 |
| `make test` | 執行所有後端與前端測試 |
| `make test-backend` / `make test-frontend` | 只跑後端（pytest）或前端（vitest）測試 |
| `make lint` | 前端 lint |
| `make backup` | 依時間戳備份 SQLite 資料庫 |
| `make clean` | 清除資料庫、媒體檔與前端 dist |
| `make docker-up` / `make docker-down` | 啟動 / 停止 Docker Compose |

## 專案結構

```
JustWiki/
├── backend/            # FastAPI
│   ├── app/
│   │   ├── main.py     # 建立 app、middleware、掛載 router
│   │   ├── routers/    # 每個領域一個檔案：pages、search、media、acl…
│   │   ├── services/   # 搜尋索引、wikilink、ACL、通知、OIDC、LDAP…
│   │   └── seed/       # 首次啟動的歡迎頁與預設範本（Markdown）
│   ├── scripts/        # build_static_demo.py 等工具腳本
│   └── tests/
├── frontend/           # React SPA（Vite）
│   └── src/
│       ├── components/ # Editor（Milkdown）、Viewer（markdown-it）、Layout…
│       ├── pages/
│       ├── store/      # Zustand
│       └── lib/markdown.js  # 檢視端的 Markdown 管線
├── docs/
│   ├── images/         # README 與手冊用的截圖
│   └── manual/         # 這份說明文件的原始 Markdown
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## REST API

所有功能都有對應的 REST API，介面用的也是同一組。互動式 API 文件在你自己的站上：`https://你的網址/docs`。

### API 金鑰

在 **個人檔案 → API 金鑰** 建立個人金鑰（`jwk_` 開頭），可設定到期天數或永不過期。金鑰明文只在建立當下顯示一次，權限等同你本人，不用時請撤銷。viewer 帳號不能建立金鑰。

請求時放在 `Authorization` 標頭：

```bash
curl -H "Authorization: Bearer jwk_xxxxxxxx" https://wiki.example.com/api/pages/tree
```

### 常用端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/pages/tree` | 頁面樹 |
| `GET` | `/api/pages/{slug}` | 讀取頁面（含 `content_md` 與 `version`） |
| `POST` | `/api/pages` | 建立頁面：`title`、`content_md`、`parent_id`、`page_type`… |
| `PUT` | `/api/pages/{slug}` | 更新頁面 |
| `PATCH` | `/api/pages/{slug}/move` | 搬移頁面 |
| `DELETE` | `/api/pages/{slug}` | 刪除頁面（移到回收桶） |
| `GET` | `/api/search?q=關鍵字&tag=標籤` | 全文搜尋 |

### 更新頁面要帶 base_version

修改 `title` 或 `content_md` 時，必須在 body 帶上你讀到的版本號 `base_version`：

```bash
curl -X PUT https://wiki.example.com/api/pages/aB3xK9pQ \
  -H "Authorization: Bearer jwk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"content_md": "# 新內容", "base_version": 7}'
```

如果這段期間頁面已被別人改過，會回 **409**：

```json
{ "error": "base_version_stale", "your_version": 7, "current_version": 8 }
```

這時請重新讀取最新內容、合併後再送出。沒帶 `base_version` 會回 `base_version_required`。

## 這個 demo 站怎麼做的

這個網站是把真正的前端以 demo 模式建置（`VITE_DEMO=true`），再由 `backend/scripts/build_static_demo.py` 啟動一個暫時的 JustWiki、匯入 `docs/manual/` 的 Markdown、把介面會呼叫的每個讀取 API 回應存成 JSON。前端改從這些 JSON 讀資料，所以能放在 GitHub Pages 這種純靜態主機上，每次 push 到 main 都會自動更新。

要修改這份手冊，編輯 repo 裡的 `docs/manual/` 即可。
