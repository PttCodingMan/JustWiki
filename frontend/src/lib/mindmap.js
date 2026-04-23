/**
 * Deterministic markdown → Mermaid tree renderer.
 *
 * Pages with page_type = 'mindmap' are plain markdown documents; this module
 * produces a Mermaid `flowchart LR` from heading hierarchy (or bullet lists
 * as fallback). The resulting diagram is an orthogonal left-to-right tree,
 * not Mermaid's built-in `mindmap` type — flowchart with `curve: stepBefore`
 * draws right-angle edges so siblings align vertically in columns, matching
 * the org-chart / dendrogram style the wiki's UX calls for.
 *
 * Layout responsibilities:
 *   - Node shape / text wrapping     → this module
 *   - Per-level class assignment     → this module (level-0..level-4)
 *   - Concrete colors for each class → MindmapView (reads CSS vars at
 *     render time so the mindmap follows the active wiki theme)
 *   - Edge routing                   → Mermaid's `flowchart.curve` init
 */
import MarkdownIt from 'markdown-it'

const MAX_BULLET_DEPTH = 4
const MAX_NODE_TEXT = 30

// Mermaid label grammar is brittle around these characters; strip them so
// `["…"]` labels always parse. CJK quote marks render poorly in boxed nodes,
// so they go too. We deliberately do NOT strip `<>&=` — Mermaid's strict
// securityLevel runs DOMPurify over labels and handles script injection.
const SANITIZE_STRIP_CHARS = /[()[\]{}":;,、。「」『』]/g

export class MindmapParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MindmapParseError'
  }
}

const md = new MarkdownIt({ html: false, linkify: false })

function inlineText(inlineToken) {
  if (!inlineToken || !Array.isArray(inlineToken.children)) return ''
  let out = ''
  for (const child of inlineToken.children) {
    if (child.type === 'text' || child.type === 'code_inline') {
      out += child.content
    } else if (child.type === 'softbreak' || child.type === 'hardbreak') {
      out += ' '
    }
  }
  return out
}

export function sanitize(text) {
  let out = String(text).replace(/\s+/g, ' ').replace(SANITIZE_STRIP_CHARS, '').trim()
  if (out.length > MAX_NODE_TEXT) out = `${out.slice(0, MAX_NODE_TEXT - 1)}…`
  return out
}

function escapeLabel(text) {
  // Flowchart labels accept `["text"]`. Double-quotes inside need HTML
  // entity encoding because Mermaid's parser does not have a backslash
  // escape for `"` inside the brackets form.
  return `["${text.replace(/"/g, '&quot;')}"]`
}

function collectHeadings(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== 'heading_open') continue
    const level = Number(t.tag.slice(1))
    const inline = tokens[i + 1]
    const text = sanitize(inlineText(inline))
    if (text) out.push({ level, text })
  }
  return out
}

function collectBullets(tokens) {
  const out = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'bullet_list_open') depth += 1
    else if (t.type === 'bullet_list_close') depth -= 1
    else if (t.type === 'list_item_open') {
      for (let j = i + 1; j < tokens.length; j++) {
        const inner = tokens[j]
        if (inner.type === 'inline') {
          const text = sanitize(inlineText(inner))
          if (text) out.push({ depth, text })
          break
        }
        if (inner.type === 'list_item_close') break
      }
    }
  }
  return out
}

/**
 * Given items with a `level` field (higher = deeper), assign each one a
 * parent index using a stack, and clamp level jumps so that no child is
 * more than one level deeper than the running top-of-stack. Returns a list
 * of `{ text, parent }` entries (`parent` is null for the first item).
 */
function buildTree(items) {
  if (items.length === 0) return []
  const minLevel = Math.min(...items.map((i) => i.level))
  const tree = []
  const stack = [] // entries: { index, level }
  for (const item of items) {
    // Normalize + clamp so skip-level headings don't create phantom levels.
    const normalized = item.level - minLevel
    const lvl = stack.length === 0 ? 0 : Math.min(normalized, stack[stack.length - 1].level + 1)
    while (stack.length > 0 && stack[stack.length - 1].level >= lvl) stack.pop()
    const parentIndex = stack.length === 0 ? null : stack[stack.length - 1].index
    const index = tree.length
    tree.push({ text: item.text, level: lvl, parent: parentIndex })
    stack.push({ index, level: lvl })
  }
  return tree
}

/**
 * Emit the final `flowchart LR` source from a tree with a fixed root.
 * Nodes are assigned ids `n0..nK` and level-based classes (`lv0..lv4+`)
 * so MindmapView can style them from the wiki theme at render time.
 */
function emitFlowchart(rootText, children) {
  const lines = [
    '%%{init: {"flowchart":{"curve":"stepBefore","htmlLabels":true}}}%%',
    'flowchart LR',
    `  n0${escapeLabel(rootText)}:::lv0`,
  ]
  const edges = []
  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    const id = `n${i + 1}`
    const cls = `lv${Math.min(c.level + 1, 4)}`
    lines.push(`  ${id}${escapeLabel(c.text)}:::${cls}`)
    const parentId = c.parent == null ? 'n0' : `n${c.parent + 1}`
    edges.push(`  ${parentId} --> ${id}`)
  }
  return [...lines, ...edges].join('\n')
}

function buildFromHeadings(headings, title) {
  if (headings.length === 0) return null
  const rootTitle = sanitize(title || '') || 'Mindmap'
  let root, rest
  const h1s = headings.filter((h) => h.level === 1)
  if (h1s.length === 1 && headings[0].level === 1) {
    root = h1s[0].text
    rest = headings.slice(1)
  } else {
    root = rootTitle
    rest = headings
  }
  if (rest.length === 0) return null
  return emitFlowchart(root, buildTree(rest))
}

function buildFromBullets(bullets, title) {
  if (bullets.length === 0) return null
  const capped = bullets.filter((b) => b.depth <= MAX_BULLET_DEPTH)
  if (capped.length === 0) return null
  const rootTitle = sanitize(title || '') || 'Mindmap'
  const items = capped.map((b) => ({ level: b.depth, text: b.text }))
  return emitFlowchart(rootTitle, buildTree(items))
}

export function renderMindmap(content, title = '') {
  const tokens = md.parse(content || '', {})
  const headings = collectHeadings(tokens)
  const fromHeadings = buildFromHeadings(headings, title)
  if (fromHeadings) return fromHeadings

  const fallbackTitle =
    headings.length === 1 && headings[0].level === 1 ? headings[0].text : title
  const bullets = collectBullets(tokens)
  const fromBullets = buildFromBullets(bullets, fallbackTitle)
  if (fromBullets) return fromBullets

  throw new MindmapParseError(
    '心智圖頁面需要至少包含 heading 或 bullet list 結構',
  )
}

export const MINDMAP_TEMPLATE = `# Mindmap 主題

## 分支一

### 子節點 1.1
### 子節點 1.2

## 分支二

### 子節點 2.1
### 子節點 2.2
`
