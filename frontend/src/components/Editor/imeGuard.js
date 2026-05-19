// Window (ms) after `compositionend` during which a *stray* Enter keydown
// is suppressed. On Windows, the Enter that confirms an IME selection can
// surface as an extra keydown fired right after `compositionend` (with
// `isComposing` already false); ProseMirror's default Enter handler would
// turn that into a spurious block split ("the line shifts down"). That
// stray Enter is part of the same physical keypress as the IME confirm, so
// it lands within a few ms — a deliberate newline is a separate, much
// later keypress, so a short window cleanly separates the two.
export const POST_COMPOSITION_ENTER_MS = 50

// Pure decision: should this keydown be swallowed as a post-composition
// stray Enter? `lastCompositionEndAt` is the timestamp of the most recent
// `compositionend` (0 if none yet); `now` is the current timestamp.
export function isStrayPostCompositionEnter(event, lastCompositionEndAt, now) {
  // An Enter that is still part of an active composition (e.g. Zhuyin
  // pressing Enter to commit bopomofo into Han characters) MUST reach the
  // IME. Never preventDefault it, or the IME can't finalize the conversion
  // and commits the raw phonetic buffer instead of the converted text.
  if (event.isComposing || event.keyCode === 229) return false
  if (event.key !== 'Enter') return false
  return now - lastCompositionEndAt <= POST_COMPOSITION_ENTER_MS
}
