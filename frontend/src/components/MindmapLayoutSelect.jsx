import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const LAYOUT_OPTIONS = ['lr', 'rl', 'radial']

function LayoutIcon({ layout, className }) {
  // 12×12 monogram icons that mirror what each layout does to the tree:
  //   LR — root left, branches right.
  //   RL — root right, branches left.
  //   Radial — root center, branches radiating.
  // Drawn with currentColor so the dropdown's text color carries through.
  switch (layout) {
    case 'lr':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
          <circle cx="2" cy="6" r="1.4" fill="currentColor" />
          <circle cx="9" cy="3" r="1.1" fill="currentColor" />
          <circle cx="9" cy="9" r="1.1" fill="currentColor" />
          <path d="M3.4 6 L7.6 3.5 M3.4 6 L7.6 8.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
    case 'rl':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
          <circle cx="10" cy="6" r="1.4" fill="currentColor" />
          <circle cx="3" cy="3" r="1.1" fill="currentColor" />
          <circle cx="3" cy="9" r="1.1" fill="currentColor" />
          <path d="M8.6 6 L4.4 3.5 M8.6 6 L4.4 8.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
    case 'radial':
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
          <circle cx="6" cy="6" r="1.4" fill="currentColor" />
          <circle cx="6" cy="1.6" r="0.9" fill="currentColor" />
          <circle cx="10.4" cy="6" r="0.9" fill="currentColor" />
          <circle cx="6" cy="10.4" r="0.9" fill="currentColor" />
          <circle cx="1.6" cy="6" r="0.9" fill="currentColor" />
          <path d="M6 4.6V2.5 M7.4 6h2 M6 7.4v2 M4.6 6h-2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
  }
}

/**
 * Author-side picker for `pages.mindmap_layout`. Lives in the editor preview
 * header; emits a string `'lr' | 'rl' | 'radial'` via `onChange`. The save
 * payload is owned by the caller — this component only updates local state.
 */
export default function MindmapLayoutSelect({ value, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const current = LAYOUT_OPTIONS.includes(value) ? value : 'lr'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1 text-xs rounded-lg border border-border bg-surface hover:bg-surface-hover text-text-secondary"
        title={t('mindmap.layout.label')}
        aria-label={t('mindmap.layout.label')}
      >
        <LayoutIcon layout={current} />
        <span>{t(`mindmap.layout.${current}`)}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg p-1.5 min-w-[180px]">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 py-1">
            {t('mindmap.layout.label')}
          </div>
          {LAYOUT_OPTIONS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange(id)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                current === id
                  ? 'bg-surface-hover text-text font-medium'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              <LayoutIcon layout={id} className="shrink-0" />
              <span className="flex-1">{t(`mindmap.layout.${id}`)}</span>
              {current === id && <span className="text-primary text-xs">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
