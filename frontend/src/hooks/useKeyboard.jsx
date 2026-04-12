import React, { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

export default function KeyboardShortcuts({ onOpenSearch }) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const handler = (e) => {
      // Ctrl+N — new page
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        navigate('/new')
        return
      }

      // Ctrl+K — open search modal
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        onOpenSearch?.()
        return
      }

      // Ctrl+E — toggle edit/view
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
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
  }, [navigate, location, onOpenSearch])

  return null
}
