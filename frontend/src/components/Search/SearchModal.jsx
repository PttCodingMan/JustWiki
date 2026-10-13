import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import useSearch from '../../store/useSearch'

// Defense-in-depth: the backend escapes snippet content before wrapping matches
// in <mark>, but since this render path uses dangerouslySetInnerHTML, we also
// sanitize on the way in. Only <mark> is permitted — anything else gets stripped.
const SNIPPET_SANITIZE_CONFIG = { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] }

export default function SearchModal({ isOpen, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [wasOpen, setWasOpen] = useState(isOpen)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { results, loading, search, clearSearch } = useSearch()

  // Reset form each time the modal transitions closed → open (adjusting state during render).
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setQuery('')
      clearSearch()
      setSelectedIdx(0)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [isOpen])

  const doSearch = useMemo(
    () => debounce((q) => {
      if (q.trim()) search(q.trim())
      else clearSearch()
    }, 300),
    [search, clearSearch]
  )

  const handleInput = (e) => {
    setQuery(e.target.value)
    setSelectedIdx(0)
    doSearch(e.target.value)
  }

  const handleKeyDown = (e) => {
    // Ignore keystrokes that are confirming IME composition (e.g. CJK candidate selection).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      navigate(`/page/${results[selectedIdx].slug}`)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] sm:pt-[16vh] px-3" onClick={onClose}>
      <div className="fixed inset-0 bg-[color-mix(in_oklab,var(--color-text)_22%,transparent)] backdrop-blur-[3px] animate-fade" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('common.search')}
        className="relative bg-surface rounded-2xl shadow-2xl ring-1 ring-hairline w-full max-w-[38rem] overflow-hidden animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-1 px-5 border-b border-hairline">
          <svg className="w-5 h-5 text-text-tertiary shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t('searchModal.placeholder')}
            className="w-full px-3 h-16 text-lg outline-none bg-transparent text-text placeholder:text-text-tertiary"
            aria-label={t('searchModal.placeholder')}
          />
          {loading && (
            <span className="w-4 h-4 mr-2 shrink-0 rounded-full border-2 border-primary/25 border-t-primary animate-spin" aria-hidden="true" />
          )}
          <kbd className="text-[11px] font-medium text-text-secondary bg-bg border border-border rounded-md px-1.5 h-6 flex items-center shrink-0">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[min(26rem,55vh)] overflow-y-auto p-2 empty:hidden">
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-10 text-center">
              <div className="font-display text-2xl text-text mb-1">{t('searchModal.noResults')}</div>
              <div className="text-sm text-text-tertiary">“{query}”</div>
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => {
                navigate(`/page/${r.slug}`)
                onClose()
              }}
              onMouseMove={() => { if (i !== selectedIdx) setSelectedIdx(i) }}
              className={`group w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-xl transition-colors ${
                i === selectedIdx ? 'bg-primary-soft' : ''
              } ${loading ? 'opacity-60' : ''}`}
            >
              <span className={`mt-0.5 w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ring-1 ring-inset transition-colors ${
                i === selectedIdx ? 'bg-primary text-primary-text ring-transparent' : 'bg-bg text-text-tertiary ring-hairline'
              }`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-text text-sm truncate">{r.title}</span>
                  <span className="font-mono text-[11px] text-text-tertiary truncate">/{r.slug}</span>
                </span>
                <span
                  className="block text-[13px] leading-relaxed text-text-secondary mt-0.5 line-clamp-2"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(r.snippet || '', SNIPPET_SANITIZE_CONFIG),
                  }}
                />
              </span>
              <svg className={`w-4 h-4 mt-2 shrink-0 text-primary transition-all ${i === selectedIdx ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M9 10l-5 5 5 5" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-hairline bg-bg/50 text-[11px] text-text-tertiary flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <kbd className="min-w-5 h-5 px-1 flex items-center justify-center rounded border border-border bg-surface text-text-secondary">↑</kbd>
            <kbd className="min-w-5 h-5 px-1 flex items-center justify-center rounded border border-border bg-surface text-text-secondary">↓</kbd>
            {t('searchModal.navigate')}
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="min-w-5 h-5 px-1 flex items-center justify-center rounded border border-border bg-surface text-text-secondary">↵</kbd>
            {t('searchModal.open')}
          </span>
          {loading && <span className="ml-auto">{t('searchModal.searching')}</span>}
        </div>
      </div>
    </div>
  )
}

function debounce(fn, ms) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
