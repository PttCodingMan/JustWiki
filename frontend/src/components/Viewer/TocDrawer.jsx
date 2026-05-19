import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import TableOfContents from './TableOfContents'

/**
 * Mobile-only TOC: a fixed FAB at bottom-right that slides up a bottom sheet.
 * Hidden on lg+ (desktop shows the right-rail TOC instead).
 */
export default function TocDrawer({ headings, open, onOpen, onClose }) {
  const { t } = useTranslation()
  const sheetRef = useRef(null)

  // Close on backdrop click
  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Trap body scroll while drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!headings || headings.length === 0) return null

  return (
    <>
      {/* FAB — only visible on mobile */}
      <button
        className="toc-fab lg:hidden no-print"
        onClick={onOpen}
        aria-label={t('toc.label')}
        title={t('toc.label')}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="13" y2="10" />
          <line x1="3" y1="15" x2="10" y2="15" />
        </svg>
      </button>

      {/* Backdrop + bottom sheet */}
      {open && (
        <div
          className="toc-drawer-backdrop lg:hidden"
          onClick={handleBackdrop}
          aria-hidden="true"
        >
          <div
            ref={sheetRef}
            className="toc-drawer-sheet"
            role="dialog"
            aria-label={t('toc.label')}
            aria-modal="true"
          >
            <div className="toc-drawer-handle" />
            <div
              className="toc-drawer-body"
              onClick={(e) => {
                // Close after a heading is clicked (user wants to navigate)
                if (e.target.closest('a')) onClose()
              }}
            >
              <TableOfContents headings={headings} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
