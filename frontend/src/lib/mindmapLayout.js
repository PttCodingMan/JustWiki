/**
 * Left-to-right tree layout for `page_type='mindmap'` pages.
 *
 * Input:   `{ text, image, children: [...] }` tree produced by `renderMindmap`.
 * Output:  `{ nodes, edges, viewBox }` that `MindmapView` turns into JSX SVG.
 *
 * Geometry (matches the XMind-style logic chart the wiki targets):
 *   - Y direction: children of one parent are packed vertically and share a
 *     common height (per-parent alignment), which keeps sibling rects
 *     visually flush in height when one has an image thumbnail.
 *   - X direction: every node at depth N is widened to the widest natural
 *     width at that depth globally and centered on the same x — so all
 *     blocks at the same level are visually equal-width regardless of which
 *     parent they belong to.
 *   - Edges: orthogonal rounded elbows that exit the parent's right edge
 *     midpoint, bend once at mid-x, and land on the child's left edge
 *     midpoint. Radius is clamped so the arc never exceeds its segment.
 *
 * Image support: when a node has `image: { src, alt }`, the rect is widened
 * to `[PAD_X][IMG_SIZE][IMG_GAP][text][PAD_X]` and heightened to fit
 * `IMG_SIZE + 2·PAD_Y`. The renderer is responsible for laying out the
 * image and text within that rect using the `image` and `textW` fields the
 * layout exports per node.
 */

// Split FONT_FAMILY + FONT_SIZE so the measurement canvas and the rendered
// SVG <text> elements can never drift apart. `FONT` exists as a convenience
// for `ctx.font = …`, which takes the shorthand form.
const FONT_SIZE = 13
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const LAYOUT = Object.freeze({
  NODE_H: 28,
  PAD_X: 14,
  PAD_Y: 6,
  GAP_Y: 10,
  RANK_GAP: 48,
  PAD_L: 20,
  PAD_R: 20,
  PAD_T: 16,
  PAD_B: 16,
  CORNER_R: 6,
  IMG_SIZE: 48,
  IMG_GAP: 8,
  FONT_SIZE,
  FONT_FAMILY,
  FONT: `${FONT_SIZE}px ${FONT_FAMILY}`,
  // Used when canvas `measureText` is unavailable (SSR / jsdom) — double-wide
  // codepoints are counted as 2 so CJK-heavy labels get a reasonable width.
  AVG_CHAR_PX: 7.5,
  CJK_CHAR_PX: 14,
  // Soft cap to keep the measurement cache from growing unbounded over a long
  // session. At the cap we drop the cache and repopulate — simpler than an
  // LRU and cheap given measureText's speed.
  MEASURE_CACHE_MAX: 2000,
})

// -----------------------------------------------------------------------------
// Text measurement
// -----------------------------------------------------------------------------

const measureCache = new Map()
let measureCtx = null
let measureCtxTried = false

function getMeasureCtx() {
  if (measureCtxTried) return measureCtx
  measureCtxTried = true
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext && canvas.getContext('2d')
    if (!ctx || typeof ctx.measureText !== 'function') return null
    ctx.font = LAYOUT.FONT
    measureCtx = ctx
    return ctx
  } catch {
    return null
  }
}

function isWideChar(code) {
  // Conservative CJK + fullwidth cover. Matches the ranges the wiki search
  // service already treats as CJK in `services/search.py`.
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x9fff) || // CJK Unified / Radicals / Kangxi
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK Compatibility Forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

function fallbackTextWidth(text) {
  let w = 0
  for (let i = 0; i < text.length; i++) {
    w += isWideChar(text.charCodeAt(i)) ? LAYOUT.CJK_CHAR_PX : LAYOUT.AVG_CHAR_PX
  }
  return w
}

export function measureText(text) {
  if (!text) return 0
  const cached = measureCache.get(text)
  if (cached !== undefined) return cached
  const ctx = getMeasureCtx()
  let width
  if (ctx) {
    const measured = ctx.measureText(text).width
    // jsdom implements measureText but returns 0 — treat any non-positive
    // result as "unavailable" and fall back to the char-count estimate.
    width = measured > 0 ? measured : fallbackTextWidth(text)
  } else {
    width = fallbackTextWidth(text)
  }
  if (measureCache.size >= LAYOUT.MEASURE_CACHE_MAX) measureCache.clear()
  measureCache.set(text, width)
  return width
}

export function _resetMeasureCacheForTests() {
  measureCache.clear()
  measureCtx = null
  measureCtxTried = false
}

// -----------------------------------------------------------------------------
// Edge path
// -----------------------------------------------------------------------------

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/**
 * Orthogonal rounded-elbow path from `(x0,y0)` to `(x1,y1)` bending once at
 * mid-x. Falls back to a straight line when endpoints sit on the same row.
 * `radius` is clamped so the arc can never overshoot its segment.
 */
export function buildEdgePath(x0, y0, x1, y1, radius) {
  if (y0 === y1) return `M${fmt(x0)},${fmt(y0)} L${fmt(x1)},${fmt(y1)}`
  const mx = (x0 + x1) / 2
  const sign = y1 > y0 ? 1 : -1
  const r = Math.max(
    0,
    Math.min(radius, Math.abs(mx - x0), Math.abs(mx - x1), Math.abs(y1 - y0) / 2),
  )
  return [
    `M${fmt(x0)},${fmt(y0)}`,
    `L${fmt(mx - r)},${fmt(y0)}`,
    `Q${fmt(mx)},${fmt(y0)} ${fmt(mx)},${fmt(y0 + sign * r)}`,
    `L${fmt(mx)},${fmt(y1 - sign * r)}`,
    `Q${fmt(mx)},${fmt(y1)} ${fmt(mx + r)},${fmt(y1)}`,
    `L${fmt(x1)},${fmt(y1)}`,
  ].join(' ')
}

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------

/**
 * Width of the inner content (image + gap + text) before per-parent
 * equalization. Used to compute `rectW` and exposed as `textW` so the
 * renderer can place the text label without re-measuring.
 */
function naturalContentDims(node) {
  const textW = node.text ? Math.ceil(measureText(node.text)) : 0
  const hasImage = !!node.image
  let inner = textW
  if (hasImage) {
    // Image-only node: just the thumbnail.
    // Image + text node: thumb + gap + text.
    inner = textW > 0 ? LAYOUT.IMG_SIZE + LAYOUT.IMG_GAP + textW : LAYOUT.IMG_SIZE
  }
  const rectW = inner + LAYOUT.PAD_X * 2
  const rectH = hasImage ? LAYOUT.IMG_SIZE + LAYOUT.PAD_Y * 2 : LAYOUT.NODE_H
  return { textW, rectW, rectH }
}

/**
 * Assign a stable id + depth to every node in the tree via pre-order DFS.
 * Mutates `node._id` and `node._depth` on clones (see `layoutMindmap`).
 */
function annotate(node, depth, parentId, out, nextId) {
  node._id = nextId.n++
  node._depth = depth
  node._parentId = parentId
  out.push(node)
  for (const c of node.children) annotate(c, depth + 1, node._id, out, nextId)
}

/**
 * Post-order DFS: compute `rectW` / `rectH` / `textW` for leaves from text +
 * image dims, heighten all children of each node to the max sibling height
 * (per-parent alignment so image and non-image siblings stay visually flush),
 * then compute subtree vertical extent. Width equalization happens later, in
 * a per-depth pass after the whole tree has been measured.
 */
function measure(node) {
  const dims = naturalContentDims(node)
  node.textW = dims.textW
  node.rectW = dims.rectW
  node.rectH = dims.rectH
  for (const c of node.children) measure(c)
  if (node.children.length > 0) {
    let maxChildH = 0
    for (const c of node.children) {
      if (c.rectH > maxChildH) maxChildH = c.rectH
    }
    for (const c of node.children) c.rectH = maxChildH
  }
  node.subtreeH =
    node.children.length === 0
      ? node.rectH
      : node.children.reduce((s, c) => s + c.subtreeH, 0) +
        LAYOUT.GAP_Y * (node.children.length - 1)
}

/**
 * Pre-order DFS that places each node vertically centered on its subtree and
 * stacks children top-to-bottom with `GAP_Y` spacing.
 */
function positionY(node, topY) {
  node.y = topY + node.subtreeH / 2
  let cursor = topY
  for (const c of node.children) {
    positionY(c, cursor)
    cursor += c.subtreeH + LAYOUT.GAP_Y
  }
}

/**
 * Deep-clone the tree so `layoutMindmap` does not mutate the caller's data
 * (important because MindmapView memoizes the parsed tree, and re-renders
 * would accumulate `rectW` / `_id` scribbles).
 */
function cloneTree(node) {
  return {
    text: node.text,
    image: node.image || null,
    children: node.children.map(cloneTree),
  }
}

/**
 * Compute layout for a mindmap tree. Returns a flat node list, edge list,
 * and a viewBox tuple `[x, y, w, h]` suitable for `<svg viewBox>`.
 */
export function layoutMindmap(tree) {
  const root = cloneTree(tree)

  const flat = []
  annotate(root, 0, null, flat, { n: 0 })

  measure(root)
  positionY(root, LAYOUT.PAD_T)

  // Per-depth width equalization: every node at depth d is widened to the
  // widest natural rect at that depth, so all blocks on the same level read
  // as equal-width regardless of which parent they descend from.
  const colMaxW = []
  for (const n of flat) {
    const d = n._depth
    if (colMaxW[d] === undefined || n.rectW > colMaxW[d]) colMaxW[d] = n.rectW
  }
  for (const n of flat) n.rectW = colMaxW[n._depth]
  const colCenterX = []
  if (colMaxW.length > 0) {
    colCenterX[0] = LAYOUT.PAD_L + colMaxW[0] / 2
    for (let d = 1; d < colMaxW.length; d++) {
      colCenterX[d] =
        colCenterX[d - 1] + colMaxW[d - 1] / 2 + LAYOUT.RANK_GAP + colMaxW[d] / 2
    }
  }
  for (const n of flat) n.x = colCenterX[n._depth]

  const nodes = flat.map((n) => ({
    id: n._id,
    depth: n._depth,
    text: n.text,
    image: n.image || null,
    textW: n.textW,
    x: n.x,
    y: n.y,
    w: n.rectW,
    h: n.rectH,
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges = []
  for (const n of flat) {
    if (n._parentId === null) continue
    const parent = byId.get(n._parentId)
    const child = byId.get(n._id)
    const x0 = parent.x + parent.w / 2
    const y0 = parent.y
    const x1 = child.x - child.w / 2
    const y1 = child.y
    edges.push({
      id: `e${parent.id}-${child.id}`,
      fromId: parent.id,
      toId: child.id,
      d: buildEdgePath(x0, y0, x1, y1, LAYOUT.CORNER_R),
    })
  }

  let maxRight = LAYOUT.PAD_L
  for (const n of nodes) {
    const right = n.x + n.w / 2
    if (right > maxRight) maxRight = right
  }
  const width = maxRight + LAYOUT.PAD_R
  const height = (root.subtreeH || LAYOUT.NODE_H) + LAYOUT.PAD_T + LAYOUT.PAD_B

  return { nodes, edges, viewBox: [0, 0, width, height] }
}
