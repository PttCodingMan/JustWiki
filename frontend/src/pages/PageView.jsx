import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useBookmarks from '../store/useBookmarks'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import api from '../api/client'

export default function PageView() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { getPage, deletePage, fetchTree } = usePages()
  const { pageTags, fetchPageTags, addTag, removeTag } = useTags()
  const { checkBookmark, addBookmark, removeBookmark, fetchBookmarks } = useBookmarks()
  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bookmarked, setBookmarked] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [backlinks, setBacklinks] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [pageData, , isBookmarked, backlinksRes] = await Promise.all([
          getPage(slug),
          fetchPageTags(slug),
          checkBookmark(slug),
          api.get(`/pages/${slug}/backlinks`).catch(() => ({ data: [] })),
        ])
        if (!cancelled) {
          setPage(pageData)
          setBookmarked(isBookmarked)
          setBacklinks(Array.isArray(backlinksRes.data) ? backlinksRes.data : (backlinksRes.data?.items || []))
          setLoading(false)
        }
      } catch {
        if (!cancelled) navigate('/')
      }
    }
    setLoading(true)
    load()
    return () => { cancelled = true }
  }, [slug])

  const handleDelete = async () => {
    if (!confirm(`Delete "${page.title}"?`)) return
    await deletePage(slug)
    await fetchTree()
    navigate('/')
  }

  const handleToggleBookmark = async () => {
    if (bookmarked) {
      await removeBookmark(slug)
    } else {
      await addBookmark(slug)
    }
    setBookmarked(!bookmarked)
    fetchBookmarks()
  }

  const handleAddTag = async (e) => {
    e.preventDefault()
    if (!newTag.trim()) return
    await addTag(slug, newTag.trim())
    setNewTag('')
    setShowTagInput(false)
  }

  const handleRemoveTag = async (tagName) => {
    await removeTag(slug, tagName)
  }

  if (loading) return <div className="text-gray-500">Loading...</div>
  if (!page) return null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-800">{page.title}</h1>
        <button
          onClick={handleToggleBookmark}
          className={`text-xl transition-colors ${bookmarked ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
          title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          {bookmarked ? '\u2605' : '\u2606'}
        </button>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {pageTags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
            {t.name}
            <button
              onClick={() => handleRemoveTag(t.name)}
              className="text-blue-400 hover:text-blue-600 ml-0.5"
              title="Remove tag"
            >
              &times;
            </button>
          </span>
        ))}
        {showTagInput ? (
          <form onSubmit={handleAddTag} className="inline-flex">
            <input
              autoFocus
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onBlur={() => { if (!newTag.trim()) setShowTagInput(false) }}
              placeholder="Tag name"
              className="text-xs px-2 py-1 border border-gray-300 rounded-full w-24 outline-none focus:border-blue-400"
            />
          </form>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 rounded-full hover:border-gray-400"
          >
            + tag
          </button>
        )}
      </div>

      <div className="text-sm text-gray-400 mb-6">
        /{page.slug} &middot; {page.view_count} views &middot; Updated {new Date(page.updated_at).toLocaleString()}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <MarkdownViewer content={page.content_md} />
      </div>

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className="mt-6 p-4 bg-white rounded-xl shadow-sm border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Linked from ({backlinks.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {backlinks.map((bl) => (
              <Link
                key={bl.id}
                to={`/page/${bl.slug}`}
                className="text-sm px-3 py-1.5 bg-gray-50 text-blue-600 rounded-lg hover:bg-blue-50 border border-gray-200"
              >
                {bl.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Floating action bar */}
      <div className="floating-action-bar">
        <button
          onClick={() => navigate(`/page/${slug}/edit`)}
          className="fab-btn fab-btn-primary"
          title="Edit (Ctrl+E)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="fab-btn fab-btn-secondary"
            title="More actions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 bottom-full mb-2 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <button
                onClick={() => { setMenuOpen(false); navigate(`/page/${slug}/versions`) }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                History
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { setMenuOpen(false); handleDelete() }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
