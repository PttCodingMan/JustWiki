import { describe, it, expect } from 'vitest'
import { isStrayPostCompositionEnter, POST_COMPOSITION_ENTER_MS, NO_COMPOSITION } from './imeGuard'

const enter = (overrides = {}) => ({ key: 'Enter', keyCode: 13, isComposing: false, ...overrides })

describe('isStrayPostCompositionEnter', () => {
  it('suppresses a stray Enter fired right after compositionend', () => {
    expect(isStrayPostCompositionEnter(enter(), 1000, 1001)).toBe(true)
  })

  it('suppresses at the exact end of the window (inclusive)', () => {
    expect(
      isStrayPostCompositionEnter(enter(), 1000, 1000 + POST_COMPOSITION_ENTER_MS),
    ).toBe(true)
  })

  it('does NOT suppress an Enter that is still part of composition (isComposing)', () => {
    // Zhuyin pressing Enter to commit bopomofo->Han: must reach the IME or
    // the raw phonetic buffer gets dumped instead of the converted text.
    expect(isStrayPostCompositionEnter(enter({ isComposing: true }), 1000, 1001)).toBe(false)
  })

  it('does NOT suppress an Enter delivered to the IME (keyCode 229)', () => {
    expect(isStrayPostCompositionEnter(enter({ keyCode: 229 }), 1000, 1001)).toBe(false)
  })

  it('does NOT suppress a deliberate Enter long after compositionend', () => {
    expect(
      isStrayPostCompositionEnter(enter(), 1000, 1000 + POST_COMPOSITION_ENTER_MS + 1),
    ).toBe(false)
  })

  it('does NOT suppress Enter when no composition has happened yet', () => {
    expect(isStrayPostCompositionEnter(enter(), NO_COMPOSITION, 999999)).toBe(false)
  })

  it('does NOT suppress a plain Enter pressed within 50ms of page load', () => {
    // Regression: a 0 sentinel + performance.now()-based `now` would make
    // `now - 0 <= 50` true during the first 50ms after the time origin.
    expect(isStrayPostCompositionEnter(enter(), NO_COMPOSITION, 12)).toBe(false)
  })

  it('ignores non-Enter keys even right after compositionend', () => {
    expect(isStrayPostCompositionEnter({ key: 'a', keyCode: 65, isComposing: false }, 1000, 1001)).toBe(false)
  })
})
