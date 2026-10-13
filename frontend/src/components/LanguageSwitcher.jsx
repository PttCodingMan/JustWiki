import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../i18n'

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = i18n.resolvedLanguage || i18n.language || 'en'

  const handleSelect = (code) => {
    i18n.changeLanguage(code)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="icon-btn"
        title={t('nav.changeLanguage')}
        aria-label={t('nav.changeLanguage')}
        aria-expanded={open}
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      </button>
      {open && (
        <div className="menu-surface absolute right-0 top-full mt-2 z-50 w-48">
          <div className="eyebrow px-2.5 pt-1.5 pb-2">
            {t('nav.language')}
          </div>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[9px] text-[13px] text-left transition-colors ${
                current === lang.code
                  ? 'bg-surface-hover font-medium text-text'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text'
              }`}
            >
              <span>{lang.label}</span>
              {current === lang.code && <span className="ml-auto text-primary text-xs">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
