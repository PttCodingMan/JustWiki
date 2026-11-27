// Helpers shared by the page review UI (components/PageReview.jsx) and the
// /reviews list (pages/Reviews.jsx). Backend model: services/page_review.py.

// Interval presets offered in the settings dialog (days).
export const REVIEW_INTERVALS = [7, 30, 90, 180, 365]

/** SQLite CURRENT_TIMESTAMP strings are UTC without a zone suffix. */
export function parseUtc(ts) {
  if (!ts) return null
  const d = new Date(`${String(ts).replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * One-line description of where a review stands ("due in 3 days", …).
 * Uses the server-computed `days_left` so the client never does date math
 * on zone-less timestamps.
 */
export function reviewDueText(t, review) {
  if (review.status === 'overdue') {
    return t('review.overdue', { count: Math.max(1, -review.days_left) })
  }
  return t('review.dueIn', { count: review.days_left })
}
