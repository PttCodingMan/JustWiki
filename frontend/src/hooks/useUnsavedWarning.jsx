import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// Messages of the editors that currently hold unsaved changes. Lets global UI
// (header "New page" button, keyboard shortcuts, search results, …) that
// navigates via navigate() — not an <a> click — ask before discarding edits.
const activeGuards = new Set()

/**
 * Warn before losing unsaved edits.
 *
 * Two layers, because the app uses <BrowserRouter> (not a data router), so
 * React Router's useBlocker is unavailable:
 *   1. `beforeunload` — covers full-page unloads (refresh, tab close, typing a
 *      new URL, external links).
 *   2. A capture-phase click guard on in-app <a> navigation — covers SPA
 *      links (sidebar tree, wikilinks, the nav logo, bookmarks). Firing in the
 *      capture phase on `document` lets us preventDefault + stopPropagation
 *      before React Router's <Link> onClick runs, so a cancelled confirm keeps
 *      the user on the page.
 *
 * Button-driven navigations aren't <a> clicks. Inside the editor component
 * (e.g. a Cancel button) guard them with confirmDiscard(); anywhere else
 * (header, shortcuts, search modal, …) use useGuardedNavigate(), which asks
 * whenever any mounted editor registered here is dirty.
 *
 * @param {boolean} isDirty  whether there are unsaved changes
 * @param {string}  message  confirmation prompt shown before discarding
 */
export default function useUnsavedWarning(isDirty, message) {
  useEffect(() => {
    if (!isDirty) return

    const guard = { message }
    activeGuards.add(guard)

    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }

    const onClickCapture = (e) => {
      // Let modified clicks (new tab/window), non-left buttons, and already
      // handled events through untouched.
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return
      }
      // Ignore clicks inside the editor (contenteditable): links there don't
      // navigate via the router — clicking one just places the cursor — so a
      // confirm there would be a false positive.
      if (e.target.closest?.('[contenteditable="true"], [contenteditable=""]')) {
        return
      }
      const anchor = e.target.closest?.('a[href]')
      if (!anchor) return
      const targetAttr = anchor.getAttribute('target')
      if ((targetAttr && targetAttr !== '_self') || anchor.hasAttribute('download')) {
        return
      }
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#')) return

      let url
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      // External links unload the page → beforeunload handles those.
      if (url.origin !== window.location.origin) return
      // No navigation if it points at the current location.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return
      }
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      activeGuards.delete(guard)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [isDirty, message])
}

/**
 * Imperative confirm for button-driven navigation (Cancel, etc.). Returns
 * true if it's safe to proceed (not dirty, or the user accepted the prompt).
 */
export function confirmDiscard(isDirty, message) {
  return !isDirty || window.confirm(message)
}

/**
 * Confirm leaving while any editor has unsaved changes. Returns true if it's
 * safe to proceed (nothing dirty, or the user accepted the prompt).
 */
export function confirmLeave() {
  if (activeGuards.size === 0) return true
  const last = [...activeGuards].pop()
  return window.confirm(last.message)
}

function isCurrentLocation(to) {
  if (typeof to !== 'string') return false
  try {
    const url = new URL(to, window.location.href)
    return url.pathname === window.location.pathname && url.search === window.location.search
  } catch {
    return false
  }
}

/**
 * navigate() that asks before discarding unsaved edits. Use it for
 * programmatic navigation outside the editor page itself. A target equal to
 * the current location is passed through without asking — the editor stays
 * mounted, so nothing is lost. Returns whether navigation happened.
 */
export function useGuardedNavigate() {
  const navigate = useNavigate()
  return useCallback(
    (to, ...rest) => {
      if (isCurrentLocation(to) || confirmLeave()) {
        navigate(to, ...rest)
        return true
      }
      return false
    },
    [navigate]
  )
}
