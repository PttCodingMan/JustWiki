import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
        className="icon-btn"
        title={t('theme.change')}
        aria-label={t('theme.change')}
        aria-expanded={open}
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a4 4 0 0 0 4-4 10 10 0 0 0-10-9.2z" />
          <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
          <circle cx="12" cy="7" r="1" fill="currentColor" />
          <circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          className="menu-surface absolute right-0 top-full mt-2 z-50 w-52"
          onMouseLeave={handleLeave}
        >
          <div className="eyebrow px-2.5 pt-1.5 pb-2">{t('theme.title')}</div>
          {Object.entries(themes).map(([id, def]) => (
            <button
              key={id}
              onMouseEnter={() => handleHover(id)}
              onClick={() => handleSelect(id)}
              className={`w-full flex items-center gap-3 px-2.5 py-1.5 rounded-[9px] text-[13px] text-left transition-colors ${
                theme === id
                  ? 'bg-surface-hover font-medium text-text'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text'
              }`}
            >
              <span className="flex shrink-0 -space-x-1.5">
                {def.preview.slice(0, 3).map((c, i) => (
                  <span
                    key={i}
                    className="w-4 h-4 rounded-full ring-2 ring-surface"
                    style={{ background: c, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' }}
                  />
                ))}
              </span>
              <span>{t(`theme.${id}`, def.name)}</span>
              {theme === id && (
                <svg className="ml-auto w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
