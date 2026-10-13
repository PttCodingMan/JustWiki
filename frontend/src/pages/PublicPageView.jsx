import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import publicApi from '../api/publicClient'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import MindmapView from '../components/MindmapView'
import TableOfContents from '../components/Viewer/TableOfContents'
import ThemeSwitcher from '../components/ThemeSwitcher'
import TocDrawer from '../components/Viewer/TocDrawer'
import useSettings from '../store/useSettings'

/**
 * Anonymous read-only viewer for pages that have been marked is_public.
 *
 * Intentionally omits: sidebar, comments, tags, backlinks, bookmarks, watch,
 * edit controls, FAB, search. The page content is fetched via the public
 * axios instance so failures do not redirect to /login.
 *
 * `notFound` lets a caller substitute the default "Page not found" screen
 * with something else (e.g. a <Navigate> to /login) when this component is
 * used as the anonymous branch of the unified /page/:slug route.
 */
export default function PublicPageView({ notFound }) {
  const { t } = useTranslation()
  const { slug } = useParams()
  const location = useLocation()
  const loginHref = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`
  const siteName = useSettings((s) => s.site_name)
  const footerText = useSettings((s) => s.footer_text)
  const [state, setState] = useState({ status: 'loading', slug: null, page: null })
  const [headings, setHeadings] = useState([])
  const [tocDrawerOpen, setTocDrawerOpen] = useState(false)
  const handleHeadings = useCallback((items) => setHeadings(items), [])
  const reqIdRef = useRef(0)

  // Inject meta tags: noindex (Q11) + same-origin referrer (Q9).
  useEffect(() => {
    const metas = [
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'same-origin' },
    ]
    const elements = metas.map(({ name, content }) => {
      const el = document.createElement('meta')
      el.name = name
      el.content = content
      document.head.appendChild(el)
      return el
    })
    return () => {
      elements.forEach((el) => {
        if (el.parentNode) el.parentNode.removeChild(el)
      })
    }
  }, [])

  useEffect(() => {
    const reqId = ++reqIdRef.current
    publicApi
      .get(`/pages/${slug}`)
      .then((res) => {
        if (reqId === reqIdRef.current) {
          setState({ status: 'ok', slug, page: res.data })
        }
      })
      .catch(() => {
        if (reqId === reqIdRef.current) {
          setState({ status: 'notfound', slug, page: null })
        }
      })
  }, [slug])

  useEffect(() => {
    if (state.page?.title) {
      document.title = `${state.page.title} - ${siteName}`
    } else {
      document.title = siteName
    }
    return () => { document.title = siteName }
  }, [state.page?.title, siteName])

  // Until the fetch for the current slug resolves, show a loading screen.
  // state.slug tracks which slug the current data belongs to so a stale
  // render of a different slug doesn't leak across navigations.
  const showLoading = state.slug !== slug
  if (showLoading) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center" aria-busy="true">
        <div className="flex items-center gap-3 text-text-tertiary text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-primary/25 border-t-primary animate-spin" aria-hidden="true" />
          {t('publicView.loading')}
        </div>
      </div>
    )
  }
  if (state.status === 'notfound') return notFound ?? <PublicNotFound />
  const page = state.page

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <header className="app-nav sticky top-0 z-40 h-14 flex justify-between items-center px-4 sm:px-6 no-print">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/favicon.png" alt="" className="h-7 w-7 shrink-0" />
          <span className="font-display text-[1.45rem] leading-none text-text truncate translate-y-[1px]">{siteName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeSwitcher />
          <Link to={loginHref} className="btn-primary ml-1">
            {t('publicView.login')}
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full px-4 sm:px-8 py-10 sm:py-14">
        <div className="max-w-[72rem] mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-14 xl:gap-20">
          <article className="min-w-0 max-w-[46rem] w-full animate-enter">
            <header className="mb-10 sm:mb-12">
              <h1 className="font-display text-[2.6rem] sm:text-[3.6rem] leading-[1.02] tracking-[-0.025em] text-text text-balance break-words">{page.title}</h1>
              <div className="mt-6 flex items-center flex-wrap gap-x-3 gap-y-2 text-[13px] text-text-secondary">
                {page.author_name && (
                  <>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold text-primary-text"
                        style={{ background: 'linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, var(--color-accent)))' }}
                        aria-hidden="true"
                      >
                        {page.author_name.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-text">{page.author_name}</span>
                    </span>
                    <span className="text-text-tertiary" aria-hidden="true">·</span>
                  </>
                )}
                <time dateTime={page.updated_at}>
                  {t('publicView.updated', { date: new Date(page.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) })}
                </time>
              </div>
            </header>
            <div>
              {page.page_type === 'mindmap' ? (
                <div className="bg-surface rounded-2xl shadow-sm border border-hairline p-4 sm:p-6">
                  <MindmapView
                    content={page.content_md}
                    title={page.title}
                    layout={page.mindmap_layout || 'lr'}
                  />
                </div>
              ) : (
                <MarkdownViewer
                  content={page.content_md}
                  publicMode
                  diagrams={page.diagrams || {}}
                  onHeadings={handleHeadings}
                />
              )}
            </div>
          </article>

          <aside className="hidden lg:block no-print">
            <div className="page-right-rail !top-24">
              <TableOfContents headings={headings} />
            </div>
          </aside>
        </div>
      </main>
      {footerText && (
        <footer className="text-center text-xs text-text-tertiary py-8 mt-8 border-t border-hairline">
          {footerText}
        </footer>
      )}

      {/* Mobile TOC drawer */}
      <TocDrawer
        headings={headings}
        open={tocDrawerOpen}
        onOpen={() => setTocDrawerOpen(true)}
        onClose={() => setTocDrawerOpen(false)}
      />
    </div>
  )
}

function PublicNotFound() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center px-6 text-center animate-enter">
      <div className="font-display text-[7rem] leading-none text-text-tertiary/50 mb-2" aria-hidden="true">404</div>
      <h1 className="page-title mb-3">{t('publicView.notFoundTitle')}</h1>
      <p className="text-text-secondary">{t('publicView.notFoundBody')}</p>
    </div>
  )
}
