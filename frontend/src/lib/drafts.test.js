import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearDraft, DRAFT_MAX_AGE_MS, loadDraft, pruneDrafts, saveDraft } from './drafts'

const sample = { title: 'T', content: 'body', mindmapLayout: 'lr', baseVersion: 3 }

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a draft per user and page', () => {
    saveDraft(1, 'abc', sample)
    expect(loadDraft(1, 'abc')).toMatchObject(sample)
    expect(loadDraft(1, 'abc').savedAt).toBeTypeOf('number')
    // Other users / pages don't see it.
    expect(loadDraft(2, 'abc')).toBeNull()
    expect(loadDraft(1, 'xyz')).toBeNull()
  })

  it('clears a draft', () => {
    saveDraft(1, 'abc', sample)
    clearDraft(1, 'abc')
    expect(loadDraft(1, 'abc')).toBeNull()
  })

  it('ignores missing identifiers and malformed entries', () => {
    saveDraft(undefined, 'abc', sample)
    expect(localStorage.length).toBe(0)
    localStorage.setItem('justwiki:draft:1:bad', '{not json')
    expect(loadDraft(1, 'bad')).toBeNull()
    localStorage.setItem('justwiki:draft:1:shape', JSON.stringify({ title: 1 }))
    expect(loadDraft(1, 'shape')).toBeNull()
  })

  it('prunes only stale drafts and leaves other keys alone', () => {
    const now = Date.now()
    localStorage.setItem('justwiki:draft:1:old', JSON.stringify({ ...sample, savedAt: now - DRAFT_MAX_AGE_MS - 1 }))
    localStorage.setItem('justwiki:draft:1:new', JSON.stringify({ ...sample, savedAt: now }))
    localStorage.setItem('theme', 'dark')
    pruneDrafts(DRAFT_MAX_AGE_MS, now)
    expect(localStorage.getItem('justwiki:draft:1:old')).toBeNull()
    expect(localStorage.getItem('justwiki:draft:1:new')).not.toBeNull()
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('survives storage errors', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveDraft(1, 'abc', sample)).not.toThrow()
    // Tried once, pruned, retried once.
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
