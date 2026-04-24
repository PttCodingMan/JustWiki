import React, { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import useAuth from '../store/useAuth'

export default function KeyboardShortcuts({ onOpenSearch }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  useEffect(() => {
    const handler = (e) => {
      // Always require a bare Ctrl/Cmd — Ctrl+Shift+N etc. are reserved for
      // the browser and accidentally grabbing them is a usability regression.
      const plainCtrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
      if (!plainCtrl) return

      // Let the editor keep focus: Milkdown/ProseMirror needs Ctrl+E for
      // emphasis in some locales, and generally a shortcut shouldn't yank
      // the user out of an input they're actively typing into.
      const target = e.target
      const inEditor =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA'

      // Ctrl+K — open search modal (works even from inside an input).
      if (e.key === 'k') {
        e.preventDefault()
        onOpenSearch?.()
        return
      }

      if (inEditor) return

      // Ctrl+N — new page (viewers can't create pages)
      if (e.key === 'n') {
        if (user?.role === 'viewer') return
        e.preventDefault()
        navigate('/new')
        return
      }

      // Ctrl+E — toggle edit/view
      if (e.key === 'e') {
        e.preventDefault()
        const match = location.pathname.match(/^\/page\/([^/]+)/)
        if (match) {
          const slug = match[1]
          if (location.pathname.endsWith('/edit')) {
            navigate(`/page/${slug}`)
          } else {
            navigate(`/page/${slug}/edit`)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, location, onOpenSearch, user?.role])

  return null
}
