import { useEffect, useRef, useState } from 'react'
import useTheme, { themes } from '../store/useTheme'

function applyThemePreview(themeId) {
  const t = themes[themeId] || themes.light
  document.documentElement.setAttribute('data-theme', themeId)
  document.documentElement.classList.toggle('dark', t.dark)
}

/**
 * Theme dropdown used by both the authenticated Layout navbar and the
 * PublicPageView header. Hovering previews, clicking commits, and closing
 * without selecting restores the previously saved theme.
 */
export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const savedTheme = useRef(theme)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        applyThemePreview(savedTheme.current)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    savedTheme.current = theme
    setOpen(!open)
  }

  const handleHover = (id) => applyThemePreview(id)
  const handleLeave = () => applyThemePreview(savedTheme.current)

  const handleSelect = (id) => {
    savedTheme.current = id
    setTheme(id)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="p-1.5 rounded hover:bg-surface-hover text-text-secondary flex items-center gap-1"
        title="Change theme"
        aria-label="Change theme"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M12 2c3 2.5 4.5 6 4.5 10s-1.5 7.5-4.5 10" />
          <path d="M12 2c-3 2.5-4.5 6-4.5 10s1.5 7.5 4.5 10" />
          <path d="M2 12h20" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-lg p-2 z-50 w-44"
          onMouseLeave={handleLeave}
        >
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 py-1 mb-1">Theme</div>
          {Object.entries(themes).map(([id, t]) => (
            <button
              key={id}
              onMouseEnter={() => handleHover(id)}
              onClick={() => handleSelect(id)}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                theme === id
                  ? 'bg-surface-hover font-medium text-text'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              <span className="flex gap-0.5 shrink-0">
                {t.preview.map((c, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full border border-border"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span>{t.name}</span>
              {theme === id && <span className="ml-auto text-primary text-xs">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
