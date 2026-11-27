import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useDraftAutosave from './useDraftAutosave'
import { loadDraft, saveDraft } from '../lib/drafts'

function setup(initial) {
  const baseVersionRef = { current: 5 }
  return renderHook((props) => useDraftAutosave({ baseVersionRef, ...props }), {
    initialProps: {
      userId: 1,
      slug: 'abc',
      enabled: true,
      dirty: false,
      title: 'T',
      content: 'orig',
      mindmapLayout: 'lr',
      ...initial,
    },
  })
}

describe('useDraftAutosave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a debounced draft while dirty', () => {
    const { rerender } = setup()
    rerender({ userId: 1, slug: 'abc', enabled: true, dirty: true, title: 'T', content: 'edited', mindmapLayout: 'lr' })
    expect(loadDraft(1, 'abc')).toBeNull()
    act(() => { vi.advanceTimersByTime(600) })
    expect(loadDraft(1, 'abc')).toMatchObject({ content: 'edited', baseVersion: 5 })
  })

  it('flushes the pending write on unmount', () => {
    const { rerender, unmount } = setup()
    rerender({ userId: 1, slug: 'abc', enabled: true, dirty: true, title: 'T', content: 'last', mindmapLayout: 'lr' })
    unmount()
    expect(loadDraft(1, 'abc')).toMatchObject({ content: 'last' })
  })

  it('removes the draft once clean again', () => {
    saveDraft(1, 'abc', { title: 'T', content: 'x' })
    setup({ dirty: false })
    expect(loadDraft(1, 'abc')).toBeNull()
  })

  it('does nothing while disabled', () => {
    saveDraft(1, 'abc', { title: 'T', content: 'offered' })
    const { rerender } = setup({ enabled: false })
    rerender({ userId: 1, slug: 'abc', enabled: false, dirty: true, title: 'T', content: 'typed', mindmapLayout: 'lr' })
    act(() => { vi.advanceTimersByTime(600) })
    expect(loadDraft(1, 'abc')).toMatchObject({ content: 'offered' })
  })

  it('discardDraft drops the pending write so unmount does not restore it', () => {
    const { result, rerender, unmount } = setup()
    rerender({ userId: 1, slug: 'abc', enabled: true, dirty: true, title: 'T', content: 'saved', mindmapLayout: 'lr' })
    act(() => { result.current() })
    unmount()
    expect(loadDraft(1, 'abc')).toBeNull()
  })

  it('keeps the previous page draft when the route moves to another slug', () => {
    const { rerender } = setup()
    rerender({ userId: 1, slug: 'abc', enabled: true, dirty: true, title: 'T', content: 'on abc', mindmapLayout: 'lr' })
    // New slug, its page not loaded yet → disabled.
    rerender({ userId: 1, slug: 'def', enabled: false, dirty: true, title: 'T', content: 'on abc', mindmapLayout: 'lr' })
    expect(loadDraft(1, 'abc')).toMatchObject({ content: 'on abc' })
    expect(loadDraft(1, 'def')).toBeNull()
  })
})
