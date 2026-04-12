# Public Read-Only Pages — 實作 to-do

## 目標

讓個別 wiki 頁面可以被標記為「公開唯讀」，匿名訪客不需登入即可瀏覽指定頁面，並能在公開畫面切換主題。其他所有功能（編輯、刪除、評論、tags、書籤、watch 等）維持目前的登入要求。

---

## 設計決策（13 題定案）

| # | 題目 | 決定 |
|---|---|---|
| Q1 | Wikilink 洗滌策略 | **不洗滌**。`PrivateRoute` 已提供內容層防護，洗滌只能擋到 slug 本身，display text 不管有沒有洗都會洩漏 |
| Q2 | 公開頁 transclusion (`![[...]]`) | **整個關掉**。顯示 placeholder |
| Q3 | Draw.io | **完整支援**。SVG 透過 public response 一次 inline 送出，`publicMode` 下從 prop 讀取 |
| Q4 | 誰能切換 `is_public` | 任何已登入使用者（跟 edit 權限一致） |
| Q5 | Rate limit `/api/public/*` | 做。In-memory limiter，抄 `auth_router.py:14-29` 風格 |
| Q6 | `initTheme()` 位置 | 搬到 `App.jsx` 最外層 `useEffect` |
| Q7 | Tags 在公開頁 | 不顯示（API 根本不回傳） |
| Q8 | HTML 註解 | 公開端點 regex strip。Raw HTML blocks 保留（作者責任） |
| Q9 | Referrer-Policy | `<meta name="referrer" content="same-origin">` |
| Q10 | `view_count` | 公開路由完全不動 view_count，也不加新欄位 |
| Q11 | 搜尋引擎索引 | 預設 `<meta name="robots" content="noindex, nofollow">` |
| Q12 | Toggle UX | Make public 要 confirmation（簡化、無教育文字）；Make private 直接切 + toast；is_public 時永久徽章；PageEdit 警示條 |
| Q13 | Public wikilink 屬性 | 加 `rel="nofollow"` 擋爬蟲 crawl budget |

---

## Phase 1：後端

### 1.1 資料庫 Schema / Migration

- [ ] `backend/app/database.py::SCHEMA_SQL`：`pages` 表加欄位
  ```sql
  is_public INTEGER NOT NULL DEFAULT 0
  ```
- [ ] `init_db()` 的 migration 區塊加 `ALTER TABLE` 檢查（跟現有 `version` / `deleted_at` 風格一致）：
  ```python
  if "is_public" not in page_col_names:
      await db.execute("ALTER TABLE pages ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
  ```
- [ ] 可選：partial index 減少表掃描
  ```sql
  CREATE INDEX IF NOT EXISTS idx_pages_public ON pages(slug) WHERE is_public = 1
  ```

### 1.2 Schemas

- [ ] `backend/app/schemas.py::PageUpdate` 加 `is_public: Optional[bool] = None`
- [ ] `backend/app/schemas.py::PageResponse` 加 `is_public: bool = False`
- [ ] 新 schema `PublicPageResponse`：
  ```python
  class PublicPageResponse(BaseModel):
      slug: str
      title: str
      content_md: str
      updated_at: datetime
      author_name: Optional[str] = None
      diagrams: dict[str, str] = {}  # {diagram_id: svg_content}
  ```

### 1.3 現有 Pages Router 修改

- [ ] `backend/app/routers/pages.py::update_page`：
  - [ ] 接受 `body.is_public`，寫入 DB
  - [ ] 若值與 current 不同，呼叫 `log_activity(..., "made_public" / "made_private", "page", ...)`
  - [ ] **不**加額外權限檢查（登入即可，跟現有 edit 一致）
  - [ ] **不**因為 `is_public` 變更而 bump `version`（它是 metadata 不是 content，避免 optimistic lock 誤判）
- [ ] `backend/app/routers/pages.py::get_page`：回傳 `is_public` 欄位（前端 PageView 需要它決定是否顯示徽章）

### 1.4 新 Public Router

- [ ] 新檔 `backend/app/routers/public.py`
- [ ] `backend/app/main.py` 匯入並 `app.include_router(public.router)`

**完整檔案草稿**：

```python
"""Public read-only page access.

No authentication required. Rate-limited by IP.
Strips HTML comments, inlines drawio SVGs, does not touch view_count.
"""
import re
import time
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request

from app.database import get_db

router = APIRouter(prefix="/api/public", tags=["public"])

_HTML_COMMENT_RE = re.compile(r'<!--[\s\S]*?-->')
# Matches both ::drawio[123] and Milkdown-escaped ::drawio\[123\]
_DRAWIO_ID_RE = re.compile(r'::drawio\\?\[(\d+)\\?\]')

# In-memory rate limit: 60 requests per IP per 60 seconds
_access_log: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 60
_RATE_LIMIT_WINDOW = 60  # seconds


def _check_rate_limit(ip: str):
    now = time.monotonic()
    log = _access_log[ip]
    _access_log[ip] = [t for t in log if now - t < _RATE_LIMIT_WINDOW]
    if len(_access_log[ip]) >= _RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many requests")
    _access_log[ip].append(now)


@router.get("/pages/{slug}")
async def get_public_page(slug: str, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT p.slug, p.title, p.content_md, p.updated_at,
                  CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                       THEN u.display_name ELSE u.username END AS author_name
           FROM pages p
           LEFT JOIN users u ON u.id = p.created_by
           WHERE p.slug = ? AND p.is_public = 1 AND p.deleted_at IS NULL""",
        (slug,),
    )
    if not rows:
        # Identical response for "not found" vs "exists but not public"
        # to prevent slug enumeration
        raise HTTPException(status_code=404, detail="Not found")

    page = dict(rows[0])

    # Strip HTML comments from source (Q8)
    page["content_md"] = _HTML_COMMENT_RE.sub('', page["content_md"])

    # Inline drawio SVGs (Q3)
    ids = set(_DRAWIO_ID_RE.findall(page["content_md"]))
    diagrams: dict[str, str] = {}
    if ids:
        placeholders = ",".join("?" * len(ids))
        diag_rows = await db.execute_fetchall(
            f"SELECT id, svg_cache FROM diagrams WHERE id IN ({placeholders})",
            list(ids),
        )
        diagrams = {
            str(r["id"]): r["svg_cache"] for r in diag_rows if r["svg_cache"]
        }
    page["diagrams"] = diagrams

    # Note: intentionally does NOT update view_count (Q10)
    return page
```

- [ ] Rate limiter 變數放 module level（避免每個 request 重建）
- [ ] 404 訊息與 status 對「不存在」和「非公開」完全一致（防 slug enumeration）

### 1.5 後端測試

新檔 `backend/tests/test_public_page.py`：

- [ ] 未被設為公開的頁面 → 404
- [ ] 公開頁面 → 200，回傳欄位正確（slug / title / content_md / updated_at / author_name / diagrams）
- [ ] 已 soft-delete 的公開頁 → 404
- [ ] 不存在的 slug 與「存在但非公開」的 slug → status 與 body 完全一致
- [ ] 含 `<!-- secret -->` → response `content_md` 不含 `secret`
- [ ] 含 `::drawio[42]` 且該 diagram 有 svg_cache → `diagrams["42"]` 含 SVG
- [ ] 含 `::drawio[42]` 但該 diagram svg_cache 為 None → `diagrams` 不含該 key
- [ ] 不含 drawio → `diagrams == {}`
- [ ] 未登入 PUT `/api/pages/{slug}` body 帶 `is_public` → 401
- [ ] 登入 PUT `is_public: true` → 200，activity_log 有 `made_public` entry
- [ ] 登入 PUT `is_public: false` → 200，activity_log 有 `made_private` entry
- [ ] `is_public` 變更不 bump `version`
- [ ] Rate limit：連續打 61 次 → 第 61 次 429（用 `monkeypatch` 縮小 window 或直接操作 `_access_log`）
- [ ] View count 不變：記下 view_count → 打公開端點 N 次 → view_count 維持不變

---

## Phase 2：前端

### 2.1 Public Axios Instance

- [ ] 新檔 `frontend/src/api/publicClient.js`
  ```javascript
  import axios from 'axios'

  const publicApi = axios.create({
    baseURL: '/api/public',
    withCredentials: false,
  })

  // No 401 interceptor — anonymous visitors should not be redirected to /login

  export default publicApi
  ```

### 2.2 Theme Init 搬家（Q6）

- [ ] `frontend/src/components/Layout/Layout.jsx`：移除 `initTheme()` 呼叫（目前在 line 117 的 useEffect）
- [ ] `frontend/src/App.jsx`：在最外層 `useEffect` 加入
  ```javascript
  const { checkAuth } = useAuth()
  const initTheme = useTheme((s) => s.init)

  useEffect(() => {
    checkAuth()
    initTheme()
  }, [])
  ```
- [ ] 驗證 `/login` 頁面也套到使用者的主題偏好（順便修掉的小 bug）
- [ ] 跑 `useTheme.test.js` / `Layout` 相關測試確認沒 regression

### 2.3 ThemeSwitcher 元件

- [ ] 檢查 `Layout.jsx` 的主題切換 UI 是否可抽出
- [ ] 新檔（或重構）`frontend/src/components/ThemeSwitcher.jsx`：
  - 下拉或 button group
  - 顯示所有主題（來自 `useTheme.themes`）
  - 點選立即 `setTheme(id)`
- [ ] `Layout.jsx` 改用新元件
- [ ] `PublicPageView.jsx` 也用

### 2.4 PublicPageView 元件

- [ ] 新檔 `frontend/src/pages/PublicPageView.jsx`

結構要點：

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import publicApi from '../api/publicClient'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import ThemeSwitcher from '../components/ThemeSwitcher'

export default function PublicPageView() {
  const { slug } = useParams()
  const [page, setPage] = useState(null)
  const [notFound, setNotFound] = useState(false)

  // Inject meta tags: noindex + same-origin referrer
  useEffect(() => {
    const metas = [
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'same-origin' },
    ]
    const elements = metas.map(({ name, content }) => {
      const el = document.createElement('meta')
      el.name = name
      el.content = content
      document.head.appendChild(el)
      return el
    })
    return () => elements.forEach((el) => document.head.removeChild(el))
  }, [])

  useEffect(() => {
    setNotFound(false)
    setPage(null)
    publicApi
      .get(`/pages/${slug}`)
      .then((res) => setPage(res.data))
      .catch(() => setNotFound(true))
  }, [slug])

  if (notFound) return <PublicNotFound />
  if (!page) return <div className="p-8 text-text-secondary">Loading...</div>

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="flex justify-between items-center px-6 py-3 border-b border-border">
        <div className="text-sm text-text-secondary">JustWiki</div>
        <ThemeSwitcher />
      </header>
      <main className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-2">{page.title}</h1>
        <div className="text-sm text-text-secondary mb-6">
          {page.author_name && <>{page.author_name} &middot; </>}
          Updated {new Date(page.updated_at).toLocaleString()}
        </div>
        <article className="bg-surface rounded-xl shadow-sm border border-border p-8">
          <MarkdownViewer
            content={page.content_md}
            publicMode
            diagrams={page.diagrams}
          />
        </article>
      </main>
      <footer className="text-center text-xs text-text-secondary py-4">
        Powered by JustWiki
      </footer>
    </div>
  )
}

function PublicNotFound() {
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-text-secondary">This page is not available.</p>
    </div>
  )
}
```

- [ ] **不要**有：sidebar、comments、tags、backlinks、bookmark、watch、edit 按鈕、FAB、搜尋
- [ ] 404 也要是一個沒 sidebar 的乾淨畫面

### 2.5 MarkdownViewer `publicMode` Prop

- [ ] `frontend/src/components/Viewer/MarkdownViewer.jsx` 簽名擴充：
  ```javascript
  export default function MarkdownViewer({
    content,
    onDiagramClick,
    publicMode = false,
    diagrams = {},
  }) { ... }
  ```

- [ ] **Transclude useEffect**（目前 line 88-101）— `publicMode` 下不 fetch：
  ```javascript
  useEffect(() => {
    if (!containerRef.current) return
    const elements = containerRef.current.querySelectorAll('[data-transclude]')
    if (publicMode) {
      elements.forEach((el) => {
        el.innerHTML = '<em class="text-text-secondary">(transclusion disabled on public pages)</em>'
      })
      return
    }
    elements.forEach(async (el) => {
      const slug = el.dataset.transclude
      try {
        const res = await api.get(`/pages/${slug}`)
        el.innerHTML = DOMPurify.sanitize(renderMarkdown(res.data.content_md || ''))
      } catch {
        el.innerHTML = '<em class="text-gray-400">Page not found</em>'
      }
    })
  }, [html, publicMode])
  ```

- [ ] **Drawio useEffect**（目前 line 127-146）— `publicMode` 下從 prop 讀：
  ```javascript
  useEffect(() => {
    if (!containerRef.current) return
    const blocks = containerRef.current.querySelectorAll('[data-diagram-id]')
    if (publicMode) {
      blocks.forEach((el) => {
        const id = el.dataset.diagramId
        const svg = diagrams[id]
        if (svg) {
          const safeSvg = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
          el.innerHTML = `<div class="drawio-svg">${safeSvg}</div>`
        } else {
          el.innerHTML = `<div class="drawio-placeholder">Diagram #${id} unavailable</div>`
        }
      })
      return
    }
    // ... existing fetch-based logic
  }, [html, publicMode, diagrams])
  ```

- [ ] **Wikilink `rel="nofollow"`**（Q13）— 在 HTML 注入後的新 useEffect：
  ```javascript
  useEffect(() => {
    if (!publicMode || !containerRef.current) return
    containerRef.current.querySelectorAll('a.wikilink').forEach((a) => {
      a.setAttribute('rel', 'nofollow')
    })
  }, [html, publicMode])
  ```

### 2.6 App Router

- [ ] `frontend/src/App.jsx`：把公開路由提到 `PrivateRoute` 外層
  ```jsx
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/public/page/:slug" element={<PublicPageView />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              {/* existing nested routes */}
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
  ```

### 2.7 PageView — 徽章 + Toggle UX（Q12）

- [ ] `frontend/src/pages/PageView.jsx`：
  - [ ] `page.is_public === true` 時，在標題旁顯示 `🌐 Public` 徽章
  - [ ] 點徽章開 dropdown menu：
    - 「複製公開連結」：`navigator.clipboard.writeText(\`${window.location.origin}/public/page/${slug}\`)` + toast「已複製」
    - 「設為私有」：直接 PUT `{is_public: false}` + 成功後 toast「已設為私有」
  - [ ] FAB menu（`...` 選單）在 `!page.is_public` 時加 "Make public" 項目
  - [ ] "Make public" 觸發 **ConfirmDialog**（簡化版）：
    ```
    ┌─────────────────────────────┐
    │ 將此頁面設為公開？          │
    │                             │
    │ "{page.title}"              │
    │                             │
    │ 之後可隨時切回私有。        │
    │                             │
    │    [取消]    [確認公開]     │
    └─────────────────────────────┘
    ```
  - [ ] 確認後 PUT `{is_public: true}` + reload page state

- [ ] 若 codebase 無通用 `ConfirmDialog` 元件，新增 `frontend/src/components/ConfirmDialog.jsx`（最小可用版本即可）

### 2.8 PageEdit — 警示條

- [ ] `frontend/src/pages/PageEdit.jsx`：當 `page.is_public === true` 時頂部顯示：
  ```jsx
  {page.is_public && (
    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg text-sm">
      ⚠ This page is publicly accessible. Any edit will be visible to the world.
    </div>
  )}
  ```

### 2.9 前端測試

- [ ] 新檔 `frontend/src/pages/PublicPageView.test.jsx`：
  - Render with mocked `publicApi` response
  - 顯示 title / author / content
  - **不**顯示 comments / backlinks / edit 按鈕 / sidebar
  - Theme switcher 點擊後 `document.documentElement` 的 `data-theme` 屬性改變
  - 404 分支：API reject → 顯示 PublicNotFound
- [ ] 補 `frontend/src/lib/markdown.test.js`：
  - 驗證 `renderMarkdown` 輸出不含 `<!-- -->`（即使後端已 strip，前端保持雙重防護的 regression test）
- [ ] `frontend/src/components/Viewer/MarkdownViewer.test.jsx` 或新測試：
  - `publicMode={true}` 時，wikilink `<a>` 有 `rel="nofollow"`
  - `publicMode={true}` 時，transclude 區塊顯示 placeholder（沒打 API）
  - `publicMode={true}` 時，drawio 從 `diagrams` prop 讀取（沒打 API）

---

## Phase 3：End-to-end 手動驗證

- [ ] `make dev` 同時啟動 backend / frontend
- [ ] 建立一個測試頁面 `e2e-public-test`，內容包含：
  - Mermaid fence
  - `$$ E = mc^2 $$` 數學
  - `::drawio[1]`（需先建一個 diagram）
  - `![[another-page]]` transclude
  - `[[another-page]]` wikilink（另一頁設為私有）
  - `<!-- secret internal note -->`
  - 一個圖片 `![](/api/media/xxx)`
  - 一個外部連結 `[Google](https://google.com)`
- [ ] 登入狀態切成 public（應出現 confirmation dialog）→ 確認
- [ ] 標題旁看到 `🌐 Public` 徽章，複製連結
- [ ] 開**無痕視窗**打開複製的連結，逐一驗證：
  - [ ] 看得到內容（title + markdown）
  - [ ] Mermaid 圖顯示
  - [ ] KaTeX 公式顯示
  - [ ] Draw.io diagram 顯示（從 inline SVG）
  - [ ] 圖片顯示
  - [ ] `![[another-page]]` 顯示 `(transclusion disabled...)` placeholder
  - [ ] `[[another-page]]` 顯示成可點的連結
  - [ ] 點該 wikilink → 被導到 /login
  - [ ] **View source** 搜尋 `secret internal note` → **找不到**
  - [ ] DevTools 看 `<meta name="robots">` 有 `noindex, nofollow`
  - [ ] DevTools 看 `<meta name="referrer">` 有 `same-origin`
  - [ ] Wikilink `<a>` 有 `rel="nofollow"`
  - [ ] 沒有 sidebar、edit 按鈕、FAB、comments、tags、backlinks
  - [ ] 右上角 ThemeSwitcher 切換主題即時套用
  - [ ] Reload 後主題記住（localStorage）
  - [ ] view_count 沒因為無痕視窗的訪問而增加（回到登入視窗檢查）
- [ ] 登入視窗切回私有 → 無痕視窗 reload → 404 畫面
- [ ] 活動記錄頁面（`/activity`）應看到 `made_public` / `made_private` 兩筆
- [ ] Rate limit：在無痕視窗狂刷（或用 curl script）打 61+ 次 → 拿到 429

---

## Known Limitations / Out of Scope

- 公開頁**不支援**：comments、tags、backlinks、bookmarks、watch、version history、搜尋
- Transclusion (`![[...]]`) 在公開頁完全停用
- 已被瀏覽器 cache / 搜尋引擎 snapshot / Wayback Machine 存檔的內容**無法追回**（作者責任）
- 沒有 share token / expiring link / per-user 公開控制（YAGNI）
- 沒有 OG / Twitter meta tags for social preview（未來可加）
- 沒有 `PUBLIC_BASE_URL` 設定 — 複製連結直接用 `window.location.origin`
- Raw HTML 裡的 `display:none` 不處理（作者若刻意隱藏資訊是作者責任）
- Rate limit 是 in-memory，單一 process 生效；多 worker 部署時各自計數
- 公開頁的媒體檔案（`/api/media/*`）URL 本來就對全世界開放 — 這不是新洞，但值得記錄

---

## 實作順序建議

1. **Phase 1.1–1.4**：後端 migration + router
2. **Phase 1.5**：後端測試全綠
3. **Phase 2.2**：Theme init 搬家（獨立小 refactor，先做 + 驗證不 break 現有登入流程）
4. **Phase 2.1, 2.3–2.6**：公開 viewer 鏈路（publicClient → ThemeSwitcher → PublicPageView → MarkdownViewer publicMode → router mount）
5. **Phase 2.7, 2.8**：PageView 徽章/Toggle + PageEdit 警示條
6. **Phase 2.9**：前端測試
7. **Phase 3**：手動 E2E 驗證（golden path + edge cases）
8. **Gemini CLI review**（依 feedback memory 的流程做 second opinion）
9. Commit — 拆成邏輯清晰的數個 commit（建議：backend / theme-refactor / public-viewer / page-toggle-ux / tests）

---

## 附錄：涉及檔案清單

**後端**：
- `backend/app/database.py`（migration）
- `backend/app/schemas.py`（PageUpdate / PageResponse / PublicPageResponse）
- `backend/app/routers/pages.py`（update_page 接 is_public、log_activity）
- `backend/app/routers/public.py`（**新**）
- `backend/app/main.py`（mount router）
- `backend/tests/test_public_page.py`（**新**）

**前端**：
- `frontend/src/api/publicClient.js`（**新**）
- `frontend/src/App.jsx`（路由 + theme init）
- `frontend/src/components/Layout/Layout.jsx`（移除 initTheme）
- `frontend/src/components/ThemeSwitcher.jsx`（**新**或重構）
- `frontend/src/pages/PublicPageView.jsx`（**新**）
- `frontend/src/components/Viewer/MarkdownViewer.jsx`（publicMode + diagrams props）
- `frontend/src/pages/PageView.jsx`（徽章 + toggle UX）
- `frontend/src/pages/PageEdit.jsx`（警示條）
- `frontend/src/components/ConfirmDialog.jsx`（**新**，若目前沒有通用元件）
- `frontend/src/pages/PublicPageView.test.jsx`（**新**）
- `frontend/src/lib/markdown.test.js`（補測試）
- `frontend/src/components/Viewer/MarkdownViewer.test.jsx`（補或新）
