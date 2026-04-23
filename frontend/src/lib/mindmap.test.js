import { describe, it, expect } from 'vitest'
import { renderMindmap, sanitize, MindmapParseError } from './mindmap'

describe('sanitize', () => {
  it('strips Mermaid-hostile punctuation and CJK quote marks', () => {
    expect(sanitize('hello (world)')).toBe('hello world')
    expect(sanitize('「標題」')).toBe('標題')
    expect(sanitize('a, b; c:d')).toBe('a b cd')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitize('  foo\t\tbar\n')).toBe('foo bar')
  })

  it('truncates long text with ellipsis', () => {
    const long = 'a'.repeat(60)
    const out = sanitize(long)
    expect(out.length).toBe(30)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('renderMindmap — heading strategy', () => {
  it('emits a left-to-right flowchart with the single H1 as root', () => {
    const md = `# Root\n\n## Child A\n\n### Leaf 1\n\n## Child B\n`
    const out = renderMindmap(md, 'Ignored')
    expect(out).toContain('flowchart LR')
    expect(out).toContain('"curve":"stepBefore"')
    expect(out).toContain('n0["Root"]:::lv0')
    expect(out).toContain('"Child A"')
    expect(out).toContain('"Leaf 1"')
    expect(out).toContain('"Child B"')
    // Edges: n0 → Child A, Child A → Leaf 1, n0 → Child B
    expect(out).toMatch(/n0 --> n1/)
    expect(out).toMatch(/n1 --> n2/)
    expect(out).toMatch(/n0 --> n3/)
  })

  it('falls back to the page title when there is no H1', () => {
    const md = `## Section A\n\n### Sub\n\n## Section B\n`
    const out = renderMindmap(md, 'Page Title')
    expect(out).toContain('n0["Page Title"]:::lv0')
    expect(out).toContain('"Section A"')
    expect(out).toContain('"Section B"')
  })

  it('handles headings that do not start at H1 (no -Infinity crash)', () => {
    const md = `### Only H3 A\n\n### Only H3 B\n`
    const out = renderMindmap(md, 'Title')
    expect(out).toContain('n0["Title"]:::lv0')
    expect(out).toContain('"Only H3 A"')
  })

  it('extracts plain text from formatted inline children', () => {
    const md = `# R\n\n## **Bold** [link](http://x) \`code\`\n`
    const out = renderMindmap(md)
    expect(out).toContain('"Bold link code"')
  })

  it('assigns a parent edge for every non-root node', () => {
    const md = `# R\n\n## A\n\n### A1\n\n## B\n`
    const out = renderMindmap(md)
    const edgeCount = (out.match(/-->/g) || []).length
    // One edge per non-root node: A, A1, B → 3 edges
    expect(edgeCount).toBe(3)
  })
})

describe('renderMindmap — bullet strategy', () => {
  it('uses bullets when there are no headings', () => {
    const md = `- Topic A\n- Topic B\n  - Sub B1\n  - Sub B2\n`
    const out = renderMindmap(md, 'My Mindmap')
    expect(out).toContain('n0["My Mindmap"]:::lv0')
    expect(out).toContain('"Topic A"')
    expect(out).toContain('"Sub B1"')
  })

  it('truncates bullets past the max depth', () => {
    const md = [
      '- L1',
      '  - L2',
      '    - L3',
      '      - L4',
      '        - L5 should be dropped',
    ].join('\n')
    const out = renderMindmap(md, 'T')
    expect(out).toContain('"L1"')
    expect(out).toContain('"L4"')
    expect(out).not.toContain('L5 should be dropped')
  })

  it('falls back to bullet strategy when there is only a single H1', () => {
    const md = `# Only root\n\n- one\n- two\n`
    const out = renderMindmap(md, 'T')
    expect(out).toContain('n0["Only root"]:::lv0')
    expect(out).toContain('"one"')
    expect(out).toContain('"two"')
  })
})

describe('renderMindmap — level clamping', () => {
  it('clamps heading-level jumps so each child is at most one level deeper', () => {
    // # Root / ## A / #### Deep — jumps from level 2 to level 4 under A.
    // Expected: Deep becomes a child of A at level 3, no phantom intermediate.
    const md = `# Root\n\n## A\n\n#### Deep\n`
    const out = renderMindmap(md)
    expect(out).toContain('n0["Root"]:::lv0')
    // Deep must attach to A (n1), not be reparented up.
    expect(out).toContain('n1 --> n2')
  })

  it('normalizes bullet lists that start below top level', () => {
    const md = `  - A\n  - B\n    - Child\n`
    const out = renderMindmap(md, 'T')
    expect(out).toContain('"A"')
    expect(out).toContain('"Child"')
    // Top-level bullets should connect to the synthetic root.
    expect(out).toMatch(/n0 --> n1/)
  })
})

describe('renderMindmap — error paths', () => {
  it('throws MindmapParseError on empty content', () => {
    expect(() => renderMindmap('', 'T')).toThrow(MindmapParseError)
  })

  it('throws when the document has only prose paragraphs', () => {
    expect(() => renderMindmap('just a sentence.', 'T')).toThrow(
      MindmapParseError,
    )
  })

  it('throws on a pure code block (no headings, no bullets)', () => {
    const md = '```js\nconsole.log(1)\n```'
    expect(() => renderMindmap(md, 'T')).toThrow(MindmapParseError)
  })
})

describe('renderMindmap — deterministic output', () => {
  it('produces byte-identical output for the same input', () => {
    const md = `# A\n\n## B\n\n## C\n`
    expect(renderMindmap(md)).toBe(renderMindmap(md))
  })
})
