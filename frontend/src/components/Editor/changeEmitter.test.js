import { describe, it, expect, vi, afterEach } from 'vitest'
import { createChangeEmitter, nextDelay, MAX_DELAY, DEFAULT_MIN_DELAY } from './changeEmitter'

describe('nextDelay', () => {
  it('uses the min delay while serialization is cheap', () => {
    expect(nextDelay(60, 0)).toBe(60)
    expect(nextDelay(60, 10)).toBe(60)
  })

  it('backs off proportionally to serialization cost', () => {
    expect(nextDelay(60, 50)).toBe(150)
  })

  it('never backs off past the legacy 200ms', () => {
    expect(MAX_DELAY).toBe(DEFAULT_MIN_DELAY)
    expect(nextDelay(60, 10_000)).toBe(MAX_DELAY)
    expect(nextDelay(200, 10_000)).toBe(200)
  })

  it('defaults to the historical 200ms', () => {
    expect(nextDelay(undefined, 0)).toBe(DEFAULT_MIN_DELAY)
  })
})

describe('createChangeEmitter', () => {
  afterEach(() => vi.useRealTimers())

  it('debounces bursts into a single flush', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const e = createChangeEmitter({ getMinDelay: () => 60, flush, now: () => 0 })
    e.schedule()
    vi.advanceTimersByTime(40)
    e.schedule()
    vi.advanceTimersByTime(40)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('waits longer after an expensive flush', () => {
    vi.useFakeTimers()
    let t = 0
    const flush = vi.fn(() => { t += 50 }) // each flush "costs" 50ms
    const e = createChangeEmitter({ getMinDelay: () => 60, flush, now: () => t })
    e.schedule()
    vi.advanceTimersByTime(60)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(e.lastCost).toBe(50)

    e.schedule()
    vi.advanceTimersByTime(149)
    expect(flush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('cancel drops a pending flush', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const e = createChangeEmitter({ getMinDelay: () => 60, flush, now: () => 0 })
    e.schedule()
    e.cancel()
    vi.advanceTimersByTime(1000)
    expect(flush).not.toHaveBeenCalled()
  })
})
