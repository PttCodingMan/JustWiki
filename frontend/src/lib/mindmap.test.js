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

describe('renderMindmap — image support', () => {
  it('attaches a same-origin image to a heading node', () => {
    const md = `# Root\n\n## ![logo](/api/media/abc.png) Company\n`
    const tree = renderMindmap(md)
    const node = firstByText(tree, 'Company')
    expect(node).not.toBeNull()
    expect(node.image).toEqual({ src: '/api/media/abc.png', alt: 'logo' })
  })

  it('captures image-only headings (empty text)', () => {
    const md = `# Root\n\n## ![diagram](/api/media/d.png)\n`
    const tree = renderMindmap(md)
    expect(tree.children).toHaveLength(1)
    const node = tree.children[0]
    expect(node.text).toBe('')
    expect(node.image).toEqual({ src: '/api/media/d.png', alt: 'diagram' })
  })

  it('attaches an image to the H1 root', () => {
    const md = `# ![brand](/api/media/r.png) Root Title\n\n## Child\n`
    const tree = renderMindmap(md)
    expect(tree.text).toBe('Root Title')
    expect(tree.image).toEqual({ src: '/api/media/r.png', alt: 'brand' })
  })

  it('rejects cross-origin URLs and keeps the surrounding text', () => {
    const md = `# Root\n\n## ![x](https://evil.example.com/x.png) Hello\n`
    const tree = renderMindmap(md)
    const node = firstByText(tree, 'Hello')
    expect(node).not.toBeNull()
    expect(node.image).toBeNull()
  })

  it('rejects data: and javascript: schemes', () => {
    // markdown-it's own URL validator already drops these schemes (so the
    // image never reaches our parser as an image token), but we still want
    // to assert end-to-end that no node ends up with an unsafe image.
    const cases = [
      `# R\n\n## ![x](data:image/png;base64,abc) Caption\n`,
      `# R\n\n## ![x](javascript:alert(1)) Caption\n`,
    ]
    for (const md of cases) {
      const tree = renderMindmap(md)
      const images = []
      const walk = (n) => {
        if (n.image) images.push(n.image)
        n.children.forEach(walk)
      }
      walk(tree)
      expect(images).toEqual([])
    }
  })

  it('drops a node when its only content is an unsafe image', () => {
    // Heading with an unsafe image and no text → no node (text gets sanitized
    // to empty, image rejected).
    const md = `# Root\n\n## ![](https://evil.example.com/x.png)\n## Real Child\n`
    const tree = renderMindmap(md)
    expect(tree.children.map((c) => c.text)).toEqual(['Real Child'])
  })

  it('captures images on bullet items', () => {
    const md = `- ![pic](/api/media/p.png) Item A\n- Item B\n`
    const tree = renderMindmap(md, 'T')
    const a = firstByText(tree, 'Item A')
    const b = firstByText(tree, 'Item B')
    expect(a.image).toEqual({ src: '/api/media/p.png', alt: 'pic' })
    expect(b.image).toBeNull()
  })

  it('takes only the first image per heading', () => {
    const md = `# R\n\n## ![a](/api/media/1.png) ![b](/api/media/2.png) Title\n`
    const tree = renderMindmap(md)
    const node = firstByText(tree, 'Title')
    expect(node.image).toEqual({ src: '/api/media/1.png', alt: 'a' })
  })

  it('attaches a paragraph image that follows a heading', () => {
    // Milkdown wraps pasted/uploaded images in their own paragraph rather
    // than embedding them inline in the heading text — make sure those still
    // attach to the preceding heading.
    const md = [
      '# Root',
      '',
      '## Section',
      '',
      '![pic](/api/media/p.png)',
      '',
      '## Other',
    ].join('\n')
    const tree = renderMindmap(md)
    const section = firstByText(tree, 'Section')
    expect(section.image).toEqual({ src: '/api/media/p.png', alt: 'pic' })
    const other = firstByText(tree, 'Other')
    expect(other.image).toBeNull()
  })

  it('does not let a paragraph image override an inline heading image', () => {
    const md = [
      '## ![inline](/api/media/inline.png) Section',
      '',
      '![later](/api/media/later.png)',
    ].join('\n')
    const tree = renderMindmap(md, 'T')
    const section = firstByText(tree, 'Section')
    expect(section.image).toEqual({ src: '/api/media/inline.png', alt: 'inline' })
  })

  it('puts image: null on every node when no images are used', () => {
    const md = `# A\n\n## B\n`
    const tree = renderMindmap(md)
    expect(tree.image).toBeNull()
    expect(tree.children[0].image).toBeNull()
  })
})
