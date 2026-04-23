# Mindmap — 心智圖頁面類型

> Status: Planned  ·  Effort: **M**（~2.5 工作日）
> 相依：無（Mermaid 已整合於 `frontend/src/lib/markdown.js:367`）

## 1. 摘要

引入 `pages.page_type` 欄位，`page_type = 'mindmap'` 的頁面仍然是 markdown 文件，差別在於 viewer 走專屬 renderer：把 heading 階層／bullet list 結構確定性映射成 Mermaid mindmap。

不做 AI、不做專屬編輯器、不做快取。使用者寫 markdown，看到心智圖。

## 2. 為何這樣切

Markdown heading 與 bullet list 本身就是嚴格樹狀結構；要渲染成心智圖不需要 AI 也不需要猜測，只需要一個確定性 parser。被否決的替代方案：

- ❌ AI 重組（成本高、有幻覺風險、離線不可用）
- ❌ 獨立 `mindmaps` 資料表（失去 FTS5、wikilinks、transclusion、ACL）
- ❌ 專屬拖拉編輯器（維護成本翻倍，偏離「用 markdown 管理知識」的核心）
- ❌ `mindmap_cache` 表（parser < 1ms，快取是 over-engineering）

## 3. 關鍵架構決策

### D1：parser 放前端，不是後端

原本反射性地想把 parser 放後端，對齊 codebase 後發現前端明顯更合適：

| 面向 | 後端 parser | 前端 parser |
|------|------------|------------|
| 新依賴 | `markdown-it-py` | 無（`markdown-it` 已裝） |
| 預覽延遲 | 需 debounce + round trip | 即時 |
| 預覽端點 | 需 `POST /preview/mindmap` | 不需要 |
| 與 viewer 一致 | 另寫一套 | 直接重用 `lib/markdown.js` 的 token stream |

後端只負責：儲存 `content_md`、把 `page_type` 跟著回吐。**不解析任何東西**。

### D2：不抽 renderer registry

目前後端沒有 render pipeline（`content_md` 原封不動回給前端），registry 沒有棲息地。若未來真要加 slides / kanban 再抽，YAGNI。

### D3：改 `page_type` 是 metadata 變更

不需要 `base_version`、不 bump `version`、不建 version snapshot、不 rebuild FTS、不重算 backlinks。內容完全沒動，渲染方式改變不屬於「內容編輯」。與 `is_public` 切換等價。

### D4：搜尋不特殊處理，但搜尋結果 UI 要標示類型

FTS5 索引照 `content_md` 建，與 document 無差異。前端搜尋結果卡片顯示 `page_type` icon，避免「預期是文章，點進去變圖」的困惑。

### D5：`page_type` 用 TEXT + Pydantic Literal 把關

不用 SQLite CHECK 約束。未來加新類型純 Python 改動，不必再開 migration。

## 4. 資料模型

### 4.1 Migration

`backend/app/migrations.py` 追加第 9 號（append-only，不可重編號）：

```python
async def _m009_page_type(db: aiosqlite.Connection) -> None:
    if not await _column_exists(db, "pages", "page_type"):
        await db.execute(
            "ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'document'"
        )

MIGRATIONS.append((9, "page_type", _m009_page_type))
```

`_detect_preexisting()` 對應加：

```python
if await _column_exists(db, "pages", "page_type"):
    applied.add(9)
```

`_INDEX_INVARIANTS` 加：

```python
"CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(page_type)",
```

### 4.2 Pydantic schema（`backend/app/schemas.py`）

```python
from typing import Literal
PageType = Literal["document", "mindmap"]
```

- `PageCreate`：加 `page_type: PageType = "document"`
- `PageUpdate`：加 `page_type: Optional[PageType] = None`
- `PageResponse`、`PublicPageResponse`：加 `page_type: PageType = "document"`

## 5. 後端改動

### 5.1 `routers/pages.py`

- `create_page`：INSERT 多塞 `page_type`；回應走 `SELECT *` 自然帶出
- `update_page`：在 `is_public` 的 metadata 分支旁邊加 `page_type`，不 bump version、不需要 `base_version`
- `get_page`：不用改（`SELECT *` 已帶出）

### 5.2 `routers/search.py`

`_search_fts` 與 `_search_like` 的 SELECT 列加 `p.page_type`，result dict 加 `"page_type": row["page_type"]`。

### 5.3 其他 router

- `routers/public.py`：`PublicPageResponse` 帶 `page_type`（匿名訪客也能看心智圖）
- `routers/versions.py`：不動（version snapshot 不存 `page_type`；改類型不建 snapshot）
- `routers/export.py`：不動（直接匯出 `content_md`，markdown 本來就能讀）

### 5.4 **完全不做**

- 沒有 `mindmap.py` router
- 沒有 `render_mindmap()` Python 函式
- 沒有 `renderers/` 目錄
- 沒有 `markdown-it-py` 依賴
- 沒有預覽端點

## 6. 前端改動

### 6.1 新檔：`frontend/src/lib/mindmap.js`

確定性 parser。關鍵實作點：

- 用 `markdown-it` 的 token stream（非 tree API，JS 版不提供）
- `inlineText(inlineToken)`：遞迴抽 `text` / `code_inline`，正確處理 `em` / `strong` / `link` 混合 inline children（這是原設計 Python 版的 bug）
- `fromHeadings`：先過濾 nonRoot 再算 minLevel，避免空 array `Math.min()` 爆 `-Infinity`（原設計 bug）
- `fromBulletList`：上限 4 層深度
- `sanitize`：移除 `()[]{}":;,、「」『』`，截 30 字
- 兩條策略都失敗拋 `MindmapParseError('心智圖頁面需要至少包含 heading 或 bullet list 結構')`

### 6.2 新檔：`frontend/src/components/MindmapView.jsx`

```jsx
import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

export default function MindmapView({ mermaidCode, error }) {
  const ref = useRef(null)
  useEffect(() => {
    if (error || !mermaidCode || !ref.current) return
    const id = `mm-${Math.random().toString(36).slice(2)}`
    mermaid.render(id, mermaidCode)
      .then(({ svg }) => { if (ref.current) ref.current.innerHTML = svg })
      .catch(err => { if (ref.current) ref.current.innerHTML = `<pre class="text-red-500">${err.message}</pre>` })
  }, [mermaidCode, error])
  if (error) return <div className="p-4 text-amber-700 bg-amber-50 rounded">{error}</div>
  return <div ref={ref} className="mindmap-container overflow-auto" />
}
```

**Mermaid init 要集中**：抽 `frontend/src/lib/mermaidBootstrap.js`，全 app 只 init 一次。現行 `lib/markdown.js` 的 mermaid 初始化也要移過去，避免競態。

### 6.3 `PageView.jsx` — 檢視分支

```jsx
{page.page_type === 'mindmap'
  ? <MindmapRender content={page.content_md} title={page.title} />
  : <MarkdownViewer markdown={page.content_md} />}
```

`MindmapRender` 包 `useMemo(() => renderMindmap(content, title))` + try/catch → `<MindmapView>`。

### 6.4 `NewPage.jsx` — 類型選擇器

多一個 `pageType` state，純 Tailwind 按鈕（不引入 shadcn、不引入 `<Select>`）：

```jsx
<div className="flex gap-2 mb-4">
  <button type="button" onClick={() => setPageType('document')}
    className={`px-3 py-2 rounded ${pageType === 'document' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
    📄 文件
  </button>
  <button type="button" onClick={() => setPageType('mindmap')}
    className={`px-3 py-2 rounded ${pageType === 'mindmap' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
    🧠 心智圖
  </button>
</div>
```

選到 `mindmap` 且 content 為空 → 預填範本。`usePages.createPage` 對應傳 `page_type`。

### 6.5 `PageEdit.jsx` — Split View（最簡版）

mindmap 類型時兩欄：

```jsx
{page.page_type === 'mindmap' ? (
  <div className="flex flex-col md:flex-row gap-4 h-full">
    <div className="flex-1 min-w-0"><Editor value={content} onChange={setContent} /></div>
    <div className="flex-1 min-w-0 overflow-auto border-l pl-4">
      <LiveMindmap content={content} title={title} />
    </div>
  </div>
) : <Editor value={content} onChange={setContent} />}
```

`LiveMindmap` 用 `useMemo` 直跑 parser，parser < 1ms 不需要 debounce。

**不引入** `react-resizable-panels`。行動裝置靠 `flex-col` 自動堆疊，先不做 tab switch；有使用者抱怨再加。

### 6.6 `SearchResults.jsx` — 類型 icon

```jsx
const TYPE_ICONS = { document: '📄', mindmap: '🧠' }
<span className="mr-2">{TYPE_ICONS[result.page_type] ?? '📄'}</span>
```

點擊照常連 `/pages/{slug}`，`PageView` 內部依 `page_type` 分支，不需要 query param。

## 7. 測試

### 7.1 Parser 單元測試（vitest）

`frontend/src/lib/mindmap.test.js`：
- heading：H1→H2→H3；缺 H1 用 title；單 H1 落到 bullet 路線
- bullet：平、兩層、超出 max_depth 截斷
- sanitize：全形半形混用、`「」『』，。`、長度截斷
- 錯誤：空、純 paragraph、純 code block → `MindmapParseError`
- 回歸：`em`／`strong`／`link` 混入 heading 的 inline children

### 7.2 真實 fixture

`frontend/src/lib/fixtures/mindmap/*.md`：3 篇真實 markdown（CJK 混英、含 code fence、含 table），確認 parser 不爆。

### 7.3 後端測試

`backend/tests/test_pages.py` 加 case：
- `POST /api/pages` 帶 `page_type: "mindmap"` 建立成功，回應帶 `page_type`
- `PUT /api/pages/{slug}` 只改 `page_type`，不需 `base_version`，`version` 不變
- `PUT /api/pages/{slug}` 同時改 `page_type` + `content_md`，後者仍要 `base_version`

### 7.4 Migration 測試

在沒有 `page_type` 欄位的舊 DB 跑 `run_migrations`，確認欄位加上、default 正確、index 建立。

### 7.5 前端整合

`PageView.test.jsx`、`PageEdit.test.jsx` 各加 `page_type: 'mindmap'` 的 render case，mock `mermaid` module（jsdom 跑不起來 Mermaid render）。

## 8. 要動／要新增的檔案

**改**
- `backend/app/migrations.py`（加 m009）
- `backend/app/schemas.py`（PageType Literal + 三個 schema 加欄位）
- `backend/app/routers/pages.py`（create/update 認識 `page_type`）
- `backend/app/routers/search.py`（SELECT + result 帶 `page_type`）
- `backend/app/routers/public.py`（回應帶 `page_type`）
- `backend/tests/test_pages.py`（加 case）
- `frontend/src/lib/markdown.js`（mermaid init 移走，或保留並確保不重複）
- `frontend/src/pages/NewPage.jsx`（類型選擇器 + 範本）
- `frontend/src/pages/PageView.jsx`（依類型分支渲染）
- `frontend/src/pages/PageEdit.jsx`（split view）
- `frontend/src/pages/SearchResults.jsx`（類型 icon）
- `frontend/src/store/usePages.js`（`createPage`/`updatePage` 帶 `page_type`）

**新增**
- `frontend/src/lib/mindmap.js`（parser）
- `frontend/src/lib/mindmap.test.js`
- `frontend/src/lib/fixtures/mindmap/*.md`
- `frontend/src/lib/mermaidBootstrap.js`（集中 init）
- `frontend/src/components/MindmapView.jsx`

## 9. 風險表

| 風險 | 對策 |
|------|------|
| Milkdown 輸出的 markdown 跟 `markdown-it` 解析不一致 | parser 用 `markdown-it`，與 viewer 同源。驗收時跑「Milkdown 輸入 → 儲存 → viewer 渲染」一條龍 |
| Mermaid init 衝突（`markdown.js` 已 init vs `MindmapView` 再 init） | 抽 `lib/mermaidBootstrap.js`，全 app 只 init 一次 |
| 散文內容導致 parse 錯 | 清楚錯誤訊息 + 不 fallback。error path unit test 涵蓋 |
| 長 CJK 節點 Mermaid 換行醜 | sanitize 截 30 字，CSS 控制節點寬度 |
| 舊 DB 升級時沒有 `page_type` 欄位的 race | `run_migrations` 在 startup 前跑完，init 只發生一次 |

## 10. 不做（v1.5 / v2 再談）

- AI 從 document 生 mindmap
- 匯出 PNG／SVG（Mermaid 本身已提供右鍵存圖）
- 深度／節點數 slider（YAGNI）
- 專屬拖拉編輯器
- `mindmap_cache` 表
- Slides／kanban 類型（那時候再抽 registry）
- 手機版 tab 切換（先靠 `flex-col` 堆疊，有人抱怨再做）

## 11. Effort

**M** — ~2.5 工作日：

| Phase | 內容 | 工時 |
|-------|------|------|
| P0 | migration + schema + pages router | 0.4d |
| P1 | 前端 parser + 測試 | 0.6d |
| P2 | `MindmapView` + `PageView` 分支 + SearchResults icon | 0.4d |
| P3 | `NewPage` 類型選擇 + `PageEdit` split view | 0.6d |
| P4 | search router 帶 `page_type` + 收尾測試 + Gemini review | 0.5d |
