/**
 * Mindmap layout strategies for `page_type='mindmap'` pages.
 *
 * Input:   `{ text, image, children: [...] }` tree produced by `renderMindmap`.
 * Output:  `{ nodes, edges, viewBox }` that `MindmapView` turns into JSX SVG.
 *
 * Three layout strategies are exposed via `layoutMindmap(tree, { layout })`:
 *
 *   - `'lr'` (default, XMind logic-chart style): root on the left, children
 *     stacked vertically on the right. Per-depth widths are equalized so all
 *     blocks at the same level read as equal-width.
 *   - `'rl'`: mirror of LR — root on the right, children spread to the left.
 *     Geometrically the same walker as LR with x-axis sign flipped, then
 *     translated so the bbox lives in positive viewBox coordinates.
 *   - `'radial'`: subtree-local radial / "Gource-style". Each parent is the
 *     center of its own children's fan-out — non-root nodes spread their
 *     descendants in the angular slice that points outward from the
 *     grandparent, so deep subtrees form their own little starbursts instead
 *     of every depth collapsing onto a shared ring. Angle budget per child
 *     is allocated by leaf count and clamped at MIN_ANGLE.
 *
 * `viewBox` is computed from the union bbox of all node rects after layout
 * runs, then translated to (0,0) — every strategy goes through the same
 * post-pass so there is no "assumed origin" coupling between layout and the
 * SVG renderer.
 */

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
  AVG_CHAR_PX: 7.5,
  CJK_CHAR_PX: 14,
  MEASURE_CACHE_MAX: 2000,
  // Radial-only knobs.
  RING_GAP: 56,
  // Minimum angular slice each radial node is allowed to occupy. Below this
  // the leaf-based quota would compress labels to illegible widths; the
  // clamp lets the renderer stay readable at the cost of asymmetric layout
  // when one subtree dominates leaf count.
  MIN_ANGLE: 0.05,
  RADIAL_PAD: 24,
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
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
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
// Edge paths
// -----------------------------------------------------------------------------

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/**
 * Orthogonal rounded-elbow path from `(x0,y0)` to `(x1,y1)` bending once at
 * mid-x. Used by LR and RL — both flow horizontally so the elbow always sits
 * on a vertical x-axis seam. Falls back to a straight line when endpoints
 * sit on the same row. `radius` is clamped so the arc never overshoots its
 * segment.
 */
export function buildOrthogonalEdge(x0, y0, x1, y1, radius) {
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

// Backwards-compat alias — same signature, same output. Kept so existing
// callers / tests using `buildEdgePath` keep working until they migrate.
export const buildEdgePath = buildOrthogonalEdge

/**
 * Quadratic Bezier from a parent's edge point to a child's edge point in
 * radial layout. Control point sits between the two endpoints at radius
 * `(rParent + rChild) / 2`, which keeps the curve following the radial
 * direction rather than bowing perpendicular to it.
 *
 * `origin` is the position the radial center (r=0, the root) lives at in
 * the same coordinate system as `from`/`to`. After `layoutRadial`'s bbox
 * translation, that's not (0,0) anymore — without `origin`, the curve
 * bows toward the SVG corner instead of the actual root.
 */
export function buildRadialEdge(from, to, origin = { x: 0, y: 0 }) {
  const midR = (from.r + to.r) / 2
  // When the parent is at the radial origin its `angle` is meaningless
  // (any direction is "outward"). Use the child's angle directly so
  // root → leaf edges degenerate to a clean radial straight line instead
  // of bowing off-axis.
  const midA = from.r === 0 ? to.angle : (from.angle + to.angle) / 2
  const cx = origin.x + midR * Math.cos(midA)
  const cy = origin.y + midR * Math.sin(midA)
  return `M${fmt(from.x)},${fmt(from.y)} Q${fmt(cx)},${fmt(cy)} ${fmt(to.x)},${fmt(to.y)}`
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function naturalContentDims(node) {
  const textW = node.text ? Math.ceil(measureText(node.text)) : 0
  const hasImage = !!node.image
  let inner = textW
  if (hasImage) {
    inner = textW > 0 ? LAYOUT.IMG_SIZE + LAYOUT.IMG_GAP + textW : LAYOUT.IMG_SIZE
  }
  const rectW = inner + LAYOUT.PAD_X * 2
  const rectH = hasImage ? LAYOUT.IMG_SIZE + LAYOUT.PAD_Y * 2 : LAYOUT.NODE_H
  return { textW, rectW, rectH }
}

function annotate(node, depth, parentId, out, nextId) {
  node._id = nextId.n++
  node._depth = depth
  node._parentId = parentId
  out.push(node)
  for (const c of node.children) annotate(c, depth + 1, node._id, out, nextId)
}

function cloneTree(node) {
  return {
    text: node.text,
    image: node.image || null,
    children: node.children.map(cloneTree),
  }
}

function measureRectsAndEqualizeChildHeights(node) {
  const dims = naturalContentDims(node)
  node.textW = dims.textW
  node.rectW = dims.rectW
  node.rectH = dims.rectH
  for (const c of node.children) measureRectsAndEqualizeChildHeights(c)
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

function unionBboxOfNodes(nodes) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x - n.w / 2 < minX) minX = n.x - n.w / 2
    if (n.y - n.h / 2 < minY) minY = n.y - n.h / 2
    if (n.x + n.w / 2 > maxX) maxX = n.x + n.w / 2
    if (n.y + n.h / 2 > maxY) maxY = n.y + n.h / 2
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Translate every node by `(dx, dy)` so that downstream consumers (viewBox
 * starting at (0,0), edge endpoints) all share the same origin convention.
 */
function translateNodes(nodes, dx, dy) {
  for (const n of nodes) {
    n.x += dx
    n.y += dy
  }
}

// -----------------------------------------------------------------------------
// Orthogonal layout (LR / RL)
// -----------------------------------------------------------------------------

function positionY(node, topY) {
  node.y = topY + node.subtreeH / 2
  let cursor = topY
  for (const c of node.children) {
    positionY(c, cursor)
    cursor += c.subtreeH + LAYOUT.GAP_Y
  }
}

/**
 * LR / RL layout. Internally always lays out left-to-right (positive x grows
 * with depth); for `dir === 'rl'` the final pass mirrors x around the bbox
 * center so the root ends up on the right. Returns nodes / edges with
 * coordinates already in viewBox space (origin at (0,0)).
 */
function layoutOrthogonal(tree, { dir = 'lr' } = {}) {
  const root = cloneTree(tree)
  const flat = []
  annotate(root, 0, null, flat, { n: 0 })

  measureRectsAndEqualizeChildHeights(root)
  positionY(root, LAYOUT.PAD_T)

  // Per-depth width equalization.
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

  // Mirror around the bbox horizontal center for RL. We mirror BEFORE viewBox
  // translation so the post-pass still anchors to (0,0).
  if (dir === 'rl') {
    const bb = unionBboxOfNodes(nodes)
    const mid = (bb.minX + bb.maxX) / 2
    for (const n of nodes) n.x = 2 * mid - n.x
  }

  // Translate so bbox top-left lands at (PAD_L, PAD_T) — keeps the existing
  // top-left padding contract that the SVG renderer relies on.
  const bbox = unionBboxOfNodes(nodes)
  const dx = LAYOUT.PAD_L - bbox.minX
  const dy = LAYOUT.PAD_T - bbox.minY
  translateNodes(nodes, dx, dy)

  const edges = []
  for (const n of flat) {
    if (n._parentId === null) continue
    const parent = byId.get(n._parentId)
    const child = byId.get(n._id)
    // Anchor at the inner edge: parent's right + child's left (LR), or the
    // mirror (RL — parent's left + child's right).
    const parentSide = dir === 'rl' ? parent.x - parent.w / 2 : parent.x + parent.w / 2
    const childSide = dir === 'rl' ? child.x + child.w / 2 : child.x - child.w / 2
    edges.push({
      id: `e${parent.id}-${child.id}`,
      fromId: parent.id,
      toId: child.id,
      d: buildOrthogonalEdge(parentSide, parent.y, childSide, child.y, LAYOUT.CORNER_R),
    })
  }

  const finalBbox = unionBboxOfNodes(nodes)
  const width = finalBbox.maxX + LAYOUT.PAD_R
  const height = finalBbox.maxY + LAYOUT.PAD_B
  return { nodes, edges, viewBox: [0, 0, width, height] }
}

// -----------------------------------------------------------------------------
// Radial layout (subtree-local / "Gource-style")
// -----------------------------------------------------------------------------

function measureRadial(node) {
  const dims = naturalContentDims(node)
  node.textW = dims.textW
  node.rectW = dims.rectW
  node.rectH = dims.rectH
  node._leaves = node.children.length === 0 ? 1 : 0
  for (const c of node.children) {
    measureRadial(c)
    node._leaves += c._leaves
  }
}

/**
 * Allocate `totalSlice` radians among `children`, weighted by leaf count
 * with a MIN_ANGLE floor per child. If MIN_ANGLE × children overflows the
 * parent's slice we proportionally scale back rather than letting subtrees
 * walk across the whole ring — readability suffers below the floor, but
 * silent overlap with neighboring subtrees is the worse outcome.
 */
function allocateAngleSlices(children, totalSlice) {
  const totalLeaves = children.reduce((s, c) => s + c._leaves, 0)
  const minAngle = LAYOUT.MIN_ANGLE
  const natural = children.map((c) =>
    totalLeaves > 0 ? (c._leaves / totalLeaves) * totalSlice : totalSlice / children.length,
  )

  let usedByClamped = 0
  let unclampedLeaves = 0
  const final = natural.map((q, i) => {
    if (q < minAngle) {
      usedByClamped += minAngle
      return minAngle
    }
    unclampedLeaves += children[i]._leaves
    return null
  })
  const remaining = Math.max(0, totalSlice - usedByClamped)
  for (let i = 0; i < final.length; i++) {
    if (final[i] !== null) continue
    const c = children[i]
    final[i] =
      unclampedLeaves > 0
        ? (c._leaves / unclampedLeaves) * remaining
        : remaining / children.length
  }

  const totalAllocated = final.reduce((s, q) => s + q, 0)
  if (totalAllocated > totalSlice) {
    const scale = totalSlice / totalAllocated
    for (let i = 0; i < final.length; i++) final[i] *= scale
  }
  return final
}

/**
 * Distance from a parent's center to a child's center along the radial
 * direction.
 *
 * Two constraints, take the larger:
 *
 *   - Radial clearance: the parent's outer radius + RING_GAP + the child's
 *     outer radius, so the child never visually clips the parent at any
 *     angle (we use the half-diagonal as a worst-case outer radius).
 *   - Chord clearance: when the child has many siblings packed into a
 *     narrow wedge, an angularly-adjacent sibling sits at angular distance
 *     ≈ `sliceAngle` from this child. The chord between two centers at
 *     radius `d`, separated by angle `s`, is `2·d·sin(s/2)`. We need that
 *     chord to span at least the child's width plus a gap, otherwise
 *     siblings collide tangentially. Solving for `d` gives the formula
 *     below — narrow slices push the whole sibling fan outward.
 *
 * The chord branch is skipped for `sliceAngle ≥ π` (the parent has only
 * one child and gets the full hemisphere — there is no neighboring sibling
 * to collide with) to avoid a divide-by-zero at `sin(π/2) = 1`/`sin(π)=0`
 * and because the radial constraint already dominates in that case.
 */
function radialChildDistance(parent, child, sliceAngle) {
  const parentR = Math.hypot(parent.rectW, parent.rectH) / 2
  const childR = Math.hypot(child.rectW, child.rectH) / 2
  const baseDist = parentR + LAYOUT.RING_GAP + childR
  const half = sliceAngle / 2
  if (half <= 0 || half >= Math.PI / 2) return baseDist
  const minChord = child.rectW + LAYOUT.RING_GAP
  const chordDist = minChord / 2 / Math.sin(half)
  return Math.max(baseDist, chordDist)
}

/**
 * Recursively place `node`'s children. The children fan out in an angular
 * `sectorWidth` window centered on `outwardAngle` (the direction this
 * node was reached from its parent — for the root, the full 2π so the
 * first ring spreads all the way around).
 *
 * Each child inherits its allocated slice as its own sector, which keeps
 * the subtree's descendants confined to that wedge — siblings of different
 * subtrees can't overlap angularly, which is the property that prevents
 * deep branches from crashing into each other.
 */
function placeRadialSubtree(node, outwardAngle, sectorWidth) {
  if (node.children.length === 0) return

  const slices = allocateAngleSlices(node.children, sectorWidth)
  let cursor = outwardAngle - sectorWidth / 2
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    const slice = slices[i]
    const angle = cursor + slice / 2
    const dist = radialChildDistance(node, child, slice)
    child.x = node.x + dist * Math.cos(angle)
    child.y = node.y + dist * Math.sin(angle)
    child.angle = angle
    child.r = dist
    placeRadialSubtree(child, angle, slice)
    cursor += slice
  }
}

function layoutRadial(tree) {
  const root = cloneTree(tree)
  const flat = []
  annotate(root, 0, null, flat, { n: 0 })
  measureRadial(root)
  // Equalize child heights per parent for visual flush, same rule as LR/RL.
  for (const n of flat) {
    if (n.children.length > 0) {
      let maxChildH = 0
      for (const c of n.children) if (c.rectH > maxChildH) maxChildH = c.rectH
      for (const c of n.children) c.rectH = maxChildH
    }
  }

  // Root anchors the world origin; its `angle`/`r` carry no geometric
  // meaning, but the renderer expects the fields to exist on every node.
  root.x = 0
  root.y = 0
  root.angle = 0
  root.r = 0
  placeRadialSubtree(root, 0, Math.PI * 2)

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
    // `angle` is the direction from this node's PARENT (not the root) at
    // which it was placed; `r` is the distance from its parent. Both are
    // exposed for downstream code that wants to draw radial-aware
    // decorations, but the layout itself no longer assumes a shared origin.
    angle: n.angle,
    r: n.r,
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const bbox = unionBboxOfNodes(nodes)
  const dx = LAYOUT.RADIAL_PAD - bbox.minX
  const dy = LAYOUT.RADIAL_PAD - bbox.minY
  translateNodes(nodes, dx, dy)

  // Straight parent → child segments. The previous concentric-ring radial
  // used a quadratic bezier whose control point sat on the radial line
  // through the global origin; that geometry no longer applies because
  // children are now positioned relative to their parent rather than the
  // root, and a curve toward the global center would bow against the
  // visual tree direction.
  const edges = []
  for (const n of flat) {
    if (n._parentId === null) continue
    const parent = byId.get(n._parentId)
    const child = byId.get(n._id)
    edges.push({
      id: `e${parent.id}-${child.id}`,
      fromId: parent.id,
      toId: child.id,
      d: `M${fmt(parent.x)},${fmt(parent.y)} L${fmt(child.x)},${fmt(child.y)}`,
    })
  }

  const finalBbox = unionBboxOfNodes(nodes)
  const width = finalBbox.maxX + LAYOUT.RADIAL_PAD
  const height = finalBbox.maxY + LAYOUT.RADIAL_PAD
  return { nodes, edges, viewBox: [0, 0, width, height] }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

const KNOWN_LAYOUTS = new Set(['lr', 'rl', 'radial'])

/**
 * Compute layout for a mindmap tree. `options.layout` selects between the
 * orthogonal walker (LR / RL) and the radial walker. Unknown / missing
 * values fall back to `'lr'` so a stale frontend never explodes on a value
 * the backend introduced later.
 */
export function layoutMindmap(tree, options = {}) {
  const layout = KNOWN_LAYOUTS.has(options.layout) ? options.layout : 'lr'
  if (layout === 'radial') return layoutRadial(tree)
  return layoutOrthogonal(tree, { dir: layout })
}
