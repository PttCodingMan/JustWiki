import { describe, it, expect, beforeEach } from 'vitest'
import {
  LAYOUT,
  buildEdgePath,
  buildOrthogonalEdge,
  buildRadialEdge,
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

describe('buildOrthogonalEdge alias', () => {
  it('buildEdgePath is the same function as buildOrthogonalEdge', () => {
    expect(buildEdgePath).toBe(buildOrthogonalEdge)
  })
})

describe('layoutMindmap — RL layout', () => {
  it('mirrors x of every node around the viewBox horizontal center', () => {
    const tree = node('Root', [
      node('Branch', [leaf('A'), leaf('B')]),
      leaf('Solo'),
    ])
    const lr = layoutMindmap(tree, { layout: 'lr' })
    const rl = layoutMindmap(tree, { layout: 'rl' })
    expect(lr.nodes.length).toBe(rl.nodes.length)
    // viewBox width is identical (same content, same padding rules).
    expect(rl.viewBox[2]).toBeCloseTo(lr.viewBox[2], 5)
    // y is unchanged; x is mirrored around viewBox.w / 2.
    const center = lr.viewBox[2] / 2
    for (let i = 0; i < lr.nodes.length; i++) {
      const a = lr.nodes[i]
      const b = rl.nodes[i]
      expect(b.y).toBeCloseTo(a.y, 5)
      expect(b.x).toBeCloseTo(2 * center - a.x, 5)
    }
  })

  it('places the root on the right side', () => {
    const tree = node('R', [leaf('A'), leaf('B')])
    const { nodes, viewBox } = layoutMindmap(tree, { layout: 'rl' })
    const root = nodes[0]
    expect(root.x).toBeGreaterThan(viewBox[2] / 2)
  })

  it('edge path starts at parent left-edge midpoint and ends at child right-edge midpoint', () => {
    const tree = node('R', [leaf('child')])
    const { nodes, edges } = layoutMindmap(tree, { layout: 'rl' })
    const [parent, child] = nodes
    const d = edges[0].d
    const startX = parent.x - parent.w / 2
    const endX = child.x + child.w / 2
    expect(d.startsWith(`M${startX},`)).toBe(true)
    expect(d.endsWith(`L${endX},${child.y}`)).toBe(true)
  })
})

describe('layoutMindmap — radial layout', () => {
  it('places the lone root inside positive viewBox space', () => {
    const { nodes, edges, viewBox } = layoutMindmap(leaf('Solo'), { layout: 'radial' })
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
    const r = nodes[0]
    expect(r.x).toBeGreaterThan(0)
    expect(r.y).toBeGreaterThan(0)
    expect(viewBox[0]).toBe(0)
    expect(viewBox[1]).toBe(0)
    expect(viewBox[2]).toBeGreaterThan(r.x + r.w / 2)
    expect(viewBox[3]).toBeGreaterThan(r.y + r.h / 2)
  })

  it('places four equal-depth leaves equally spaced on a single ring', () => {
    const tree = node('R', [leaf('A'), leaf('B'), leaf('C'), leaf('D')])
    const { nodes } = layoutMindmap(tree, { layout: 'radial' })
    const root = nodes[0]
    const leaves = nodes.slice(1)
    // All leaves share a radius (same depth → same ring).
    const radii = leaves.map((n) =>
      Math.hypot(n.x - root.x, n.y - root.y),
    )
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeCloseTo(radii[0], 1)
    }
    // Adjacent angular spacing is uniform (≈ 90° around the root).
    const angles = leaves
      .map((n) => Math.atan2(n.y - root.y, n.x - root.x))
      .sort((a, b) => a - b)
    const gaps = []
    for (let i = 1; i < angles.length; i++) gaps.push(angles[i] - angles[i - 1])
    gaps.push(2 * Math.PI - (angles[angles.length - 1] - angles[0]))
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length
    for (const g of gaps) expect(g).toBeCloseTo(avg, 1)
  })

  it('allocates angular budget by leaf count, not subtree depth', () => {
    // Branch B has 5 leaves; branch A has 1 leaf. B should take ~5× the
    // angular slice that A does.
    const tree = node('R', [
      node('A', [leaf('a1')]),
      node('B', [leaf('b1'), leaf('b2'), leaf('b3'), leaf('b4'), leaf('b5')]),
    ])
    const { nodes } = layoutMindmap(tree, { layout: 'radial' })
    const root = nodes[0]
    const aBranch = nodes.find((n) => n.text === 'A')
    const bBranch = nodes.find((n) => n.text === 'B')
    const aLeaves = nodes.filter((n) => /^a\d$/.test(n.text || ''))
    const bLeaves = nodes.filter((n) => /^b\d$/.test(n.text || ''))

    const angOf = (n) => Math.atan2(n.y - root.y, n.x - root.x)
    const minMax = (xs) => [Math.min(...xs), Math.max(...xs)]
    // Including the branch root in each side's angular extent so the
    // single-leaf branch isn't measured as a 0-width slice.
    const [aMin, aMax] = minMax([angOf(aBranch), ...aLeaves.map(angOf)])
    const [bMin, bMax] = minMax([angOf(bBranch), ...bLeaves.map(angOf)])
    const aSpan = aMax - aMin
    const bSpan = bMax - bMin
    // Allow generous tolerance: MIN_ANGLE clamping and bbox translation make
    // the ratio approximate, but B's slice should clearly dwarf A's.
    expect(bSpan).toBeGreaterThan(aSpan * 2)
  })

  it('respects MIN_ANGLE so very wide trees do not collapse to zero arc', () => {
    const children = []
    for (let i = 0; i < 40; i++) children.push(leaf(`leaf-${i}`))
    const tree = node('R', children)
    const { nodes } = layoutMindmap(tree, { layout: 'radial' })
    const root = nodes[0]
    const angles = nodes
      .slice(1)
      .map((n) => Math.atan2(n.y - root.y, n.x - root.x))
      .sort((a, b) => a - b)
    // All adjacent leaves should sit at least MIN_ANGLE apart (allowing for
    // the wraparound being skipped — we only check forward gaps here).
    for (let i = 1; i < angles.length; i++) {
      const gap = angles[i] - angles[i - 1]
      expect(gap + 1e-6).toBeGreaterThanOrEqual(LAYOUT.MIN_ANGLE)
    }
  })

  it('places the root near the viewBox geometric center for a balanced star', () => {
    const tree = node('R', [leaf('A'), leaf('B'), leaf('C'), leaf('D')])
    const { nodes, viewBox } = layoutMindmap(tree, { layout: 'radial' })
    const root = nodes[0]
    // Tolerance covers the asymmetry between rectW and rectH (text labels
    // are wider than tall) — the root should still be ~centered.
    expect(root.x).toBeCloseTo(viewBox[2] / 2, -1)
    expect(root.y).toBeCloseTo(viewBox[3] / 2, -1)
  })

  it('falls back to LR for an unknown layout value', () => {
    const tree = node('R', [leaf('A')])
    const lr = layoutMindmap(tree, { layout: 'lr' })
    const fallback = layoutMindmap(tree, { layout: 'whatever' })
    expect(fallback.viewBox).toEqual(lr.viewBox)
    for (let i = 0; i < lr.nodes.length; i++) {
      expect(fallback.nodes[i].x).toBeCloseTo(lr.nodes[i].x, 5)
      expect(fallback.nodes[i].y).toBeCloseTo(lr.nodes[i].y, 5)
    }
  })
})

describe('buildRadialEdge', () => {
  it('emits a quadratic Bezier from parent to child anchored at the radial midpoint', () => {
    const parent = { x: 0, y: 0, r: 0, angle: 0 }
    const child = { x: 100, y: 0, r: 100, angle: 0 }
    const d = buildRadialEdge(parent, child)
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d).toContain('Q')
    expect(d.endsWith('100,0')).toBe(true)
  })

  it('honors the origin offset so curves bow toward the translated radial center, not (0,0)', () => {
    // Parent at the center, child two units east. Without the origin offset,
    // the control point lands at (1, 0). With offset (10, 5), the radial
    // midpoint shifts to (10 + 1, 5 + 0) = (11, 5).
    const parent = { x: 10, y: 5, r: 0, angle: 0 }
    const child = { x: 12, y: 5, r: 2, angle: 0 }
    const d = buildRadialEdge(parent, child, { x: 10, y: 5 })
    // Q segment includes the translated control point.
    expect(d).toContain('Q11,5')
  })
})

describe('layoutMindmap — radial edge geometry', () => {
  // The subtree-local radial layout draws straight parent→child segments.
  // The pre-rewrite quadratic-bezier edge assumed every node sat on a ring
  // centered at the global origin, which is no longer true.
  it('emits a straight line from parent center to child center', () => {
    const tree = node('R', [leaf('A'), leaf('B'), leaf('C'), leaf('D')])
    const { nodes, edges } = layoutMindmap(tree, { layout: 'radial' })
    expect(edges.length).toBe(4)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const e of edges) {
      const parent = byId.get(e.fromId)
      const child = byId.get(e.toId)
      // Path is exactly "M{px},{py} L{cx},{cy}" — no Q segment.
      expect(e.d).not.toContain('Q')
      const m = /^M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)$/.exec(e.d)
      expect(m).not.toBeNull()
      expect(parseFloat(m[1])).toBeCloseTo(parent.x, 1)
      expect(parseFloat(m[2])).toBeCloseTo(parent.y, 1)
      expect(parseFloat(m[3])).toBeCloseTo(child.x, 1)
      expect(parseFloat(m[4])).toBeCloseTo(child.y, 1)
    }
  })
})

describe('layoutMindmap — radial subtree-local placement', () => {
  // Regression for "everything sits on the same ring" — the pre-rewrite
  // concentric-ring radial put every depth-d node at the same distance
  // from the root regardless of its parent. The Gource-style rewrite makes
  // each parent the local center of its own children, so a grandchild's
  // distance from the root depends on where its parent landed.
  it('places a grandchild closer to its parent than to the root', () => {
    const tree = node('R', [node('A', [leaf('grandkid')])])
    const { nodes } = layoutMindmap(tree, { layout: 'radial' })
    const r = nodes.find((n) => n.text === 'R')
    const a = nodes.find((n) => n.text === 'A')
    const gk = nodes.find((n) => n.text === 'grandkid')
    const distGkToR = Math.hypot(gk.x - r.x, gk.y - r.y)
    const distGkToA = Math.hypot(gk.x - a.x, gk.y - a.y)
    expect(distGkToA).toBeLessThan(distGkToR)
  })

  it('separates two depth-2 cousins by extending each from its own parent', () => {
    // Two single-leaf branches off the root. The leaves are depth-2 cousins.
    // In the old ring layout they'd share a radius; in the new layout each
    // leaf is one "step" out from its own parent — so the leaves' distance
    // from the root is approximately (root→parent) + (parent→leaf), not a
    // shared depth-2 ring.
    const tree = node('R', [node('A', [leaf('a1')]), node('B', [leaf('b1')])])
    const { nodes } = layoutMindmap(tree, { layout: 'radial' })
    const r = nodes.find((n) => n.text === 'R')
    const a = nodes.find((n) => n.text === 'A')
    const a1 = nodes.find((n) => n.text === 'a1')
    const distRtoA = Math.hypot(a.x - r.x, a.y - r.y)
    const distAtoA1 = Math.hypot(a1.x - a.x, a1.y - a.y)
    const distRtoA1 = Math.hypot(a1.x - r.x, a1.y - r.y)
    // a1 reached via A: |R→a1| ≈ |R→A| + |A→a1| within rounding (a1 sits
    // along the outward direction from A).
    expect(distRtoA1).toBeCloseTo(distRtoA + distAtoA1, 0)
  })
})
