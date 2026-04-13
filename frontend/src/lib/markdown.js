/**
 * Centralized markdown rendering pipeline.
 *
 * Both the Viewer (MarkdownViewer.jsx) and anywhere else that needs to render
 * markdown to HTML go through this module. This replaces the previous hand-
 * rolled regex parser, which diverged from the Milkdown editor's CommonMark+GFM
 * semantics and had subtle bugs at edge cases (nested lists, tables inside
 * blockquotes, fenced code containing `:::`, etc.).
 *
 * Extensions we layer on top of CommonMark + GFM:
 *   - Callout blocks:   :::info / :::warning / :::tip / :::danger
 *   - Wikilinks:        [[slug]] and [[slug|display]]
 *   - Transclusion:     ![[slug]]
 *   - KaTeX:            inline `$...$` and block `$$...$$`
 *   - Mermaid:          ```mermaid code fences
 *   - Draw.io embed:    ::drawio[id]
 *   - GFM task lists:   - [ ] / - [x]
 */
import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import katex from 'katex'

const CALLOUT_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
}
const CALLOUT_TITLES = { info: 'Info', warning: 'Warning', tip: 'Tip', danger: 'Danger' }

function renderKatex(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false })
  } catch {
    const escaped = tex.replace(/[&<>"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    }[c]))
    return `<code class="katex-error">${escaped}</code>`
  }
}

// Count trailing backslashes at position `pos - 1` and below.
// Used to distinguish `\$` (escaped) from `\\$` (literal backslash then $).
function countPrecedingBackslashes(src, pos) {
  let n = 0
  let i = pos - 1
  while (i >= 0 && src.charCodeAt(i) === 0x5c /* \ */) {
    n++
    i--
  }
  return n
}

// ── Inline rule: KaTeX `$...$`
function mathInlineRule(state, silent) {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false
  // Avoid $$ (handled by block rule)
  if (state.src.charCodeAt(start + 1) === 0x24) return false
  // An odd number of preceding backslashes means the $ is escaped.
  if (countPrecedingBackslashes(state.src, start) % 2 === 1) return false

  // Find the closing $. Must be on the same line, and preceded by an
  // even number of backslashes (so `\$` is literal but `\\$` closes).
  let pos = start + 1
  let found = -1
  while (pos < state.posMax) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x0a /* \n */) return false
    if (ch === 0x24 && countPrecedingBackslashes(state.src, pos) % 2 === 0) {
      found = pos
      break
    }
    pos++
  }
  if (found === -1) return false
  if (found === start + 1) return false  // empty $$

  const content = state.src.slice(start + 1, found)
  if (!silent) {
    const token = state.push('math_inline', 'span', 0)
    token.content = content
    token.markup = '$'
  }
  state.pos = found + 1
  return true
}

// ── Block rule: KaTeX `$$...$$` (on its own lines)
function mathBlockRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  if (start + 1 >= max) return false
  if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) !== 0x24) return false
  if (silent) return true

  let nextLine = startLine
  let haveEndMarker = false
  const firstLineContent = state.src.slice(start + 2, max)

  // Same-line close: $$ inline $$
  if (firstLineContent.trim().endsWith('$$')) {
    const content = firstLineContent.trim().slice(0, -2).trim()
    const token = state.push('math_block', 'div', 0)
    token.block = true
    token.content = content
    token.markup = '$$'
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  }

  // Multi-line close
  for (;;) {
    nextLine++
    if (nextLine >= endLine) break
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
    const lineMax = state.eMarks[nextLine]
    const line = state.src.slice(lineStart, lineMax)
    if (line.trim() === '$$') {
      haveEndMarker = true
      break
    }
  }

  const contentLines = []
  if (firstLineContent.trim() !== '') contentLines.push(firstLineContent)
  for (let i = startLine + 1; i < nextLine; i++) {
    const s = state.bMarks[i] + state.tShift[i]
    const e = state.eMarks[i]
    contentLines.push(state.src.slice(s, e))
  }

  const token = state.push('math_block', 'div', 0)
  token.block = true
  token.content = contentLines.join('\n')
  token.markup = '$$'
  token.map = [startLine, nextLine + (haveEndMarker ? 1 : 0)]
  state.line = nextLine + (haveEndMarker ? 1 : 0)
  return true
}

// ── Inline rule: Wikilinks [[slug]] / [[slug|display]] / ![[slug]]
function wikilinkRule(state, silent) {
  const src = state.src
  const start = state.pos
  const isTransclusion = src.charCodeAt(start) === 0x21 /* ! */ && src.charCodeAt(start + 1) === 0x5b && src.charCodeAt(start + 2) === 0x5b
  const isWikilink = src.charCodeAt(start) === 0x5b /* [ */ && src.charCodeAt(start + 1) === 0x5b

  if (!isTransclusion && !isWikilink) return false

  const openLen = isTransclusion ? 3 : 2
  // Find the closing ]]
  const closeIdx = src.indexOf(']]', start + openLen)
  if (closeIdx === -1) return false
  // Disallow newlines inside wikilinks
  const inside = src.slice(start + openLen, closeIdx)
  if (inside.includes('\n')) return false
  if (inside.length === 0) return false

  if (!silent) {
    // Split on the FIRST `|` so display labels can themselves contain pipes.
    // `inside.split('|', 2)` in JS returns at most 2 elements (the second arg
    // is a limit, not a maxsplit), which silently drops anything after the
    // second pipe — not what we want.
    const pipeIdx = inside.indexOf('|')
    const slug = pipeIdx === -1 ? inside : inside.slice(0, pipeIdx)
    const display = pipeIdx === -1 ? slug : inside.slice(pipeIdx + 1)
    const token = state.push('wikilink', '', 0)
    token.meta = {
      slug: slug.trim(),
      display: display.trim(),
      transclusion: isTransclusion,
    }
  }

  state.pos = closeIdx + 2
  return true
}

// ── Inline rule: ::drawio[id]
function drawioRule(state, silent) {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x3a /* : */ || src.charCodeAt(start + 1) !== 0x3a) return false
  // Accept both ::drawio[123] and Milkdown-escaped ::drawio\[123\]
  const remainder = src.slice(start + 2)
  const m = remainder.match(/^drawio\\?\[(\d+)\\?\]/)
  if (!m) return false
  if (!silent) {
    const token = state.push('drawio', '', 0)
    token.meta = { id: m[1] }
  }
  state.pos = start + 2 + m[0].length
  return true
}

// CJK-safe slugify — preserves Unicode letters (so Chinese/Japanese/Korean
// headings get readable anchor ids). Spaces collapse to `-`, punctuation
// drops. Intentionally not lowercased because CJK has no case.
function slugifyHeading(text) {
  return text
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

// ── Core rule: inject unique id attrs on heading_open tokens so the TOC
// can jump to them via anchor scrolling.
function headingIdsRule(state) {
  const used = new Set()
  for (let i = 0; i < state.tokens.length; i++) {
    const tok = state.tokens[i]
    if (tok.type !== 'heading_open') continue
    const inline = state.tokens[i + 1]
    if (!inline || inline.type !== 'inline') continue
    const base = slugifyHeading(inline.content) || 'section'
    let slug = base
    let n = 1
    while (used.has(slug)) slug = `${base}-${n++}`
    used.add(slug)
    tok.attrSet('id', slug)
  }
}

// ── Core rule: promote `- [ ]` / `- [x]` paragraphs inside list items
// to rendered checkboxes. Runs after inline tokenization.
//
// Handles both "loose" lists (list_item_open → paragraph_open → inline) and
// "tight" lists, where markdown-it sets paragraph tokens' `hidden` flag and
// the first `inline` token sits directly after the list_item_open.
function taskListRule(state) {
  for (let i = 0; i < state.tokens.length - 1; i++) {
    if (state.tokens[i].type !== 'list_item_open') continue

    // Find the first `inline` token belonging to this list item.
    let inline = null
    for (let j = i + 1; j < state.tokens.length; j++) {
      const t = state.tokens[j]
      if (t.type === 'inline') { inline = t; break }
      if (t.type === 'list_item_close' || t.type === 'list_item_open') break
      // Skip over paragraph_open / paragraph_close tokens (tight or loose)
      if (t.type !== 'paragraph_open' && t.type !== 'paragraph_close') break
    }
    if (!inline) continue

    const children = inline.children
    if (!children || children.length === 0) continue
    const first = children[0]
    if (first.type !== 'text') continue
    const match = first.content.match(/^\[([ xX])\]\s+/)
    if (!match) continue

    const checked = match[1] !== ' '
    first.content = first.content.slice(match[0].length)
    inline.content = inline.content.slice(match[0].length)
    state.tokens[i].attrJoin('class', 'task-list-item')
    const checkboxToken = new state.Token('html_inline', '', 0)
    checkboxToken.content = `<input type="checkbox" ${checked ? 'checked ' : ''}disabled /> `
    children.unshift(checkboxToken)
  }
}

// ── Factory
export function createMarkdown() {
  const md = new MarkdownIt({
    html: false,        // don't allow raw HTML (we still sanitize downstream)
    linkify: true,
    breaks: false,
    typographer: false,
  })

  // GFM features: tables and strikethrough are already enabled in markdown-it
  // by default. Task lists we handle below.

  // Callouts
  for (const type of ['info', 'warning', 'tip', 'danger']) {
    md.use(container, type, {
      render: (tokens, idx) => {
        if (tokens[idx].nesting === 1) {
          return (
            `<div class="callout callout-${type}">` +
            `<div class="callout-title">` +
            `<span class="callout-icon">${CALLOUT_ICONS[type]}</span>` +
            `${CALLOUT_TITLES[type]}` +
            `</div>` +
            `<div class="callout-body">\n`
          )
        }
        return `</div></div>\n`
      },
    })
  }

  // Math
  md.block.ruler.before('fence', 'math_block', mathBlockRule)
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule)
  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="katex-inline">${renderKatex(tokens[idx].content.trim(), false)}</span>`
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="katex-block">${renderKatex(tokens[idx].content.trim(), true)}</div>`

  // Wikilinks (must run before `link` so `[[` isn't consumed as `[`)
  md.inline.ruler.before('link', 'wikilink', wikilinkRule)
  md.renderer.rules.wikilink = (tokens, idx) => {
    const { slug, display, transclusion } = tokens[idx].meta
    const safeSlug = md.utils.escapeHtml(slug)
    const safeDisplay = md.utils.escapeHtml(display)
    if (transclusion) {
      return (
        `<div class="transclusion">` +
        `<div class="transclusion-header"><a href="/page/${safeSlug}" class="wikilink transclusion-link">📄 ${safeDisplay}</a></div>` +
        `<div class="transclusion-content" data-transclude="${safeSlug}">Loading...</div>` +
        `</div>`
      )
    }
    return `<a href="/page/${safeSlug}" class="wikilink">${safeDisplay}</a>`
  }

  // Draw.io directive
  md.inline.ruler.before('link', 'drawio', drawioRule)
  md.renderer.rules.drawio = (tokens, idx) => {
    const { id } = tokens[idx].meta
    return `<div class="drawio-embed" data-diagram-id="${id}"><div class="drawio-placeholder">Loading Draw.io diagram #${id}...</div></div>`
  }

  // Mermaid: override fence rendering
  const defaultFence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = (token.info || '').trim()
    const lang = info.split(/\s+/)[0] || ''
    if (lang === 'mermaid') {
      return `<div class="mermaid-block" data-mermaid="${encodeURIComponent(token.content.trim())}"><pre class="mermaid-loading">Loading diagram...</pre></div>`
    }
    return defaultFence(tokens, idx, options, env, self)
  }

  // Task lists — core rule that runs once the full token list exists
  md.core.ruler.after('inline', 'task_lists', taskListRule)

  // Heading ids — after inline so inline.content is populated
  md.core.ruler.after('inline', 'heading_ids', headingIdsRule)

  // Open external links in a new tab (relative/wiki links kept as-is)
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = tokens[idx].attrGet('href') || ''
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('rel', 'noopener noreferrer')
    }
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  return md
}

// Singleton — markdown-it is stateless across renders, and reconstructing it
// per-call would waste ~10ms in typical wiki pages.
const singletonMd = createMarkdown()

export function renderMarkdown(source) {
  if (!source) return ''
  return singletonMd.render(source)
}
