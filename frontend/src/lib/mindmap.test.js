import { describe, it, expect } from 'vitest'
import { renderMindmap, sanitize, MindmapParseError } from './mindmap'

// Helpers: walk the nested `{ text, children }` tree.
const texts = (node) => [node.text, ...node.children.flatMap(texts)]
const firstByText = (node, text) => {
  if (node.text === text) return node
  for (const c of node.children) {
    const hit = firstByText(c, text)
    if (hit) return hit
  }
  return null
}

describe('sanitize', () => {
  it('strips paired CJK quotation marks', () => {
    expect(sanitize('「標題」')).toBe('標題')
    expect(sanitize('『書名』')).toBe('書名')
  })

  it('keeps ASCII punctuation and brackets (no longer Mermaid-constrained)', () => {
    expect(sanitize('hello (world)')).toBe('hello (world)')
    expect(sanitize('a, b; c:d')).toBe('a, b; c:d')
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
  it('builds a tree with the single H1 as root', () => {
    const md = `# Root\n\n## Child A\n\n### Leaf 1\n\n## Child B\n`
    const tree = renderMindmap(md, 'Ignored')
    expect(tree.text).toBe('Root')
    expect(tree.children.map((c) => c.text)).toEqual(['Child A', 'Child B'])
    const childA = tree.children[0]
    expect(childA.children.map((c) => c.text)).toEqual(['Leaf 1'])
  })

  it('falls back to the page title when there is no H1', () => {
    const md = `## Section A\n\n### Sub\n\n## Section B\n`
    const tree = renderMindmap(md, 'Page Title')
    expect(tree.text).toBe('Page Title')
    expect(tree.children.map((c) => c.text)).toEqual(['Section A', 'Section B'])
  })

  it('handles headings that do not start at H1 (no -Infinity crash)', () => {
    const md = `### Only H3 A\n\n### Only H3 B\n`
    const tree = renderMindmap(md, 'Title')
    expect(tree.text).toBe('Title')
    expect(tree.children.map((c) => c.text)).toEqual(['Only H3 A', 'Only H3 B'])
  })

  it('extracts plain text from formatted inline children', () => {
    const md = `# R\n\n## **Bold** [link](http://x) \`code\`\n`
    const tree = renderMindmap(md)
    expect(tree.children[0].text).toBe('Bold link code')
  })

  it('assigns a parent for every non-root node', () => {
    const md = `# R\n\n## A\n\n### A1\n\n## B\n`
    const tree = renderMindmap(md)
    // One parent→child relationship per non-root node → three edges total.
    const a = firstByText(tree, 'A')
    const a1 = firstByText(tree, 'A1')
    const b = firstByText(tree, 'B')
    expect(a).not.toBeNull()
    expect(a1).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a.children).toContain(a1)
    expect(tree.children).toEqual(expect.arrayContaining([a, b]))
  })
})

describe('renderMindmap — bullet strategy', () => {
  it('uses bullets when there are no headings', () => {
    const md = `- Topic A\n- Topic B\n  - Sub B1\n  - Sub B2\n`
    const tree = renderMindmap(md, 'My Mindmap')
    expect(tree.text).toBe('My Mindmap')
    expect(tree.children.map((c) => c.text)).toEqual(['Topic A', 'Topic B'])
    const topicB = tree.children[1]
    expect(topicB.children.map((c) => c.text)).toEqual(['Sub B1', 'Sub B2'])
  })

  it('truncates bullets past the max depth', () => {
    const md = [
      '- L1',
      '  - L2',
      '    - L3',
      '      - L4',
      '        - L5 should be dropped',
    ].join('\n')
    const tree = renderMindmap(md, 'T')
    const all = texts(tree)
    expect(all).toContain('L1')
    expect(all).toContain('L4')
    expect(all).not.toContain('L5 should be dropped')
  })

  it('falls back to bullet strategy when there is only a single H1', () => {
    const md = `# Only root\n\n- one\n- two\n`
    const tree = renderMindmap(md, 'T')
    expect(tree.text).toBe('Only root')
    expect(tree.children.map((c) => c.text)).toEqual(['one', 'two'])
  })
})

describe('renderMindmap — level clamping', () => {
  it('clamps heading-level jumps so each child is at most one level deeper', () => {
    // # Root / ## A / #### Deep — jumps from level 2 to level 4 under A.
    // Expected: Deep becomes a child of A, no phantom intermediate.
    const md = `# Root\n\n## A\n\n#### Deep\n`
    const tree = renderMindmap(md)
    const a = firstByText(tree, 'A')
    expect(a).not.toBeNull()
    expect(a.children.map((c) => c.text)).toEqual(['Deep'])
  })

  it('normalizes bullet lists that start below top level', () => {
    const md = `  - A\n  - B\n    - Child\n`
    const tree = renderMindmap(md, 'T')
    expect(tree.text).toBe('T')
    // Top-level bullets should connect directly to the synthetic root.
    expect(tree.children.map((c) => c.text)).toEqual(['A', 'B'])
    const b = firstByText(tree, 'B')
    expect(b.children.map((c) => c.text)).toEqual(['Child'])
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
  it('produces structurally identical trees for the same input', () => {
    const md = `# A\n\n## B\n\n## C\n`
    expect(renderMindmap(md)).toEqual(renderMindmap(md))
  })
})
