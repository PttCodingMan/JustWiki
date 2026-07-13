/**
 * V2 markdown renderer — single remark-based pipeline, shared with the
 * Milkdown editor's parsers.
 *
 * This is the long-term replacement for ``lib/markdown.js`` (the markdown-it
 * pipeline). Both render paths today have to implement every custom syntax
 * twice (`[[wikilink]]`, callouts, ``::drawio[id]`` etc.) and have already
 * drifted once — see the comment at the top of ``markdown.js``. Going forward
 * the editor and the viewer share the same parser plugins (located in
 * ``lib/markdown/plugins/``); only the *render* half differs (ProseMirror
 * node views vs. HTML output).
 *
 * Currently behind a localStorage flag (``markdown.v2 === 'true'``) so we can
 * dogfood it without flipping the default. Once the golden tests in
 * ``markdown.test.js`` all pass against this pipeline, this module replaces
 * ``markdown.js`` and the flag goes away.
 *
 * Known Phase-B drift vs. v1 (must be closed before flipping the default,
 * tracked by `it.todo` cases in render-v2.test.js):
 *
 * 1. Wikilink display text containing markdown emphasis loses its wrapper.
 *    ``[[slug|**bold**]]`` works in v1; v2's `findAndReplace` only sees
 *    text nodes after CommonMark already split `**…**` out, so the
 *    `[[…]]` span isn't recognised. Needs a true micromark inline
 *    construct or a pre-parse tokeniser.
 *
 * 2. Inline ``::drawio[id]`` mid-paragraph and the Milkdown-escaped form
 *    ``::drawio\[id\]`` only render in v1. v2 relies on remark-directive's
 *    grammar (`:name[arg]` text directive vs. `::name[arg]` leaf
 *    directive), which doesn't match v1's anywhere-in-inline scan.
 *
 * 3. Unknown ``:::name`` blocks render as a generic ``<div>`` in v2 but
 *    pass through as literal text in v1. Currently low-impact because
 *    nothing in the wiki uses non-callout `:::` directives, but the
 *    fallback handler returns a wrapper rather than letting the source
 *    fall through.
 *
 * Custom output produced (kept byte-compatible with the v1 renderer where
 * possible so Viewer post-render JS — Mermaid bootstrap, transclusion fetch,
 * draw.io embed — keeps working without changes):
 *
 *   wikilink          → <a class="wikilink" href="/page/{slug}">{display}</a>
 *   transclusion      → <div class="transclusion">…<div data-transclude="{slug}">…</div></div>
 *   mention (user)    → <a class="mention mention-user" data-user="…" href="/u/…">@name</a>
 *   mention (group)   → <span class="mention mention-group" data-group="…">@@name</span>
 *   callouts          → <div class="callout callout-{type}">…</div>
 *   $math$ / $$math$$ → server-rendered KaTeX (rehype-katex)
 *   mermaid fence     → <div class="mermaid-block" data-mermaid="{encoded}">…</div>
 *   ::drawio[id]      → <div class="drawio-embed" data-diagram-id="{id}">…</div>
 *   external links    → target="_blank" rel="noopener noreferrer"
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'

import { remarkWikilinkPlugin } from './plugins/wikilink'
import { remarkMentionPlugin } from './plugins/mention'
import { CALLOUT_TITLES } from '../calloutTitles'

const CALLOUT_TYPES = new Set(['info', 'warning', 'tip', 'danger'])

// Inline SVGs kept identical to the v1 renderer's output so styling stays
// pixel-stable when toggling the flag.
const CALLOUT_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
}

// ── Custom remark plugins ──────────────────────────────────────────────────

// remark-directive parses `:::info … :::` into a `containerDirective` node
// and `::drawio[id]` into a `textDirective` / `leafDirective`. We don't
// need to mutate those mdast nodes — the rehype handlers below match on
// `containerDirective` / `textDirective` directly. Unknown directive names
// fall through to a default generic <div> via remark-rehype.

/**
 * Mark http(s) links so the rehype handler emits target=_blank rel=noopener.
 * Done in mdast (not as a rehype handler) because remark-rehype's default
 * link handler is what produces the <a>; we just want to add attrs.
 */
function remarkExternalLinkAttrs() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      const url = node.url || ''
      if (!/^https?:\/\//i.test(url)) return
      const data = node.data || (node.data = {})
      const props = data.hProperties || (data.hProperties = {})
      props.target = '_blank'
      props.rel = 'noopener noreferrer'
    })
  }
}

/**
 * Inject `id="…"` attributes on headings, CJK-safe.
 *
 * Mirror of v1's slugifyHeading: lowercased, Unicode letters preserved,
 * spaces collapsed to `-`, all other punctuation dropped. Duplicates get
 * `-1`, `-2`, …
 */
function remarkHeadingIds() {
  return (tree) => {
    const used = new Set()
    visit(tree, 'heading', (node) => {
      const text = headingText(node)
      const base = slugifyHeading(text) || 'section'
      let slug = base
      let n = 1
      while (used.has(slug)) slug = `${base}-${n++}`
      used.add(slug)
      const data = node.data || (node.data = {})
      const props = data.hProperties || (data.hProperties = {})
      props.id = slug
    })
  }
}

function headingText(node) {
  let out = ''
  visit(node, (child) => {
    // Include math node values (the raw TeX source). v1 slugifies the
    // raw markdown source including `$mc^2$`, so a heading like
    // `# E = $mc^2$` produces id="e-mc2" in v1 — we need to match.
    if (
      child.type === 'text' ||
      child.type === 'inlineCode' ||
      child.type === 'inlineMath' ||
      child.type === 'math'
    ) {
      out += child.value || ''
    }
  })
  return out
}

function slugifyHeading(text) {
  return text
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

// ── Rehype handlers (mdast → hast) ─────────────────────────────────────────

function drawioDirectiveHandler(state, node) {
  if (node.name !== 'drawio') {
    // Unknown text/leaf directive — let remark-rehype's default handler
    // (a generic span/div) win by returning undefined.
    return undefined
  }
  const id = (node.children?.[0]?.value || '').trim()
  if (!/^\d+$/.test(id)) return undefined
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: ['drawio-embed'], dataDiagramId: id },
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: { className: ['drawio-placeholder'] },
        children: [
          { type: 'text', value: `Loading Draw.io diagram #${id}...` },
        ],
      },
    ],
  }
}

const handlers = {
  wikilink(state, node) {
    const slug = node.slug || ''
    const display = node.display || slug
    if (node.transclusion) {
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['transclusion'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['transclusion-header'] },
            children: [
              {
                type: 'element',
                tagName: 'a',
                properties: {
                  href: `/page/${slug}`,
                  className: ['wikilink', 'transclusion-link'],
                },
                children: [{ type: 'text', value: `📄 ${display}` }],
              },
            ],
          },
          {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['transclusion-content'],
              dataTransclude: slug,
            },
            children: [{ type: 'text', value: 'Loading...' }],
          },
        ],
      }
    }
    return {
      type: 'element',
      tagName: 'a',
      properties: { href: `/page/${slug}`, className: ['wikilink'] },
      children: [{ type: 'text', value: display }],
    }
  },
  mention(state, node) {
    const name = node.name || ''
    if (node.group) {
      return {
        type: 'element',
        tagName: 'span',
        properties: {
          className: ['mention', 'mention-group'],
          dataGroup: name,
        },
        children: [{ type: 'text', value: `@@${name}` }],
      }
    }
    return {
      type: 'element',
      tagName: 'a',
      properties: {
        href: `/u/${name}`,
        className: ['mention', 'mention-user'],
        dataUser: name,
      },
      children: [{ type: 'text', value: `@${name}` }],
    }
  },
  containerDirective(state, node) {
    if (!CALLOUT_TYPES.has(node.name)) {
      // Unrecognised :::name block — emit a generic div so it's still
      // visible (matches remark-directive's default fallback shape).
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: [`directive-${node.name || 'unknown'}`] },
        children: state.all(node),
      }
    }
    const type = node.name
    const title = CALLOUT_TITLES[type] || type
    return {
      type: 'element',
      tagName: 'div',
      properties: { className: ['callout', `callout-${type}`] },
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['callout-title'] },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['callout-icon'] },
              children: [{ type: 'raw', value: CALLOUT_ICONS[type] || '' }],
            },
            { type: 'text', value: title },
          ],
        },
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['callout-body'] },
          children: state.all(node),
        },
      ],
    }
  },
  textDirective: drawioDirectiveHandler,
  leafDirective: drawioDirectiveHandler,
  // Mermaid: replace the default code-block handler when info === 'mermaid'.
  code(state, node) {
    const lang = (node.lang || '').trim().toLowerCase()
    if (lang === 'mermaid') {
      const encoded = encodeURIComponent((node.value || '').trim())
      return {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid-block'], dataMermaid: encoded },
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: { className: ['mermaid-loading'] },
            children: [{ type: 'text', value: 'Loading diagram...' }],
          },
        ],
      }
    }
    // Defer to the default code handler for everything else. remark-rehype
    // doesn't expose it directly, so reproduce the small bit we need:
    // <pre><code class="language-…">…</code></pre>
    const className = lang ? [`language-${lang}`] : []
    return {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className },
          children: [{ type: 'text', value: node.value || '' }],
        },
      ],
    }
  },
}

// ── Pipeline ───────────────────────────────────────────────────────────────

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective)
  .use(remarkWikilinkPlugin)
  .use(remarkMentionPlugin)
  .use(remarkExternalLinkAttrs)
  .use(remarkHeadingIds)
  .use(remarkRehype, {
    handlers,
    // Allow our raw SVG strings (callout icons) through. The Viewer still
    // sanitises the final HTML via DOMPurify, so this isn't an XSS hole.
    allowDangerousHtml: true,
  })
  .use(rehypeKatex)
  .use(rehypeStringify, { allowDangerousHtml: true })

export function renderMarkdownV2(source) {
  if (!source) return ''
  return String(processor.processSync(source))
}

// ── Flag plumbing ─────────────────────────────────────────────────────────

/**
 * Returns true when the user has opted into the v2 renderer for this
 * browser session (set ``localStorage.setItem('markdown.v2', 'true')``).
 *
 * Read at every render call rather than cached so toggling in DevTools
 * takes effect on the next navigation without a full reload.
 */
export function isV2Enabled() {
  try {
    return globalThis.localStorage?.getItem('markdown.v2') === 'true'
  } catch {
    // SSR / restricted environments — fall back to v1.
    return false
  }
}
