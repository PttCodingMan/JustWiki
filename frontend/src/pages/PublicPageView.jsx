import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import publicApi from '../api/publicClient'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import ThemeSwitcher from '../components/ThemeSwitcher'
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
  const { slug } = useParams()
  const location = useLocation()
  const loginHref = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`
  const siteName = useSettings((s) => s.site_name)
  const footerText = useSettings((s) => s.footer_text)
  const [state, setState] = useState({ status: 'loading', slug: null, page: null })
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
      <div className="min-h-screen bg-bg text-text flex items-center justify-center">
        <div className="text-text-secondary">Loading...</div>
      </div>
    )
  }
  if (state.status === 'notfound') return notFound ?? <PublicNotFound />
  const page = state.page

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      <header className="flex justify-between items-center px-6 py-3 border-b border-border">
        <div className="text-sm font-semibold text-text">{siteName}</div>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
          <Link
            to={loginHref}
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-text hover:bg-primary-hover transition-colors"
          >
            Login
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-8 py-8">
        <h1 className="text-3xl font-bold text-text mb-2">{page.title}</h1>
        <div className="text-sm text-text-secondary mb-6">
          {page.author_name && <>{page.author_name} &middot; </>}
          Updated {new Date(page.updated_at).toLocaleString()}
        </div>
        <article className="bg-surface rounded-xl shadow-sm border border-border p-6 sm:p-8">
          <MarkdownViewer
            content={page.content_md}
            publicMode
            diagrams={page.diagrams || {}}
          />
        </article>
      </main>
      {footerText && (
        <footer className="text-center text-xs text-text-secondary py-4">
          {footerText}
        </footer>
      )}
    </div>
  )
}

function PublicNotFound() {
  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-text-secondary">This page is not available.</p>
    </div>
  )
}
