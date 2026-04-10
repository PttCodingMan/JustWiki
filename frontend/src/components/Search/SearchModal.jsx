import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useSearch from '../../store/useSearch'

export default function SearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const { results, loading, search, clearSearch } = useSearch()

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      clearSearch()
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const doSearch = useCallback(
    debounce((q) => {
      if (q.trim()) search(q.trim())
      else clearSearch()
    }, 300),
    []
  )

  const handleInput = (e) => {
    setQuery(e.target.value)
    setSelectedIdx(0)
    doSearch(e.target.value)
  }

  const handleKeyDown = (e) => {
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
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-gray-200">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Search pages..."
            className="w-full px-3 py-4 text-base outline-none bg-transparent"
          />
          <kbd className="text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">Searching...</div>
          )}
          {!loading && query && results.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">No results found</div>
          )}
          {!loading && results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => {
                navigate(`/page/${r.slug}`)
                onClose()
              }}
              className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                i === selectedIdx ? 'bg-blue-50' : ''
              }`}
            >
              <div className="font-medium text-gray-800 text-sm">{r.title}</div>
              <div
                className="text-xs text-gray-500 mt-0.5 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 flex gap-3">
            <span><kbd className="border rounded px-1">↑↓</kbd> navigate</span>
            <span><kbd className="border rounded px-1">Enter</kbd> open</span>
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
