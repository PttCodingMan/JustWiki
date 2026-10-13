import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import useSearch from '../store/useSearch'
import useTags from '../store/useTags'

// Defense-in-depth: even though the backend HTML-escapes snippet text before
// wrapping matches in <mark>, we sanitize again here so a future bug in the
// escape path can't reach dangerouslySetInnerHTML with arbitrary HTML.
const SNIPPET_SANITIZE_CONFIG = { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] }

// Keep this list in sync with backend `PageType`. Unknown types fall back to
// the document icon so a client ahead of / behind the server still renders.
const TYPE_ICONS = { document: '📄', mindmap: '🧠' }

export default function SearchResults() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const tag = searchParams.get('tag') || ''
  const { results, total, loading, search } = useSearch()
  const { allTags, fetchAllTags } = useTags()
  const [selectedTag, setSelectedTag] = useState(tag)

  useEffect(() => {
    fetchAllTags()
  }, [fetchAllTags])

  useEffect(() => {
    if (q) search(q, selectedTag || null)
  }, [q, selectedTag, search])

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="page-title mb-2">
        {t('searchResults.title', { q })}
      </h1>
      <p className="text-sm text-text-tertiary mb-8">
        {t('searchResults.resultCount', { count: total })}
      </p>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-8">
          <button
            onClick={() => setSelectedTag('')}
            className={`h-7 text-xs font-medium px-3 rounded-full border transition-colors ${
              !selectedTag ? 'bg-text text-bg border-text' : 'bg-surface text-text-secondary border-border hover:border-text-tertiary hover:text-text'
            }`}
          >
            {t('searchResults.all')}
          </button>
          {allTags.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTag(t.name)}
              className={`h-7 text-xs font-medium px-3 rounded-full border transition-colors ${
                selectedTag === t.name ? 'bg-text text-bg border-text' : 'bg-surface text-text-secondary border-border hover:border-text-tertiary hover:text-text'
              }`}
            >
              <span className="opacity-50">#</span>{t.name} <span className="opacity-50 tabular-nums">{t.page_count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label={t('searchResults.searching')}>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      ) : results.length === 0 ? (
        <div className="text-center py-20 font-display text-2xl text-text-secondary">
          {t('searchResults.noResults', { q })}
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <Link
              key={r.id}
              to={`/page/${r.slug}`}
              className="group block bg-surface rounded-2xl shadow-xs border border-hairline px-6 py-5 hover:border-primary/35 hover:shadow-lg hover:-translate-y-px transition-all duration-300"
            >
              <div className="flex items-center gap-2 font-semibold text-[17px] tracking-tight text-text group-hover:text-primary transition-colors">
                <span className="text-base" aria-hidden="true">{TYPE_ICONS[r.page_type] ?? TYPE_ICONS.document}</span>
                {r.title}
              </div>
              <div
                className="text-sm leading-relaxed text-text-secondary mt-1.5 line-clamp-2"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(r.snippet || '', SNIPPET_SANITIZE_CONFIG),
                }}
              />
              <div className="text-xs text-text-tertiary mt-3 font-mono">
                /{r.slug} &middot; {t('common.views', { count: r.view_count })} &middot; {new Date(r.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
