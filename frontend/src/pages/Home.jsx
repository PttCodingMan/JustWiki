import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'

const PER_PAGE = 20

export default function Home() {
  const { pages, total, loading, fetchPages } = usePages()
  const { allTags, fetchAllTags } = useTags()
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetchPages(page, PER_PAGE)
    fetchAllTags()
  }, [page])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">All Pages</h1>
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {allTags.map((t) => (
            <Link
              key={t.id}
              to={`/search?q=&tag=${encodeURIComponent(t.name)}`}
              className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              {t.name} <span className="text-gray-400">({t.page_count})</span>
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : pages.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-lg mb-4">No pages yet</p>
          <Link
            to="/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Create your first page
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            {pages.map((p, i) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className={`block px-5 py-4 hover:bg-gray-50 transition-colors ${
                  i > 0 ? 'border-t border-gray-100' : ''
                }`}
              >
                <div className="font-medium text-gray-800">{p.title}</div>
                <div className="text-sm text-gray-400 mt-1">
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
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-gray-100 text-gray-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
