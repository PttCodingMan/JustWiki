import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useBookmarks from '../store/useBookmarks'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import Comments from '../components/Comments'
import ConfirmDialog from '../components/ConfirmDialog'
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
  const [watching, setWatching] = useState(false)
  const [watcherCount, setWatcherCount] = useState(0)
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [backlinks, setBacklinks] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const [publicMenuOpen, setPublicMenuOpen] = useState(false)
  const publicMenuRef = useRef(null)
  const [publicConfirmOpen, setPublicConfirmOpen] = useState(false)
  const [toast, setToast] = useState('')

  // Close public menu on outside click
  useEffect(() => {
    if (!publicMenuOpen) return
    const handleClick = (e) => {
      if (publicMenuRef.current && !publicMenuRef.current.contains(e.target)) {
        setPublicMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [publicMenuOpen])

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(id)
  }, [toast])

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
      setLoading(true)
      try {
        const [pageData, , isBookmarked, backlinksRes, watchRes] = await Promise.all([
          getPage(slug),
          fetchPageTags(slug),
          checkBookmark(slug),
          api.get(`/pages/${slug}/backlinks`).catch(() => ({ data: [] })),
          api.get(`/pages/${slug}/watch`).catch(() => ({ data: { watching: false, watcher_count: 0 } })),
        ])
        if (!cancelled) {
          setPage(pageData)
          setBookmarked(isBookmarked)
          setWatching(watchRes.data.watching)
          setWatcherCount(watchRes.data.watcher_count || 0)
          setBacklinks(Array.isArray(backlinksRes.data) ? backlinksRes.data : (backlinksRes.data?.items || []))
        }
      } catch {
        if (!cancelled) navigate('/')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [slug, getPage, fetchPageTags, checkBookmark, navigate])

  const handleToggleWatch = async () => {
    try {
      if (watching) {
        await api.delete(`/pages/${slug}/watch`)
        setWatching(false)
        setWatcherCount((c) => Math.max(0, c - 1))
      } else {
        await api.post(`/pages/${slug}/watch`)
        setWatching(true)
        setWatcherCount((c) => c + 1)
      }
    } catch (err) {
      console.error('Toggle watch failed:', err)
    }
  }

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

  const handleCopyPublicLink = async () => {
    const link = `${window.location.origin}/page/${slug}`
    try {
      await navigator.clipboard.writeText(link)
      setToast('Public link copied')
    } catch {
      setToast(link)
    }
    setPublicMenuOpen(false)
  }

  const handleMakePrivate = async () => {
    try {
      await api.put(`/pages/${slug}`, { is_public: false })
      setPage((p) => ({ ...p, is_public: false }))
      setToast('Page is now private')
    } catch (err) {
      console.error('Failed to make private:', err)
      setToast('Failed to update visibility')
    }
    setPublicMenuOpen(false)
  }

  const handleMakePublic = async () => {
    try {
      await api.put(`/pages/${slug}`, { is_public: true })
      setPage((p) => ({ ...p, is_public: true }))
      setToast('Page is now public')
    } catch (err) {
      console.error('Failed to make public:', err)
      setToast('Failed to update visibility')
    }
    setPublicConfirmOpen(false)
  }

  if (loading) return <div className="text-text-secondary">Loading...</div>
  if (!page) return null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold text-text">{page.title}</h1>
        {page.is_public && (
          <div className="relative" ref={publicMenuRef}>
            <button
              onClick={() => setPublicMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 rounded-full hover:brightness-95"
              title="This page is public — click for options"
            >
              <span role="img" aria-hidden="true">🌐</span> Public
              <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {publicMenuOpen && (
              <div className="absolute left-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-1 z-50">
                <button
                  onClick={handleCopyPublicLink}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover"
                >
                  Copy public link
                </button>
                <button
                  onClick={handleMakePrivate}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover"
                >
                  Make private
                </button>
              </div>
            )}
          </div>
        )}
        <button
          onClick={handleToggleBookmark}
          className={`text-xl transition-colors ${bookmarked ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
          title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
        >
          {bookmarked ? '\u2605' : '\u2606'}
        </button>
        <button
          onClick={handleToggleWatch}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
            watching
              ? 'bg-primary-soft text-primary border-primary/40'
              : 'text-text-secondary border-border hover:border-text-secondary'
          }`}
          title={watching ? 'Unwatch this page' : 'Watch this page for changes'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {watching ? 'Watching' : 'Watch'}
          {watcherCount > 0 && <span className="text-text-secondary">({watcherCount})</span>}
        </button>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {pageTags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-primary-soft text-primary dark:text-accent rounded-full">
            {t.name}
            <button
              onClick={() => handleRemoveTag(t.name)}
              className="text-primary/60 hover:text-primary ml-0.5"
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
              className="text-xs px-2 py-1 border border-border rounded-full w-24 outline-none focus:border-primary bg-transparent text-text"
            />
          </form>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="text-xs px-2 py-1 text-text-secondary hover:text-text border border-dashed border-border rounded-full hover:border-text-secondary"
          >
            + tag
          </button>
        )}
      </div>

      <div className="text-sm text-text-secondary mb-6">
        {page.author_name && <>{page.author_name} &middot; </>}
        /{page.slug} &middot; {page.view_count} views &middot; Updated {new Date(page.updated_at).toLocaleString()}
      </div>
      <div className="bg-surface rounded-xl shadow-sm border border-border p-8">
        <MarkdownViewer content={page.content_md} />
      </div>

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className="mt-6 p-4 bg-surface rounded-xl shadow-sm border border-border">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Linked from ({backlinks.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {backlinks.map((bl) => (
              <Link
                key={bl.id}
                to={`/page/${bl.slug}`}
                className="text-sm px-3 py-1.5 bg-surface-hover text-primary rounded-lg hover:bg-primary-soft border border-border"
              >
                {bl.title}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Discussion */}
      <Comments slug={slug} />

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
            <div className="absolute right-0 bottom-full mb-2 w-44 bg-surface rounded-lg shadow-lg border border-border py-1 z-50">
              <button
                onClick={() => { setMenuOpen(false); navigate(`/page/${slug}/versions`) }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                History
              </button>
              {!page.is_public && (
                <button
                  onClick={() => { setMenuOpen(false); setPublicConfirmOpen(true) }}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
                  </svg>
                  Make public
                </button>
              )}
              <div className="border-t border-border my-1" />
              <button
                onClick={() => {
                  setMenuOpen(false)
                  window.open(`/api/export/page/${slug}?format=html`, '_blank')
                }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export HTML
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  window.open(`/api/export/page/${slug}?format=pdf`, '_blank')
                }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Export PDF
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => { setMenuOpen(false); handleDelete() }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2"
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

      <ConfirmDialog
        open={publicConfirmOpen}
        title="Make this page public?"
        description={
          <>
            <div className="font-medium text-text mb-1">&quot;{page.title}&quot;</div>
            <div>You can switch it back to private at any time.</div>
          </>
        }
        confirmLabel="Make public"
        cancelLabel="Cancel"
        onConfirm={handleMakePublic}
        onCancel={() => setPublicConfirmOpen(false)}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface border border-border text-text text-sm px-4 py-2 rounded-lg shadow-lg z-[90]">
          {toast}
        </div>
      )}
    </div>
  )
}
