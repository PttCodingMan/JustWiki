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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-surface rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-border">
          <svg className="w-5 h-5 text-text-secondary shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t('searchModal.placeholder')}
            className="w-full px-3 py-4 text-base outline-none bg-transparent text-text"
          />
          <kbd className="text-xs text-text-secondary border border-border rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-text-secondary text-sm">{t('searchModal.searching')}</div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-text-secondary text-sm">{t('searchModal.noResults')}</div>
          )}
          {!loading && results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => {
                navigate(`/page/${r.slug}`)
                onClose()
              }}
              className={`w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors ${
                i === selectedIdx ? 'bg-primary-soft' : ''
              }`}
            >
              <div className="font-medium text-text text-sm">{r.title}</div>
              <div
                className="text-xs text-text-secondary mt-0.5 line-clamp-2"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(r.snippet || '', SNIPPET_SANITIZE_CONFIG),
                }}
              />
            </button>
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex gap-3">
            <span><kbd className="border rounded px-1">↑↓</kbd> {t('searchModal.navigate')}</span>
            <span><kbd className="border rounded px-1">Enter</kbd> {t('searchModal.open')}</span>
          </div>
        )}
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
