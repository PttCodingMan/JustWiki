import { describe, it, expect } from 'vitest'
import { reconcileTree } from './reconcileTree'

const leaf = (id, title = `p${id}`) => ({ id, slug: `s${id}`, title, parent_id: null, sort_order: 0, children: [] })
const clone = (x) => JSON.parse(JSON.stringify(x))

describe('reconcileTree', () => {
  it('returns the previous tree when nothing changed', () => {
    const prev = [leaf(1), { ...leaf(2), children: [leaf(3)] }]
    expect(reconcileTree(prev, clone(prev))).toBe(prev)
  })

  it('reuses untouched subtrees and replaces the changed path', () => {
    const prev = [leaf(1), { ...leaf(2), children: [leaf(3), leaf(4)] }]
    const next = clone(prev)
    next[1].children[1].title = 'renamed'
    const out = reconcileTree(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).not.toBe(prev[1])
    expect(out[1].children[0]).toBe(prev[1].children[0])
    expect(out[1].children[1].title).toBe('renamed')
    expect(out).toEqual(next)
  })

  it('handles reorders, additions and removals', () => {
    const prev = [leaf(1), leaf(2), leaf(3)]
    const next = [clone(prev[2]), clone(prev[0]), leaf(9)]
    const out = reconcileTree(prev, next)
    expect(out).toEqual(next)
    expect(out[0]).toBe(prev[2])
    expect(out[1]).toBe(prev[0])
  })

  it('treats an empty previous tree as a fresh fetch', () => {
    const next = [leaf(1)]
    expect(reconcileTree([], next)).toBe(next)
  })
})
