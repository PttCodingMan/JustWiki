import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useSettings from '../store/useSettings'

const PER_PAGE = 20

export default function Home() {
  const { t } = useTranslation()
  const { pages, total, loading, fetchPages } = usePages()
  const { allTags, fetchAllTags } = useTags()
  const siteName = useSettings((s) => s.site_name)
  const homeSlug = useSettings((s) => s.home_page_slug)
  const settingsLoaded = useSettings((s) => s.loaded)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (homeSlug) return
    document.title = `${t('home.browserTitle')} - ${siteName}`
    return () => { document.title = siteName }
  }, [siteName, homeSlug, t])

  useEffect(() => {
    if (homeSlug) return
    fetchPages(page, PER_PAGE)
    fetchAllTags()
  }, [page, homeSlug])

  // Wait until settings load so we don't briefly render the page list
  // before redirecting (and don't fire a needless /api/pages request).
  if (!settingsLoaded) return null
  if (homeSlug) return <Navigate to={`/page/${homeSlug}`} replace />

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-10 sm:mb-12 animate-enter">
        <div className="eyebrow mb-4">{siteName}</div>
        <h1 className="page-title !text-[clamp(2.75rem,2rem+3vw,4.5rem)]">{t('home.title')}</h1>
        {total > 0 && (
          <p className="mt-3 text-text-tertiary text-sm tabular-nums">
            {t('home.pageCount', { count: total })}
          </p>
        )}
      </header>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-8 animate-enter [animation-delay:60ms]">
          {allTags.map((t) => (
            <Link
              key={t.id}
              to={`/search?q=&tag=${encodeURIComponent(t.name)}`}
              className="h-7 inline-flex items-center gap-1 text-xs font-medium px-3 bg-surface text-text-secondary rounded-full border border-border hover:border-text-tertiary hover:text-text transition-colors"
            >
              <span className="opacity-50">#</span>{t.name} <span className="opacity-50 tabular-nums">{t.page_count}</span>
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-3" aria-busy="true" aria-label={t('common.loading')}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
      ) : pages.length === 0 ? (
        <div className="text-center py-24 rounded-3xl border border-dashed border-border">
          <p className="font-display text-4xl text-text mb-6">{t('common.noPagesYet')}</p>
          <Link to="/new" className="btn-primary !h-10 !px-5">
            {t('common.createFirstPage')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            {pages.map((p, i) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className="group relative flex flex-col justify-between min-h-28 p-5 bg-surface rounded-2xl border border-hairline shadow-xs hover:shadow-lg hover:border-primary/35 hover:-translate-y-0.5 transition-all duration-300 animate-enter"
                style={{ animationDelay: `${80 + Math.min(i, 10) * 35}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold text-[17px] leading-snug tracking-tight text-text group-hover:text-primary transition-colors line-clamp-2">{p.title}</div>
                  <svg className="w-4 h-4 mt-1 shrink-0 text-text-tertiary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M7 17L17 7M8 7h9v9" />
                  </svg>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-text-tertiary">
                  <span className="font-mono truncate">/{p.slug}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{new Date(p.updated_at).toLocaleDateString()}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{t('common.views', { count: p.view_count })}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-10">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-9 px-3.5 text-[13px] font-medium rounded-[10px] border border-border bg-surface text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.previous')}
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    aria-current={p === page ? 'page' : undefined}
                    className={`w-9 h-9 text-[13px] font-medium rounded-[10px] tabular-nums transition-colors ${
                      p === page
                        ? 'bg-text text-bg'
                        : 'hover:bg-surface-hover text-text-secondary'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-9 px-3.5 text-[13px] font-medium rounded-[10px] border border-border bg-surface text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
