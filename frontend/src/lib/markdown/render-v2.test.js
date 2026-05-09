/**
 * Smoke coverage for the v2 (remark-based) renderer. These pin the
 * critical custom-syntax outputs the Viewer's post-render JS depends on
 * (Mermaid bootstrap, transclusion fetch, drawio embed). Once v2 replaces
 * v1, the much larger ``../markdown.test.js`` golden suite will move
 * here too.
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdownV2, isV2Enabled } from './render-v2'

describe('renderMarkdownV2', () => {
  it('renders a plain paragraph', () => {
    expect(renderMarkdownV2('hello world').trim()).toBe('<p>hello world</p>')
  })

  it('renders GFM tables', () => {
    const out = renderMarkdownV2('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('<table>')
    expect(out).toContain('<th>a</th>')
    expect(out).toContain('<td>1</td>')
  })

  it('renders headings with CJK-safe ids', () => {
    const out = renderMarkdownV2('# 早餐清單')
    expect(out).toContain('id="早餐清單"')
    expect(out).toContain('>早餐清單</h1>')
  })

  it('makes heading ids unique on duplicates', () => {
    const out = renderMarkdownV2('# Section\n\n# Section')
    expect(out).toMatch(/id="section"/)
    expect(out).toMatch(/id="section-1"/)
  })

  it('includes inline math in heading id slugification (v1 parity)', () => {
    // v1 slugifies the raw inline.content "E = $mc^2$" → "e-mc2".
    // Heading-text extraction must include math node values to match.
    const out = renderMarkdownV2('# E = $mc^2$')
    expect(out).toContain('id="e-mc2"')
  })

  it('renders [[wikilink]] as an anchor with the right class and href', () => {
    const out = renderMarkdownV2('see [[welcome]] please')
    expect(out).toContain('class="wikilink"')
    expect(out).toContain('href="/page/welcome"')
    expect(out).toContain('>welcome</a>')
  })

  it('renders [[slug|display]] with the display text', () => {
    const out = renderMarkdownV2('[[welcome|Hi there]]')
    expect(out).toContain('href="/page/welcome"')
    expect(out).toContain('>Hi there</a>')
  })

  it('renders ![[slug]] transclusion markup the Viewer can hydrate', () => {
    const out = renderMarkdownV2('![[embed]]')
    expect(out).toContain('class="transclusion"')
    expect(out).toContain('class="transclusion-content"')
    expect(out).toContain('data-transclude="embed"')
    expect(out).toContain('Loading...')
  })

  it('renders @user mentions with the right anchor', () => {
    const out = renderMarkdownV2('hi @alice today')
    expect(out).toContain('class="mention mention-user"')
    expect(out).toContain('href="/u/alice"')
    expect(out).toContain('data-user="alice"')
    expect(out).toContain('>@alice</a>')
  })

  it('renders @@group mentions as a non-link span', () => {
    const out = renderMarkdownV2('cc @@team-x today')
    expect(out).toContain('class="mention mention-group"')
    expect(out).toContain('data-group="team-x"')
    expect(out).toContain('>@@team-x</span>')
  })

  it('does NOT mention-ify email addresses', () => {
    const out = renderMarkdownV2('mail foo@bar.com')
    expect(out).not.toContain('class="mention')
  })

  it('renders :::info callouts with title + body', () => {
    const out = renderMarkdownV2(':::info\nbe careful\n:::')
    expect(out).toContain('class="callout callout-info"')
    expect(out).toContain('class="callout-title"')
    expect(out).toContain('class="callout-body"')
    expect(out).toContain('>Info<')
    expect(out).toContain('be careful')
  })

  it('renders ```mermaid``` fences with placeholder + encoded source', () => {
    const out = renderMarkdownV2('```mermaid\ngraph TD;\nA-->B\n```')
    expect(out).toContain('class="mermaid-block"')
    expect(out).toContain('data-mermaid="')
    expect(out).toContain('Loading diagram...')
  })

  it('renders ::drawio[id] embeds', () => {
    const out = renderMarkdownV2('::drawio[42]')
    expect(out).toContain('class="drawio-embed"')
    expect(out).toContain('data-diagram-id="42"')
    expect(out).toContain('Loading Draw.io diagram #42')
  })

  it('adds target=_blank rel=noopener to external links', () => {
    const out = renderMarkdownV2('[ext](https://example.com)')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('does NOT add target/rel to relative links', () => {
    const out = renderMarkdownV2('[rel](/page/foo)')
    expect(out).not.toContain('target=')
    expect(out).not.toContain('rel=')
  })

  it('renders inline math via rehype-katex', () => {
    const out = renderMarkdownV2('inline $x^2$ here')
    expect(out).toContain('class="katex"')
    expect(out).toMatch(/x|x\^/)
  })

  it('renders block math via rehype-katex', () => {
    const out = renderMarkdownV2('$$\nE = mc^2\n$$')
    expect(out).toContain('class="katex')
  })

  it('returns empty string on empty input', () => {
    expect(renderMarkdownV2('')).toBe('')
    expect(renderMarkdownV2(null)).toBe('')
    expect(renderMarkdownV2(undefined)).toBe('')
  })

  // ── Known Phase-B drift markers ─────────────────────────────────────────
  // These regressions are documented in render-v2.js's module docstring and
  // must be closed before the default flips from v1 → v2. Kept as
  // `it.todo` so they show up in the test report as outstanding work
  // without breaking the suite.

  it.todo('preserves wikilinks whose display text contains **emphasis**')
  it.todo('renders ::drawio[id] mid-paragraph (v1 anywhere-inline grammar)')
  it.todo('renders ::drawio\\[id\\] (Milkdown-escaped form from the editor)')
  it.todo('passes :::unknown blocks through as literal text (v1 fallback)')
})

describe('isV2Enabled', () => {
  it('returns false by default', () => {
    globalThis.localStorage?.removeItem('markdown.v2')
    expect(isV2Enabled()).toBe(false)
  })

  it('returns true when the flag is set', () => {
    globalThis.localStorage?.setItem('markdown.v2', 'true')
    try {
      expect(isV2Enabled()).toBe(true)
    } finally {
      globalThis.localStorage?.removeItem('markdown.v2')
    }
  })
})
