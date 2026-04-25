import { describe, it, expect, beforeEach } from 'vitest'
import {
  LAYOUT,
  buildEdgePath,
  layoutMindmap,
  measureText,
  _resetMeasureCacheForTests,
} from './mindmapLayout'

const leaf = (text) => ({ text, children: [] })
const node = (text, children) => ({ text, children })

beforeEach(() => {
  _resetMeasureCacheForTests()
})

describe('measureText (jsdom fallback)', () => {
  it('returns 0 for empty input', () => {
    expect(measureText('')).toBe(0)
  })

  it('gives CJK strings roughly 2× the width of ASCII of the same length', () => {
    const ascii = measureText('abc')
    const cjk = measureText('日本行')
    expect(cjk).toBeGreaterThan(ascii)
  })

  it('caches repeated measurements', () => {
    const first = measureText('cache-me')
    const second = measureText('cache-me')
    expect(first).toBe(second)
  })
})

describe('buildEdgePath', () => {
  it('degenerates to a straight line when y matches', () => {
    expect(buildEdgePath(0, 10, 50, 10, 6)).toBe('M0,10 L50,10')
  })

  it('emits a rounded elbow with clamped radius', () => {
    const d = buildEdgePath(0, 0, 100, 80, 6)
    // Segments present, mid-x at 50, radius 6.
    expect(d).toContain('M0,0')
    expect(d).toContain('L44,0') // mx - r = 50 - 6
    expect(d).toContain('Q50,0 50,6') // first arc at parent y
    expect(d).toContain('Q50,80 56,80') // second arc at child y
    expect(d).toContain('L100,80')
  })

  it('handles downward → upward direction symmetrically', () => {
    const up = buildEdgePath(0, 80, 100, 0, 6)
    expect(up).toContain('Q50,80 50,74') // moving up → sign = -1
    expect(up).toContain('Q50,0 56,0')
  })

  it('clamps radius so it never exceeds half the vertical drop', () => {
    // |y1 - y0|/2 = 1, radius 6 → clamped to 1.
    const d = buildEdgePath(0, 0, 100, 2, 6)
    expect(d).toContain('Q50,0 50,1')
    expect(d).toContain('Q50,2 51,2')
  })

  it('clamps radius to the horizontal segment length', () => {
    // |mx - x0| = 5 with x0=0, x1=10 → radius capped at 5.
    const d = buildEdgePath(0, 0, 10, 40, 6)
    expect(d).toContain('Q5,0 5,5')
    expect(d).toContain('Q5,40 10,40')
  })
})

describe('layoutMindmap — single node', () => {
  it('places the root inside the top-left padding', () => {
    const { nodes, edges, viewBox } = layoutMindmap(leaf('Solo'))
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    const n = nodes[0]
    expect(n.x).toBeCloseTo(LAYOUT.PAD_L + n.w / 2, 5)
    expect(n.y).toBeCloseTo(LAYOUT.PAD_T + n.h / 2, 5)
    expect(viewBox[0]).toBe(0)
    expect(viewBox[1]).toBe(0)
    expect(viewBox[2]).toBeGreaterThan(n.x + n.w / 2)
    expect(viewBox[3]).toBeGreaterThan(n.y + n.h / 2)
  })
})

describe('layoutMindmap — linear chain', () => {
  it('puts three depths into three columns with increasing x', () => {
    const tree = node('A', [node('B', [leaf('C')])])
    const { nodes, edges } = layoutMindmap(tree)
    expect(nodes).toHaveLength(3)
    expect(edges).toHaveLength(2)
    const [a, b, c] = nodes
    expect(a.depth).toBe(0)
    expect(b.depth).toBe(1)
    expect(c.depth).toBe(2)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    // Linear chain → all three share the same y (each has one child centered on self).
    expect(a.y).toBeCloseTo(b.y, 5)
    expect(b.y).toBeCloseTo(c.y, 5)
  })
})

describe('layoutMindmap — per-depth width alignment', () => {
  it('widens narrower siblings to the widest in the group', () => {
    const tree = node('R', [leaf('short'), leaf('a much longer label')])
    const { nodes } = layoutMindmap(tree)
    const [, left, right] = nodes
    expect(left.w).toBe(right.w)
    expect(left.w).toBeGreaterThan(0)
  })

  it('gives every node at the same depth the same width, even across parents', () => {
    // parent A has long children, parent B has short ones — both at depth 2.
    const tree = node('R', [
      node('A', [leaf('verrrrry long label one'), leaf('verrrrry long label two')]),
      node('B', [leaf('x'), leaf('y')]),
    ])
    const { nodes } = layoutMindmap(tree)
    const byText = new Map(nodes.map((n) => [n.text, n]))
    const aKids = [byText.get('verrrrry long label one'), byText.get('verrrrry long label two')]
    const bKids = [byText.get('x'), byText.get('y')]
    // All depth-2 nodes share the same width — driven by the widest one.
    expect(aKids[0].w).toBe(aKids[1].w)
    expect(bKids[0].w).toBe(bKids[1].w)
    expect(aKids[0].w).toBe(bKids[0].w)
    // Per-depth column alignment is preserved — same x center at depth 2.
    expect(aKids[0].x).toBeCloseTo(bKids[0].x, 5)
    expect(aKids[1].x).toBeCloseTo(bKids[1].x, 5)
  })
})

describe('layoutMindmap — sibling stacking', () => {
  it('stacks siblings vertically with GAP_Y between them', () => {
    const tree = node('R', [leaf('A'), leaf('B')])
    const { nodes } = layoutMindmap(tree)
    const [, a, b] = nodes
    const gap = b.y - b.h / 2 - (a.y + a.h / 2)
    expect(gap).toBeCloseTo(LAYOUT.GAP_Y, 5)
  })

  it('centers parent y on the midpoint of its subtree extent', () => {
    const tree = node('R', [leaf('A'), leaf('B'), leaf('C')])
    const { nodes } = layoutMindmap(tree)
    const [r, a, , c] = nodes
    const expectedY = (a.y - a.h / 2 + (c.y + c.h / 2)) / 2
    expect(r.y).toBeCloseTo(expectedY, 5)
  })
})

describe('layoutMindmap — edges anchor to node edges', () => {
  it('edge path starts at parent right-edge midpoint and ends at child left-edge midpoint', () => {
    const tree = node('R', [leaf('child')])
    const { nodes, edges } = layoutMindmap(tree)
    const [parent, child] = nodes
    const d = edges[0].d
    const startX = parent.x + parent.w / 2
    const endX = child.x - child.w / 2
    expect(d.startsWith(`M${startX},`)).toBe(true)
    expect(d.endsWith(`L${endX},${child.y}`)).toBe(true)
  })
})

describe('layoutMindmap — does not mutate input', () => {
  it('does not attach layout scribble fields (_id, rectW, subtreeH) to caller tree', () => {
    const tree = node('R', [leaf('A'), leaf('B')])
    layoutMindmap(tree)
    expect(tree._id).toBeUndefined()
    expect(tree.rectW).toBeUndefined()
    expect(tree.subtreeH).toBeUndefined()
    for (const c of tree.children) {
      expect(c._id).toBeUndefined()
      expect(c.rectW).toBeUndefined()
    }
  })
})

describe('layoutMindmap — image support', () => {
  const imgLeaf = (text, src = '/api/media/x.png', alt = '') => ({
    text,
    image: { src, alt },
    children: [],
  })

  it('widens rectW to fit image + gap + text and lifts rectH to image height', () => {
    const tree = node('R', [imgLeaf('hello')])
    const { nodes } = layoutMindmap(tree)
    const child = nodes[1]
    // rectH must accommodate the IMG_SIZE thumbnail with PAD_Y on each side.
    expect(child.h).toBe(LAYOUT.IMG_SIZE + LAYOUT.PAD_Y * 2)
    // rectW must include image + IMG_GAP + text width + 2·PAD_X (>= a comparable text-only rect).
    expect(child.w).toBeGreaterThan(LAYOUT.IMG_SIZE + LAYOUT.IMG_GAP + LAYOUT.PAD_X * 2)
    // textW is exposed for the renderer to position the label.
    expect(child.textW).toBeGreaterThan(0)
  })

  it('handles image-only nodes (empty text)', () => {
    const tree = node('R', [imgLeaf('')])
    const { nodes } = layoutMindmap(tree)
    const child = nodes[1]
    expect(child.text).toBe('')
    expect(child.image).not.toBeNull()
    // No text → rectW = IMG_SIZE + 2·PAD_X (no IMG_GAP).
    expect(child.w).toBe(LAYOUT.IMG_SIZE + LAYOUT.PAD_X * 2)
    expect(child.textW).toBe(0)
  })

  it('equalizes rectH per-parent so a sibling without image is heightened', () => {
    const tree = node('R', [imgLeaf('with-image'), leaf('no-image')])
    const { nodes } = layoutMindmap(tree)
    const [, withImg, plain] = nodes
    expect(withImg.h).toBe(plain.h)
    expect(plain.h).toBeGreaterThanOrEqual(LAYOUT.IMG_SIZE + LAYOUT.PAD_Y * 2)
  })

  it('keeps the image reference on the layout node', () => {
    const tree = node('R', [imgLeaf('x', '/api/media/foo.png', 'foo')])
    const { nodes } = layoutMindmap(tree)
    expect(nodes[1].image).toEqual({ src: '/api/media/foo.png', alt: 'foo' })
  })
})

describe('layoutMindmap — viewBox covers everything', () => {
  it('viewBox right edge is at least the rightmost node right + right padding', () => {
    const tree = node('Root', [
      node('Branch', [leaf('Leaf A'), leaf('Leaf B')]),
    ])
    const { nodes, viewBox } = layoutMindmap(tree)
    const maxRight = Math.max(...nodes.map((n) => n.x + n.w / 2))
    expect(viewBox[2]).toBeGreaterThanOrEqual(maxRight + LAYOUT.PAD_R - 0.01)
  })
})
