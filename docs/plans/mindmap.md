# Mindmap — 心智圖頁面類型

> Status: v1 shipped · v2 proposed  ·  Effort (v2): **M**（~1.5–2 工作日）
> v1 commit：`e18da9c feat: add mindmap page type rendered as a left-to-right Mermaid tree.`

## 0. 版本

- **v1（已上線）**：`page_type='mindmap'` 的頁面用 markdown 寫，viewer 走 Mermaid `flowchart LR` + SVG post-processing（`curve:step` → 邊線 90° 轉折圓角 → 同層 rect 寬度對齊）渲染。
- **v2（本計劃）**：把 tree → SVG 的 render pipeline 從 Mermaid 換成自寫 layout + SVG JSX。tree parser、`page_type` 後端、頁面路由、編輯器 split view 完全保留不動。

## 1. 摘要（v2）

v1 的 Mermaid 管線已經疊了三層 SVG post-processing 補丁才勉強靠近 XMind 的 logic-chart 樣式。要再進一步（per-parent 寬度對齊、可控的 elbow 幾何、column 間距公差、節點陰影／hover 細節）需要 dagre 的 layout metadata，而 SVG 根本抽不到。

`frontend/src/lib/mindmap.js` 已經產出乾淨的 `{text, level, parent}` tree —— 缺的只有一個 LR 樹狀 layout 和 SVG renderer。自寫之後 render pipeline 純函式、可單測、樣式 100% 由 wiki 控制，不再被 Mermaid 版本鎖住。

## 2. 為什麼換（v1 做不到的事）

| 目標 | v1（Mermaid + SVG post-process） | v2（自寫 layout） |
|------|----------------------------------|-------------------|
| 同層寬度對齊 | ✅（widenig post-pass） | ✅ native |
| Per-parent 寬度對齊 | ❌（SVG 沒有 parent/child 資訊） | ✅ |
| 連線從節點邊緣中點出 | ⚠️（Mermaid 預設，無法微調） | ✅ |
| 圓角 elbow 半徑可調 | ✅（post-pass） | ✅ native |
| Column 間距隨最大節點寬度自適應 | ❌ | ✅ |
| 懸停／選取樣式 | 難（要跟 Mermaid class 搶） | ✅ native |
| Mermaid 版本升級不踩雷 | ❌ | ✅（無此依賴） |
| 匯出 PNG／SVG | ⚠️（Mermaid 產的 SVG） | ✅（自產 SVG 乾淨） |

## 3. 目標（v2 驗收條件）

1. 同一位母節點底下的所有子節點 rect 寬度相等（以群組最寬為準）。
2. 連線從母節點右側中點出、在母／子節點中點處 elbow、到子節點左側中點止，轉折處半徑約 6px。
3. LR 排版：每個深度的欄位 x 座標 = 前一欄 x + 前一欄實際最大節點寬 + rank gap。
4. 節點顏色與 wiki 主題同步，主題切換即時生效（目前 v1 就是這樣，繼續保持）。
5. 現有 `mindmap.test.js` 的 17 個 heading/bullet/clamp/error 案例全綠（assertion 調整為樹狀結構，不再對 Mermaid 字串做 substring check）。

## 4. 架構決策

### D1：tree parser 完全保留

`lib/mindmap.js` 的 `buildTree`、`collectHeadings`、`collectBullets`、`sanitize` 邏輯 v1 就已經是乾淨的 pure function。v2 只改 export 形狀：

- v1：`renderMindmap(md, title): string`（Mermaid source）
- v2：`renderMindmap(md, title): { text, children: [...] }`（純資料樹）

所有字元清洗、heading/bullet 策略、clamp、error 路徑不動。既有測試大部分可以直接改 assertion 復用。

### D2：layout 用手寫 LR tree walker，不引入 d3-hierarchy

LR 樹狀 layout 其實很簡單：

- `measure(node)`：遞迴算 subtree 的視覺高度 `nodeHeight + (子節點視覺高度總和) + (子節點之間的 gap)`。
- `position(node, x, topY)`：依序放置子節點，父節點 y = 子節點視覺 bounding box 的中點。

大約 40–60 行，比引入 d3-hierarchy（+ 8KB 依賴、外加 coord 系統翻譯）划算。d3-hierarchy.tree() 本來就不支援變動寬度的節點，我們還是要自己處理。

### D3：節點寬度用 canvas `measureText` 量

```js
const ctx = document.createElement('canvas').getContext('2d')
ctx.font = '13px system-ui, sans-serif'
const w = ctx.measureText(text).width + padX * 2
```

- 字型 context 跟節點實際 render 用的 CSS 保持一致（抽常數）。
- 結果 cache 在模組變數的 `Map<text, width>`；同樣字串命中率高。
- SSR fallback：canvas 不可得時用 `text.length * avgCharWidth`（CJK 視為 2 寬度單位），讓 server render 不爆。

### D4：renderer 用 React JSX 直接吐 SVG，不走 DOMParser

v1 是「Mermaid 產字串 → DOMParser 解 → 改 DOM → 序列化」。v2 直接 JSX：

```jsx
<svg viewBox={...}>
  {nodes.map((n) => (
    <g key={n.id} transform={`translate(${n.x},${n.y})`}>
      <rect x={-n.w/2} y={-n.h/2} width={n.w} height={n.h} rx={6} ry={6} />
      <text>{n.text}</text>
    </g>
  ))}
  {edges.map((e) => <path key={e.id} d={e.d} />)}
</svg>
```

好處：React 控制 update / key / hover state、不需要 `dangerouslySetInnerHTML`、不需要 DOMPurify（因為文字走 React 自動轉譯）。

### D5：edge 路徑直接產乾淨的 rounded elbow

給定 `(x0, y0)` 母右邊中點、`(x1, y1)` 子左邊中點、中點 `mx = (x0+x1)/2`：

```
M x0,y0
L (mx - r),y0
Q mx,y0 mx,(y0 + sign·r)
L mx,(y1 - sign·r)
Q mx,y1 (mx + r),y1
L x1,y1
```

`sign = y1 > y0 ? 1 : -1`。半徑 `r` clamp 到 `min(|mx-x0|, |mx-x1|, |y1-y0|/2)` 避免超過段長。跟 v1 的 `roundPolyline` 邏輯一致，只是現在直接生成，不是後處理。

直段（`y0 === y1`，例如獨生子女）退化成 `M x0,y0 L x1,y1`。

### D6：per-parent 寬度對齊 vs per-depth 對齊

**v2 採 per-parent**（要求 3 之外的擴充目標）：同一位母節點的所有子節點共用「該群組最大寬度」。不同母節點的同深度節點可以有不同寬度 —— 這也是 XMind logic chart 實際的行為。

**欄位 x 座標**依「**該深度全域最大節點寬**」累加（不是 per-parent），確保同深度節點還是垂直對齊在同一 column —— 這樣視覺上最接近 XMind 那張圖。

白話：**y 方向** per-parent 擠緊，**x 方向** per-depth 對齊。

### D7：刪除 Mermaid 依賴（僅 mindmap 頁面）

`MindmapView.jsx` 不再 import `mermaidBootstrap`。`MarkdownViewer` 裡的 mermaid code fence 照舊走 Mermaid（那條管線跟心智圖無關，不動）。

`lib/mindmapEdges.js` 的 `roundPolyline` 輔助邏輯**抽精華**搬進 `mindmapLayout.js` 的 edge builder，整個 `mindmapEdges.js` 連同它的測試一起刪。

## 5. 檔案異動

**改**
- `frontend/src/lib/mindmap.js`
  - 移除 `emitFlowchart`、`escapeLabel`、`SANITIZE_STRIP_CHARS` 中 Mermaid 專用的字元剝除（`()`、`[]`、`{}` 保留；Mermaid label grammar 限制不再適用）
  - `renderMindmap` 改回樹狀物件 `{ text, children: [...] }`，錯誤路徑保留
  - 頂檔註解改寫
- `frontend/src/lib/mindmap.test.js`
  - Heading/bullet/clamp/error 案例保留，assertion 改成對 tree 物件的結構斷言
  - 去掉對 `"flowchart LR"` / `"curve":"step"` / `n0 --> n1` 的 substring check
- `frontend/src/components/MindmapView.jsx`
  - 移除 mermaid、DOMParser、dangerouslySetInnerHTML
  - 改吃 `renderMindmap` 的樹 + 呼叫 `layoutMindmap` + 直接 JSX SVG
  - 主題讀取改走 CSS var（不用再讀計算值塞進 Mermaid classDef）：直接在 SVG 的 `fill`/`stroke` 用 `var(--color-primary)` 等
- `frontend/src/pages/PageEdit.jsx`（`LiveMindmap`）
  - 同樣改用新的 `MindmapView`（signature 不變，只換內部實作）

**新增**
- `frontend/src/lib/mindmapLayout.js`
  - `layoutMindmap(tree): { nodes: [...], edges: [...], viewBox }`
  - `measureText(text)`（canvas 量 + cache + SSR fallback）
  - `buildEdgePath({ from, to, radius })`（rounded elbow）
- `frontend/src/lib/mindmapLayout.test.js`
  - 單節點：root 放在 (padding, padding)
  - 線性鏈：深度 3 → 3 欄 x 依最大寬度累加
  - 寬度對齊：兩個兄弟字長差異 → 兩個 rect 等寬
  - Per-parent 分組：不同 parent 下同深度的節點寬度可不同，但 x 欄位對齊
  - Edge path：直段 degenerate、elbow 圓角 clamp、上下左右方向

**刪**
- `frontend/src/lib/mindmapEdges.js`
- `frontend/src/lib/mindmapEdges.test.js`

**不動**
- 所有後端檔案（`migrations.py`、`schemas.py`、`routers/*.py`、`tests/test_pages.py`）
- `frontend/src/lib/mermaidBootstrap.js`（MarkdownViewer 還在用）
- `frontend/src/pages/{PageView,NewPage,SearchResults}.jsx`
- `frontend/src/store/usePages.js`

## 6. layout 演算法細節

### 6.1 量測階段

對 tree 做 post-order DFS：

```js
function measure(node) {
  node.textW = measureText(node.text)
  node.rectW = node.textW + PAD_X * 2
  node.rectH = NODE_H  // 固定
  for (const c of node.children) measure(c)
  // per-parent width alignment: children 共用群組最大寬
  if (node.children.length > 0) {
    const maxChildW = Math.max(...node.children.map((c) => c.rectW))
    for (const c of node.children) c.rectW = maxChildW
  }
  // 子樹視覺高度：子節點總高 + 子節點間 gap；葉節點取自身高
  node.subtreeH = node.children.length === 0
    ? node.rectH
    : node.children.reduce((s, c) => s + c.subtreeH, 0)
      + GAP_Y * (node.children.length - 1)
}
```

### 6.2 欄位 x 計算

以深度為 index：`colX[d] = colX[d-1] + colMaxW[d-1] / 2 + RANK_GAP + colMaxW[d] / 2`，`colX[0] = PAD_L + colMaxW[0] / 2`。

一次 BFS 計 `colMaxW`，再線性推 `colX`。

### 6.3 y 位置

pre-order DFS，用「目前子樹頂部 y」一路傳：

```js
function position(node, topY) {
  node.x = colX[node.depth]
  node.y = topY + node.subtreeH / 2
  let cursor = topY
  for (const c of node.children) {
    position(c, cursor)
    cursor += c.subtreeH + GAP_Y
  }
}
```

### 6.4 常數（初值，可調）

```js
const NODE_H = 28
const PAD_X = 12
const GAP_Y = 10      // 兄弟節點間 vertical gap
const RANK_GAP = 48   // column 間橫向 gap
const PAD_L = 16      // 整張圖左側 padding
const PAD_T = 16      // 整張圖上側 padding
const CORNER_R = 6    // edge elbow 圓角
const FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
```

## 7. 主題整合

SVG 元素直接用 CSS 變數：

```jsx
<rect fill="var(--color-surface)" stroke="var(--color-border)" />
<text fill="var(--color-text)" />
<path stroke="var(--color-border)" />
```

Root 和 lv1 節點用 `--color-primary` / `--color-primary-soft`（跟 v1 相同配色）。Level-based fill 用 class 條件：

```jsx
<rect className={`mindmap-node mindmap-node-lv${Math.min(node.depth, 4)}`} />
```

搭配 `index.css` 裡的規則（跟 v1 的 classDef 一一對應搬過去）。

主題切換自動生效，不需要 re-render → `useTheme` 不再是 MindmapView 的 dep。

## 8. 測試策略

### 8.1 layout unit tests（新）

`frontend/src/lib/mindmapLayout.test.js` — 純函式、jsdom 即可（不跑 Mermaid）：

- 單節點 tree：nodes[0] 在 `(PAD_L + w/2, PAD_T + h/2)`
- 線性 A→B→C：三個 x 遞增、y 相同
- 雙子樹：兩個 child 等寬、等深度 x 對齊、y 間距 = GAP_Y
- 深度 3 per-parent：A 底下有 B、C，B 底下有 D，C 底下有 E。B.rectW === C.rectW，D.x === E.x，D.rectW 可以和 E.rectW 不同（per-parent）
- viewBox 覆蓋所有節點 + padding

### 8.2 tree parser tests（沿用）

`mindmap.test.js` 17 個案例改 assertion 為：

```js
const tree = renderMindmap('# A\n\n## B\n')
expect(tree.text).toBe('A')
expect(tree.children[0].text).toBe('B')
```

錯誤路徑（`MindmapParseError`）完全不動。

### 8.3 renderer integration tests

`MindmapView.test.jsx`（新）— React Testing Library：

- 渲染 3 節點 tree：找得到 3 個 `rect` 和 2 個 `path`
- 樣式：root rect 的 class 含 `mindmap-node-lv0`
- 錯誤 fallback：傳 parser 會爆的 markdown，呈現紅色錯誤 panel

不 mock mermaid（不需要了）。

## 9. 遷移步驟（reviewer 友善的切法）

建議以 4 個 commit 逐步替換：

1. **tree shape 改 export**：`renderMindmap` 改回傳物件；更新 tree parser tests。此時 `MindmapView` 跟 `LiveMindmap` 會壞 —— 當場在同 commit 改它們去 import 一個 stub `layoutMindmap` 先 throw，讓 build 通過但執行會報錯（寫測試保護）。
2. **實作 `mindmapLayout.js`**：layout + measure + edge builder + 單測，獨立提交。
3. **重寫 `MindmapView.jsx`**：改用新 layout、移除 mermaid import，加 integration test。
4. **清理**：刪 `mindmapEdges.{js,test.js}`、刪 `mindmap.js` 的 `emitFlowchart` dead code、CSS 變數調整。

每個 commit 都能 `make test` 全綠（第 1 個會暫時跳過 MindmapView 的 runtime 路徑，但單元層還是通過）。

## 10. 風險表

| 風險 | 對策 |
|------|------|
| canvas `measureText` 在 jsdom 下回 0 | 測試環境偵測 → fallback 到 char-count 估算；整合測試只斷結構、不斷絕對像素 |
| 字型渲染跨平台差 → 節點寬度不一致 | 節點 rect 寬 = textW + 2·PAD_X，誤差 < 2px 視覺可忽略；多給一點 PAD_X 吸收 |
| Per-parent 寬度下大 tree 視覺失衡 | 常數 `RANK_GAP` 和 `PAD_X` 開頭就留寬一點；實際試跑真實頁面再 tune |
| 主題切換 CSS var 不即時 | 直接用 `var(--…)` 就是 CSS 原生行為，不需要額外處理；手動在瀏覽器切主題驗 |
| 極深 tree 單頁畫面過寬 | overflow-auto（v1 就有）保留；未來可考慮 zoom slider（v2.1） |
| 長 CJK 字串 `measureText` 慢 | cache `Map<text,width>`；典型頁面 < 200 節點，不會是瓶頸 |

## 11. 不做（留到 v2.1）

- 拖拉編輯、節點展開／摺疊
- 匯出 PNG（SVG → Canvas → blob 是另一條線，先不疊）
- 縮放 / 平移手勢（先靠 overflow-auto 滿足）
- 多主題預設（lv0–lv4 的色票照 v1 配，不增色）
- 動畫（進／出節點、hover 變色 transition）

## 12. Effort

**M** — ~1.5–2 工作日：

| Phase | 內容 | 工時 |
|-------|------|------|
| P0 | `mindmap.js` 改回 tree、parser tests 改 assertion | 0.3d |
| P1 | `mindmapLayout.js` + 單測 | 0.6d |
| P2 | 重寫 `MindmapView.jsx` + integration test + CSS 搬家 | 0.5d |
| P3 | 清理 `mindmapEdges.*`、真實頁面目視調參、Gemini review | 0.4d |
