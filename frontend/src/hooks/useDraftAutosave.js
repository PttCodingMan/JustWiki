import { useCallback, useEffect, useRef } from 'react'
import { clearDraft, saveDraft } from '../lib/drafts'

const AUTOSAVE_DELAY = 500

/**
 * Mirror unsaved editor state into a localStorage draft (lib/drafts.js).
 *
 * While `dirty`, the latest state is written after a short debounce, and
 * flushed immediately on `pagehide` / unmount so the last keystrokes before a
 * tab close or navigation aren't lost. Becoming clean removes the draft.
 * Pass `enabled: false` to pause (e.g. while the user decides whether to
 * restore an existing draft, so it isn't overwritten first).
 *
 * Returns `discardDraft()`: call it right before a successful save or a
 * confirmed cancel navigates away — the component unmounts before the
 * "now clean" effect could run, and the unmount flush would otherwise write
 * the draft straight back.
 */
export default function useDraftAutosave({
  userId,
  slug,
  enabled,
  dirty,
  title,
  content,
  mindmapLayout,
  baseVersionRef,
}) {
  const pendingRef = useRef(null)

  const flush = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    saveDraft(pending.userId, pending.slug, pending.data)
  }, [])

  useEffect(() => {
    if (!enabled || userId == null || !slug) {
      // E.g. the route moved to another page while this one had a pending
      // write (PageEdit stays mounted across slugs): save it under its own
      // slug now rather than dropping it with the cleared timer.
      flush()
      return
    }
    if (!dirty) {
      pendingRef.current = null
      clearDraft(userId, slug)
      return
    }
    pendingRef.current = {
      userId,
      slug,
      data: { title, content, mindmapLayout, baseVersion: baseVersionRef.current },
    }
    const id = setTimeout(flush, AUTOSAVE_DELAY)
    return () => clearTimeout(id)
  }, [enabled, dirty, userId, slug, title, content, mindmapLayout, baseVersionRef, flush])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  return useCallback(() => {
    pendingRef.current = null
    clearDraft(userId, slug)
  }, [userId, slug])
}
