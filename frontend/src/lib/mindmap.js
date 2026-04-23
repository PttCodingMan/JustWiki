/**
 * Deterministic markdown → tree parser for `page_type='mindmap'` pages.
 *
 * The layout + SVG rendering lives in `mindmapLayout.js` and `MindmapView`;
 * this module's only job is to turn markdown prose into a nested
 * `{ text, children }` tree, choosing between the heading strategy and the
 * bullet-list fallback, clamping level jumps, and sanitizing node text.
 */
import MarkdownIt from 'markdown-it'

const MAX_BULLET_DEPTH = 4
const MAX_NODE_TEXT = 30

// Node labels render inside an SVG <text> element, so there is no HTML/Mermaid
// grammar to escape. We still normalize a few characters for visual cleanliness:
// paired CJK quotes and typographic brackets usually belong in prose, not in a
// mindmap node. Left untouched: parentheses, ASCII brackets, braces, commas,
// and anything else a reader might legitimately want in a node label.
const SANITIZE_STRIP_CHARS = /[「」『』]/g

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
 * Given items with a `level` field (higher = deeper), return a list of
 * `{ text, level, parent }` entries with each item's parent index resolved via
 * a stack. Level jumps are clamped so no child is more than one level deeper
 * than the running top-of-stack (prevents phantom intermediate levels when
 * authors skip from H2 to H4).
 */
function buildLinearTree(items) {
  if (items.length === 0) return []
  const minLevel = Math.min(...items.map((i) => i.level))
  const tree = []
  const stack = [] // entries: { index, level }
  for (const item of items) {
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
 * Attach a list of `{text, level, parent}` nodes as descendants of `root`,
 * producing the nested `{ text, children }` shape the layout walker expects.
 */
function attachToRoot(rootText, nodes) {
  const root = { text: rootText, children: [] }
  const refs = nodes.map((n) => ({ text: n.text, children: [] }))
  for (let i = 0; i < nodes.length; i++) {
    const parent = nodes[i].parent == null ? root : refs[nodes[i].parent]
    parent.children.push(refs[i])
  }
  return root
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
  return attachToRoot(root, buildLinearTree(rest))
}

function buildFromBullets(bullets, title) {
  if (bullets.length === 0) return null
  const capped = bullets.filter((b) => b.depth <= MAX_BULLET_DEPTH)
  if (capped.length === 0) return null
  const rootTitle = sanitize(title || '') || 'Mindmap'
  const items = capped.map((b) => ({ level: b.depth, text: b.text }))
  return attachToRoot(rootTitle, buildLinearTree(items))
}

/**
 * Parse markdown into a nested mindmap tree. Returns `{ text, children }`;
 * throws `MindmapParseError` when the document has no heading or bullet
 * structure to map onto a tree.
 */
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
