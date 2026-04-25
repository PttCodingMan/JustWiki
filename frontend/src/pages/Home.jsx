import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useSettings from '../store/useSettings'

const PER_PAGE = 20

export default function Home() {
  const { pages, total, loading, fetchPages } = usePages()
  const { allTags, fetchAllTags } = useTags()
  const siteName = useSettings((s) => s.site_name)
  const homeSlug = useSettings((s) => s.home_page_slug)
  const settingsLoaded = useSettings((s) => s.loaded)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (homeSlug) return
    document.title = `Home - ${siteName}`
    return () => { document.title = siteName }
  }, [siteName, homeSlug])

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
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text">All Pages</h1>
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {allTags.map((t) => (
            <Link
              key={t.id}
              to={`/search?q=&tag=${encodeURIComponent(t.name)}`}
              className="text-xs px-2.5 py-1 bg-surface-hover text-text-secondary rounded-full border border-border hover:border-primary hover:bg-primary-soft transition-colors"
            >
              {t.name} <span className="text-text-secondary">({t.page_count})</span>
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : pages.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-secondary text-lg mb-4">No pages yet</p>
          <Link
            to="/new"
            className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm font-medium hover:bg-primary-hover"
          >
            Create your first page
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-surface rounded-xl shadow-sm border border-border">
            {pages.map((p, i) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className={`block px-5 py-4 hover:bg-surface-hover transition-colors ${
                  i > 0 ? 'border-t border-border' : ''
                }`}
              >
                <div className="font-medium text-text">{p.title}</div>
                <div className="text-sm text-text-secondary mt-1">
                  /{p.slug} &middot; {new Date(p.updated_at).toLocaleDateString()} &middot; {p.view_count} views
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 text-sm rounded-lg ${
                      p === page
                        ? 'bg-primary text-primary-text'
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
                className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
