import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useBookmarks from '../store/useBookmarks'
import useAuth from '../store/useAuth'
import usePermissions, { canEdit, canManageAcl } from '../store/usePermissions'
import useSettings from '../store/useSettings'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import MindmapView from '../components/MindmapView'
import TableOfContents from '../components/Viewer/TableOfContents'
import TocDrawer from '../components/Viewer/TocDrawer'
import Comments from '../components/Comments'
import ConfirmDialog from '../components/ConfirmDialog'
import AclManager from '../components/AclManager'
import { stripBrTags } from '../lib/markdown'
import api from '../api/client'

// Walk the sidebar tree to find the chain of ancestors for a slug so the
// header can render breadcrumbs without an extra request.
function findAncestors(nodes, slug, trail = []) {
  for (const n of nodes || []) {
    if (n.slug === slug) return trail
    const hit = findAncestors(n.children, slug, [...trail, n])
    if (hit) return hit
  }
  return null
}

// Rough reading-time estimate: ~230 wpm for space-delimited scripts and
// ~450 chars/min for CJK, which has no word separators.
function readingMinutes(md) {
  if (!md) return 1
  const text = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]()|:-]/g, ' ')
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length
  const words = text.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 230 + cjk / 450))
}

function ReadingProgress() {
  const barRef = useRef(null)
  useEffect(() => {
    const scroller = barRef.current?.closest('main')
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const max = scroller.scrollHeight - scroller.clientHeight
      const ratio = max > 0 ? Math.min(1, scroller.scrollTop / max) : 0
      if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <div className="sticky -top-6 sm:-top-10 z-20 h-0 -mx-4 sm:-mx-8 no-print" aria-hidden="true">
      <div
        ref={barRef}
        className="h-[2px] origin-left bg-primary"
        style={{ transform: 'scaleX(0)', transition: 'transform 0.1s linear' }}
      />
    </div>
  )
}

export default function PageView() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const { getPage, deletePage, fetchTree, tree } = usePages()
  const { pageTags, fetchPageTags, addTag, removeTag } = useTags()
  const { checkBookmark, addBookmark, removeBookmark, fetchBookmarks } = useBookmarks()
  const { user } = useAuth()
  const seedPermission = usePermissions((s) => s.seed)
  const siteName = useSettings((s) => s.site_name)
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
  const [publicConfirmOpen, setPublicConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [aclManagerOpen, setAclManagerOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [headings, setHeadings] = useState([])
  const [tocDrawerOpen, setTocDrawerOpen] = useState(false)

  const handleHeadings = useCallback((items) => setHeadings(items), [])

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

  const isGuest = !!user?.anonymous

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        // Bookmarks and watch are personal endpoints that 401 for the
        // synthetic guest. Skip the calls entirely instead of relying on
        // .catch(), so we don't paint a transient UI state and don't make
        // the network panel show spurious 401s on every page load.
        const personalPromises = isGuest
          ? [Promise.resolve(false), Promise.resolve({ data: { watching: false, watcher_count: 0 } })]
          : [
              checkBookmark(slug),
              api.get(`/pages/${slug}/watch`).catch(() => ({ data: { watching: false, watcher_count: 0 } })),
            ]
        const [pageData, , isBookmarked, backlinksRes, watchRes] = await Promise.all([
          getPage(slug),
          fetchPageTags(slug),
          personalPromises[0],
          api.get(`/pages/${slug}/backlinks`).catch(() => ({ data: [] })),
          personalPromises[1],
        ])
        if (!cancelled) {
          setPage(pageData)
          seedPermission(slug, pageData?.effective_permission)
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
  }, [slug, getPage, fetchPageTags, checkBookmark, navigate, isGuest])

  const watchBusy = useRef(false)
  const bookmarkBusy = useRef(false)

  const handleToggleWatch = async () => {
    // Guard against double-clicks: a second request in flight can desync
    // watching/watcherCount from the server.
    if (watchBusy.current) return
    watchBusy.current = true
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
    } finally {
      watchBusy.current = false
    }
  }

  const handleDelete = async () => {
    setDeleteConfirmOpen(false)
    await deletePage(slug)
    await fetchTree()
    navigate('/')
  }

  const handleToggleBookmark = async () => {
    if (bookmarkBusy.current) return
    bookmarkBusy.current = true
    try {
      if (bookmarked) {
        await removeBookmark(slug)
      } else {
        await addBookmark(slug)
      }
      setBookmarked(!bookmarked)
      fetchBookmarks()
    } finally {
      bookmarkBusy.current = false
    }
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
      setToast(t('pageView.toast.publicCopied'))
    } catch {
      setToast(link)
    }
    setMenuOpen(false)
  }

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(stripBrTags(page.content_md ?? ''))
      setToast(t('pageView.toast.markdownCopied'))
    } catch {
      setToast(t('pageView.toast.copyFailed'))
    }
    setMenuOpen(false)
  }

  const handleDownloadMarkdown = () => {
    const blob = new Blob([stripBrTags(page.content_md ?? '')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${page.slug}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Defer revoke: some browsers start the download asynchronously after
    // click(), and revoking the blob URL too early can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setMenuOpen(false)
  }

  const handleMakePrivate = async () => {
    try {
      await api.put(`/pages/${slug}`, { is_public: false })
      setPage((p) => ({ ...p, is_public: false }))
      setToast(t('pageView.toast.nowPrivate'))
    } catch (err) {
      console.error('Failed to make private:', err)
      setToast(t('pageView.toast.visibilityFailed'))
    }
    setMenuOpen(false)
  }

  const handleMakePublic = async () => {
    try {
      await api.put(`/pages/${slug}`, { is_public: true })
      setPage((p) => ({ ...p, is_public: true }))
      setToast(t('pageView.toast.nowPublic'))
    } catch (err) {
      console.error('Failed to make public:', err)
      setToast(t('pageView.toast.visibilityFailed'))
    }
    setPublicConfirmOpen(false)
  }

  useEffect(() => {
    if (page?.title) {
      document.title = `${page.title} - ${siteName}`
    } else {
      document.title = siteName
    }
    return () => { document.title = siteName }
  }, [page?.title, siteName])

  if (loading) {
    return (
      <div className="max-w-[72rem] mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-14 xl:gap-20" aria-busy="true" aria-label={t('common.loading')}>
        <div className="max-w-[46rem] w-full">
          <div className="skeleton h-3 w-40 mb-6" />
          <div className="skeleton h-14 w-3/4 mb-5 rounded-xl" />
          <div className="skeleton h-3.5 w-72 mb-12" />
          {[100, 94, 97, 62, 0, 91, 98, 74].map((w, i) => (
            <div key={i} className={w ? 'skeleton h-3.5 mb-4' : 'h-6'} style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="hidden lg:block space-y-3 pt-2">
          <div className="skeleton h-9 w-full rounded-[10px] mb-8" />
          {[70, 85, 60, 75].map((w, i) => <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />)}
        </div>
      </div>
    )
  }
  if (!page) return null

  const ancestors = findAncestors(tree, slug) || []
  const minutes = readingMinutes(page.content_md)
  const updatedDate = new Date(page.updated_at)
  const authorInitial = (page.author_name || '?').trim().charAt(0).toUpperCase()

  const permission = page.effective_permission
  const writable = canEdit(permission, user?.role)
  const manageable = canManageAcl(permission, user?.role)

  const renderActions = (variant) => (
    <div className={`page-actions page-actions-${variant}`}>
      {writable && (
      <button
        onClick={() => navigate(`/page/${slug}/edit`)}
        className="fab-btn fab-btn-primary"
        title={t('pageView.editTitle')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        {t('pageView.edit')}
      </button>
      )}
      {!isGuest && (
        <button
          onClick={handleToggleBookmark}
          className={`fab-btn fab-btn-secondary !px-0 w-9 ${bookmarked ? '!text-amber-500' : ''}`}
          title={bookmarked ? t('pageView.removeBookmark') : t('pageView.addBookmark')}
          aria-label={bookmarked ? t('pageView.removeBookmark') : t('pageView.addBookmark')}
          aria-pressed={bookmarked}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={bookmarked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            className={bookmarked ? 'animate-pop' : ''}
          >
            <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
          </svg>
        </button>
      )}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="fab-btn fab-btn-secondary !px-0 w-9"
          title={t('pageView.moreActions')}
          aria-label={t('pageView.moreActions')}
          aria-expanded={menuOpen}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
        {menuOpen && (
          <div className={`page-actions-menu page-actions-menu-${variant}`}>
            <button
              onClick={() => { setMenuOpen(false); navigate(`/page/${slug}/versions`) }}
              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              {t('pageView.history')}
            </button>
            {!isGuest && (
              <button
                onClick={() => { setMenuOpen(false); handleToggleWatch() }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {watching ? t('pageView.unwatch') : t('pageView.watch')}
              </button>
            )}
            {writable && (
            <>
            <div className="border-t border-border my-1" />
            {page.is_public ? (
              <>
                <button
                  onClick={handleCopyPublicLink}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                  {t('pageView.copyPublicLink')}
                </button>
                <button
                  onClick={handleMakePrivate}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  {t('pageView.makePrivate')}
                </button>
              </>
            ) : (
              <button
                onClick={() => { setMenuOpen(false); setPublicConfirmOpen(true) }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
                </svg>
                {t('pageView.makePublic')}
              </button>
            )}
            {manageable && (
              <button
                onClick={() => { setMenuOpen(false); setAclManagerOpen(true) }}
                className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M12 11c0-1.1.9-2 2-2h.01M12 11c0-1.1-.9-2-2-2H9.99M12 11v3m0 0v.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2h-3.17a2 2 0 01-1.42-.59l-1.17-1.17A2 2 0 0011.83 4H10.17a2 2 0 00-1.41.59L7.59 5.76A2 2 0 016.17 6.35H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {t('pageView.managePermissions')}
              </button>
            )}
            </>
            )}
            <div className="border-t border-border my-1" />
            <button
              onClick={handleCopyMarkdown}
              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              {t('pageView.copyMarkdown')}
            </button>
            <button
              onClick={handleDownloadMarkdown}
              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M12 3v12" />
                <path d="M7 10l5 5 5-5" />
                <path d="M5 21h14" />
              </svg>
              {t('pageView.downloadMarkdown')}
            </button>
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
              {t('pageView.exportHtml')}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                window.print()
              }}
              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
                <path d="M6 14h12v8H6z" />
              </svg>
              {t('pageView.printOrPdf')}
            </button>
            {writable && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => { setMenuOpen(false); setDeleteConfirmOpen(true) }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {t('pageView.delete')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
    <ReadingProgress />
    <div className="max-w-[72rem] mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-14 xl:gap-20">
      <article className="min-w-0 max-w-[46rem] w-full animate-enter">
        <header className="mb-10 sm:mb-12">
          {/* Breadcrumbs */}
          <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-[13px] text-text-tertiary mb-5 min-h-5">
            <Link to="/" className="hover:text-text transition-colors" aria-label={siteName}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
              </svg>
            </Link>
            {ancestors.map((a) => (
              <React.Fragment key={a.id}>
                <span aria-hidden="true" className="opacity-60">/</span>
                <Link to={`/page/${a.slug}`} className="hover:text-text transition-colors truncate max-w-[14rem]">{a.title}</Link>
              </React.Fragment>
            ))}
            <span aria-hidden="true" className="opacity-60">/</span>
            <span className="font-mono text-[12px] text-text-tertiary truncate max-w-[16rem]">{page.slug}</span>
            {page.is_public && (
              <span
                title={t('pageView.publicTitle')}
                className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t('pageView.publicLabel').replace(/^\P{L}+/u, '')}
              </span>
            )}
          </nav>

          <h1 className="font-display text-[2.6rem] sm:text-[3.6rem] leading-[1.02] tracking-[-0.025em] text-text text-balance break-words">
            {page.title}
          </h1>

          {/* Meta */}
          <div className="mt-6 flex items-center flex-wrap gap-x-3 gap-y-2 text-[13px] text-text-secondary">
            {page.author_name && (
              <span className="inline-flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary-text"
                  style={{ background: 'linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, var(--color-accent)))' }}
                  aria-hidden="true"
                >
                  {authorInitial}
                </span>
                {page.author_username ? (
                  <Link to={`/u/${encodeURIComponent(page.author_username)}`} className="font-medium text-text hover:text-primary transition-colors">
                    {page.author_name}
                  </Link>
                ) : (
                  <span className="font-medium text-text">{page.author_name}</span>
                )}
              </span>
            )}
            <span className="text-text-tertiary" aria-hidden="true">·</span>
            <time dateTime={page.updated_at} title={updatedDate.toLocaleString()}>
              {t('pageView.updated', { date: updatedDate.toLocaleDateString(i18n.resolvedLanguage || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) })}
            </time>
            <span className="text-text-tertiary" aria-hidden="true">·</span>
            <span>{t('pageView.readingTime', { count: minutes })}</span>
            <span className="text-text-tertiary max-sm:hidden" aria-hidden="true">·</span>
            <span className="max-sm:hidden">{t('common.views', { count: page.view_count })}</span>
            {watcherCount > 0 && (
              <>
                <span className="text-text-tertiary" aria-hidden="true">·</span>
                <span>{t('pageView.watchingCount', { count: watcherCount })}</span>
              </>
            )}
          </div>

          {/* Tags */}
          {(pageTags.length > 0 || !isGuest) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-5">
              {pageTags.map((tag) => (
                <span key={tag.id} className="group/tag inline-flex items-center gap-1 h-7 pl-2.5 pr-2 text-xs font-medium bg-primary-soft text-sidebar-active-text rounded-full ring-1 ring-inset ring-primary/15">
                  <span className="opacity-50">#</span>{tag.name}
                  {!isGuest && (
                    <button
                      onClick={() => handleRemoveTag(tag.name)}
                      className="w-4 h-4 -mr-0.5 flex items-center justify-center rounded-full opacity-40 group-hover/tag:opacity-100 hover:bg-primary/15 transition-opacity"
                      title={t('pageView.removeTag')}
                      aria-label={t('pageView.removeTag')}
                    >
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  )}
                </span>
              ))}
              {!isGuest && (showTagInput ? (
                <form onSubmit={handleAddTag} className="inline-flex">
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onBlur={() => { if (!newTag.trim()) setShowTagInput(false) }}
                    placeholder={t('pageView.tagPlaceholder')}
                    className="h-7 text-xs px-3 border border-primary/50 rounded-full w-28 outline-none ring-2 ring-primary/15 bg-surface text-text"
                  />
                </form>
              ) : (
                <button
                  onClick={() => setShowTagInput(true)}
                  className="h-7 text-xs px-2.5 text-text-tertiary hover:text-text border border-dashed border-border rounded-full hover:border-text-tertiary transition-colors"
                >
                  {t('pageView.addTag')}
                </button>
              ))}
            </div>
          )}

          {/* Mobile: inline actions under the title. Desktop uses the right-rail dock. */}
          <div className="mt-6 lg:hidden no-print">
            {renderActions('inline')}
          </div>
        </header>

        {page.page_type === 'mindmap' ? (
          <div className="bg-surface rounded-2xl shadow-sm border border-hairline p-4 sm:p-6">
            <MindmapView
              content={page.content_md}
              title={page.title}
              layout={page.mindmap_layout || 'lr'}
            />
          </div>
        ) : (
          <MarkdownViewer content={page.content_md} onHeadings={handleHeadings} />
        )}

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <section className="mt-16 pt-8 border-t border-hairline no-print">
            <h3 className="eyebrow mb-4">
              {t('pageView.linkedFrom', { count: backlinks.length })}
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {backlinks.map((bl) => (
                <Link
                  key={bl.id}
                  to={`/page/${bl.slug}`}
                  className="group flex items-center justify-between gap-3 px-4 py-3 bg-surface rounded-xl border border-hairline shadow-xs hover:border-primary/40 hover:shadow-md transition-all duration-200"
                >
                  <span className="text-sm font-medium text-text truncate">{bl.title}</span>
                  <svg className="w-4 h-4 shrink-0 text-text-tertiary group-hover:text-primary group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Discussion */}
        <div className="no-print mt-16">
          <Comments slug={slug} />
        </div>
      </article>

      {/* Right rail: actions pinned above TOC so Edit has one consistent home */}
      <aside className="hidden lg:block no-print">
        <div className="page-right-rail">
          <div className="page-action-dock-wrap">
            {renderActions('dock')}
          </div>
          <TableOfContents headings={headings} />
        </div>
      </aside>

      {/* Mobile TOC drawer */}
      <TocDrawer
        headings={headings}
        open={tocDrawerOpen}
        onOpen={() => setTocDrawerOpen(true)}
        onClose={() => setTocDrawerOpen(false)}
      />

      <ConfirmDialog
        open={publicConfirmOpen}
        title={t('pageView.confirm.makePublicTitle')}
        description={
          <>
            <div className="font-medium text-text mb-1">&quot;{page.title}&quot;</div>
            <div>{t('pageView.confirm.makePublicBody')}</div>
          </>
        }
        confirmLabel={t('pageView.confirm.makePublicLabel')}
        cancelLabel={t('pageView.confirm.cancel')}
        onConfirm={handleMakePublic}
        onCancel={() => setPublicConfirmOpen(false)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('pageView.confirm.deleteTitle')}
        description={
          <>
            <div className="font-medium text-text mb-1">&quot;{page.title}&quot;</div>
            <div>{t('pageView.confirm.deleteBody')}</div>
          </>
        }
        confirmLabel={t('pageView.confirm.deleteLabel')}
        cancelLabel={t('pageView.confirm.cancel')}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <AclManager
        slug={slug}
        open={aclManagerOpen}
        onClose={() => setAclManagerOpen(false)}
      />

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text text-bg text-sm font-medium px-4 py-2.5 rounded-xl shadow-xl z-[110] animate-enter flex items-center gap-2">
          {toast}
        </div>
      )}
    </div>
    </>
  )
}
