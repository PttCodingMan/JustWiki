import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'

export default function Home() {
  const { pages, total, loading, fetchPages } = usePages()
  const { allTags, fetchAllTags } = useTags()
  const [selectedTag, setSelectedTag] = useState('')

  useEffect(() => {
    fetchPages()
    fetchAllTags()
  }, [])

  // Client-side tag filter (since tag filter on list isn't in the backend yet for list endpoint)
  const filteredPages = pages

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">All Pages</h1>
        <Link
          to="/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + New Page
        </Link>
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
      ) : filteredPages.length === 0 ? (
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {filteredPages.map((page, i) => (
            <Link
              key={page.id}
              to={`/page/${page.slug}`}
              className={`block px-5 py-4 hover:bg-gray-50 transition-colors ${
                i > 0 ? 'border-t border-gray-100' : ''
              }`}
            >
              <div className="font-medium text-gray-800">{page.title}</div>
              <div className="text-sm text-gray-400 mt-1">
                /{page.slug} &middot; {new Date(page.updated_at).toLocaleDateString()} &middot; {page.view_count} views
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
