import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown(null)).toBe('')
    expect(renderMarkdown(undefined)).toBe('')
  })

  it('renders basic headings and paragraphs', () => {
    const html = renderMarkdown('# Title\n\nHello world')
    expect(html).toContain('<h1 id="title">Title</h1>')
    expect(html).toContain('<p>Hello world</p>')
  })

  it('injects unique heading ids for the TOC, including CJK', () => {
    const html = renderMarkdown('# Hello World\n\n## 中文標題\n\n## Hello World')
    expect(html).toContain('<h1 id="hello-world">Hello World</h1>')
    expect(html).toContain('<h2 id="中文標題">中文標題</h2>')
    // Duplicate slug gets a numeric suffix
    expect(html).toContain('<h2 id="hello-world-1">Hello World</h2>')
  })

  it('renders GFM strikethrough and task lists', () => {
    const html = renderMarkdown('~~old~~\n\n- [x] done\n- [ ] todo')
    expect(html).toContain('<s>old</s>')
    expect(html).toContain('task-list-item')
    expect(html).toContain('<input type="checkbox" checked disabled /> done')
    expect(html).toContain('<input type="checkbox" disabled /> todo')
  })

  it('renders tables', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders fenced code blocks with language class', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```')
    expect(html).toContain('<code class="language-js">')
    expect(html).toContain('const x = 1')
  })

  it('treats mermaid fence as a mermaid block', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```')
    expect(html).toContain('class="mermaid-block"')
    expect(html).toContain('data-mermaid=')
    expect(html).toContain('graph%20TD')
  })

  it('renders info/warning/tip/danger callouts', () => {
    const html = renderMarkdown(':::info\nHello\n:::')
    expect(html).toContain('class="callout callout-info"')
    expect(html).toContain('<p>Hello</p>')

    const warning = renderMarkdown(':::warning\nBe careful\n:::')
    expect(warning).toContain('class="callout callout-warning"')
  })

  it('renders wikilinks [[slug]] and [[slug|display]]', () => {
    const plain = renderMarkdown('See [[hello]] for more')
    expect(plain).toContain('<a href="/page/hello" class="wikilink">hello</a>')

    const aliased = renderMarkdown('See [[hello|Hello Page]] for more')
    expect(aliased).toContain('<a href="/page/hello" class="wikilink">Hello Page</a>')
  })

  it('renders transclusion ![[slug]]', () => {
    const html = renderMarkdown('![[embedded-page]]')
    expect(html).toContain('class="transclusion"')
    expect(html).toContain('data-transclude="embedded-page"')
  })

  it('renders KaTeX inline and block math', () => {
    const inline = renderMarkdown('Einstein said $E = mc^2$ is famous')
    expect(inline).toContain('katex-inline')
    // KaTeX outputs a <span class="katex"> wrapper
    expect(inline).toContain('katex')

    const block = renderMarkdown('$$\n\\int_0^1 x dx\n$$')
    expect(block).toContain('katex-block')
  })

  it('does not parse KaTeX inside code blocks', () => {
    const html = renderMarkdown('```\n$E=mc^2$\n```')
    // Inside a code fence, the dollar sign stays literal
    expect(html).toContain('$E=mc^2$')
    expect(html).not.toContain('katex-inline')
  })

  it('renders draw.io directive', () => {
    const html = renderMarkdown('::drawio[42]')
    expect(html).toContain('class="drawio-embed"')
    expect(html).toContain('data-diagram-id="42"')
  })

  it('handles nested lists and bold/italic', () => {
    const html = renderMarkdown('- **bold** item\n  - *italic* child\n- second')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    // nested list should actually nest
    expect(html.match(/<ul>/g)?.length).toBe(2)
  })

  it('adds target=_blank to external links only', () => {
    const html = renderMarkdown('[ext](https://example.com) and [local](/page/foo)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    // Local link should not have target=_blank
    const localMatch = html.match(/<a href="\/page\/foo"[^>]*>/)
    expect(localMatch?.[0]).not.toContain('target')
  })

  it('escapes HTML in user content', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('preserves code block contents including `:::` and `[[`', () => {
    const src = '```\n:::info\n[[not a wikilink]]\n:::\n```'
    const html = renderMarkdown(src)
    // Callouts should not be parsed inside a fence
    expect(html).not.toContain('callout-info')
    expect(html).toContain('[[not a wikilink]]')
  })

  it('blockquotes contain nested markdown', () => {
    const html = renderMarkdown('> **bold** quote')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<strong>bold</strong>')
  })

  // ── Edge cases surfaced by review ──

  it('treats \\$ as escaped (no math), \\\\$ as literal backslash then delimiter', () => {
    const escaped = renderMarkdown('Use \\$5 dollars')
    expect(escaped).not.toContain('katex-inline')
    expect(escaped).toContain('$5 dollars')
  })

  it('does not collapse wikilink display labels that contain pipes', () => {
    const html = renderMarkdown('[[slug|Label with | a pipe]]')
    expect(html).toContain('<a href="/page/slug" class="wikilink">Label with | a pipe</a>')
  })

  it('handles task lists even when written tight (no blank lines)', () => {
    const html = renderMarkdown('- [ ] one\n- [x] two\n- [ ] three')
    const taskMatches = html.match(/task-list-item/g) || []
    expect(taskMatches.length).toBe(3)
    expect(html).toContain('<input type="checkbox" disabled /> one')
    expect(html).toContain('<input type="checkbox" checked disabled /> two')
  })

  it('does not misparse KaTeX across newlines', () => {
    const html = renderMarkdown('price is $5\nand $10 over two lines')
    // Unmatched single dollar should not start math mode across a newline
    expect(html).not.toContain('katex-inline')
  })

  // ── <br> whitelist (Milkdown's empty-paragraph round-trip) ──

  it('renders standalone <br /> between blocks as a visible line break', () => {
    // Milkdown's `remarkPreserveEmptyLinePlugin` serializes empty paragraphs
    // as `<br />`. Without the whitelist rule the viewer would show the
    // literal "&lt;br /&gt;" text instead of a blank line.
    const html = renderMarkdown('first\n\n<br />\n\nsecond')
    expect(html).toContain('<br>')
    expect(html).not.toContain('&lt;br')
    expect(html).toContain('<p>first</p>')
    expect(html).toContain('<p>second</p>')
  })

  it('accepts <br>, <br/>, <br />, and the uppercase form', () => {
    for (const form of ['<br>', '<br/>', '<br />', '<br    />', '<BR>', '<Br />']) {
      const html = renderMarkdown(`a\n\n${form}\n\nb`)
      expect(html).toContain('<br>')
      expect(html).not.toContain('&lt;')
    }
  })

  it('does NOT match prefixes that only look like <br (e.g. <brx>, <br-foo>)', () => {
    const a = renderMarkdown('<brx>')
    expect(a).toContain('&lt;brx&gt;')
    expect(a).not.toContain('<br>')

    const b = renderMarkdown('<br-foo>')
    expect(b).toContain('&lt;br-foo&gt;')
  })

  it('does NOT match unclosed <br variants', () => {
    // Dangling `<br` at end of input, or `<br/` missing `>`, should fall
    // through to markdown-it's default text handling (escaped).
    const a = renderMarkdown('trailing <br')
    expect(a).toContain('&lt;br')
    expect(a).not.toMatch(/<br>/)

    const b = renderMarkdown('trailing <br/ and more')
    expect(b).toContain('&lt;br/')
    expect(b).not.toMatch(/<br>/)
  })

  it('matches multiple <br /> occurrences inside the same paragraph', () => {
    const html = renderMarkdown('alpha<br>beta<br />gamma<br/>delta')
    const brs = html.match(/<br>/g) || []
    expect(brs.length).toBe(3)
    expect(html).toContain('alpha')
    expect(html).toContain('delta')
  })

  it('respects backslash-escaped \\<br /> (escape rule wins)', () => {
    // markdown-it's built-in `escape` rule consumes `\<` as literal `<`, which
    // means brRule never sees the tag. Regression guard for rule ordering.
    const html = renderMarkdown('literal \\<br /> tag')
    expect(html).toContain('&lt;br /&gt;')
    expect(html).not.toMatch(/<br>/)
  })

  it('renders inline <br /> inside a paragraph as a line break', () => {
    const html = renderMarkdown('line one<br />line two')
    expect(html).toContain('line one<br>')
    expect(html).toContain('line two')
    expect(html).not.toContain('&lt;br')
  })

  it('renders consecutive <br /> lines as multiple line breaks', () => {
    // When users press Enter several times Milkdown emits one <br /> per
    // empty paragraph. Each should survive to the viewer.
    const html = renderMarkdown('a\n\n<br />\n\n<br />\n\n<br />\n\nb')
    const brMatches = html.match(/<br>/g) || []
    expect(brMatches.length).toBe(3)
  })

  it('does NOT whitelist <br> with attributes (security)', () => {
    // Anything the rule doesn't recognize must fall through to markdown-it's
    // default handling, which escapes raw HTML because `html: false`.
    const attr = renderMarkdown('<br onclick="x">')
    expect(attr).not.toContain('<br onclick')
    expect(attr).toContain('&lt;br onclick')

    const cls = renderMarkdown('<br class="foo">')
    expect(cls).not.toContain('<br class')
    expect(cls).toContain('&lt;br class')
  })

  it('does NOT whitelist other HTML tags (regression guard)', () => {
    const html = renderMarkdown('<div>x</div> and <span>y</span>')
    expect(html).not.toContain('<div>')
    expect(html).not.toContain('<span>')
    expect(html).toContain('&lt;div&gt;')
    expect(html).toContain('&lt;span&gt;')
  })

  it('keeps <br /> literal inside code fences and inline code', () => {
    const fence = renderMarkdown('```\n<br />\n```')
    expect(fence).toContain('&lt;br /&gt;')
    expect(fence).not.toMatch(/<br>(?!\/)/)  // no rendered <br> element

    const inline = renderMarkdown('inline `<br />` code')
    expect(inline).toContain('<code>&lt;br /&gt;</code>')
  })

  it('escapes HTML comment syntax rather than emitting raw comments', () => {
    // The backend's /api/public endpoint strips comments entirely before
    // sending; the frontend parser runs with `html: false` so any leftover
    // comment syntax is escaped to &lt;!-- ... --&gt; and cannot render
    // as an HTML comment node. This is the defense-in-depth regression guard
    // for the public read-only flow.
    const html = renderMarkdown('visible\n<!-- secret note -->\nmore')
    expect(html).not.toContain('<!--')
    expect(html).not.toContain('-->')
    expect(html).toContain('visible')
  })
})
