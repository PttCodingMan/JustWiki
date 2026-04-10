import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useSearch from '../store/useSearch'
import useTags from '../store/useTags'

export default function SearchResults() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const tag = searchParams.get('tag') || ''
  const { results, total, loading, search } = useSearch()
  const { allTags, fetchAllTags } = useTags()
  const [selectedTag, setSelectedTag] = useState(tag)

  useEffect(() => {
    fetchAllTags()
  }, [])

  useEffect(() => {
    if (q) search(q, selectedTag || null)
  }, [q, selectedTag])

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">
        Search: "{q}"
      </h1>
      <p className="text-sm text-gray-400 mb-4">
        {total} result{total !== 1 ? 's' : ''} found
      </p>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedTag('')}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !selectedTag ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
            }`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTag(t.name)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedTag === t.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {t.name} ({t.page_count})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Searching...</p>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No results found for "{q}"
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((r) => (
            <Link
              key={r.id}
              to={`/page/${r.slug}`}
              className="block bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4 hover:border-blue-200 transition-colors"
            >
              <div className="font-medium text-gray-800">{r.title}</div>
              <div
                className="text-sm text-gray-500 mt-1 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
              <div className="text-xs text-gray-400 mt-2">
                /{r.slug} &middot; {r.view_count} views &middot; {new Date(r.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
