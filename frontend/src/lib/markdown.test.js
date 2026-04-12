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
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>Hello world</p>')
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
