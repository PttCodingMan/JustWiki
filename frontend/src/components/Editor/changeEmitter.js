/**
 * Adaptive debounce for turning editor edits into `onChange(markdown)` calls.
 *
 * Milkdown's listener plugin waits a fixed 200ms after the last edit, which
 * makes live previews (notably the mindmap) feel like they lag behind typing.
 * Serializing the whole doc to markdown isn't free though — on a large page
 * it can take tens of ms — so instead of a fixed short delay we wait
 *
 *   clamp(lastSerializeCost * COST_FACTOR, minDelay, MAX_DELAY)
 *
 * i.e. small docs update almost immediately, while big docs on slow machines
 * back off toward the old 200ms so serialization doesn't run between every
 * keystroke. MAX_DELAY equals the legacy delay, so this is never slower than
 * Milkdown's listener was.
 */

export const COST_FACTOR = 3
export const DEFAULT_MIN_DELAY = 200 // Milkdown listener's historical delay
export const MAX_DELAY = DEFAULT_MIN_DELAY

export function nextDelay(minDelay, lastCost) {
  const min = Math.max(0, minDelay ?? DEFAULT_MIN_DELAY)
  return Math.min(Math.max(min, lastCost * COST_FACTOR), Math.max(min, MAX_DELAY))
}

/**
 * @param {object} opts
 * @param {() => number} [opts.getMinDelay] read on every schedule so callers can change it live
 * @param {() => void} opts.flush serializes the doc and emits it
 * @param {() => number} [opts.now]
 */
export function createChangeEmitter({ getMinDelay = () => DEFAULT_MIN_DELAY, flush, now = () => performance.now() }) {
  let timer = null
  let lastCost = 0

  const run = () => {
    timer = null
    const start = now()
    flush()
    lastCost = now() - start
  }

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(run, nextDelay(getMinDelay(), lastCost))
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    // Exposed for tests.
    get lastCost() {
      return lastCost
    },
  }
}
