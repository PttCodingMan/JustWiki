import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import usePages from '../store/usePages'
import useTags from '../store/useTags'
import useBookmarks from '../store/useBookmarks'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'

export default function PageView() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { getPage, deletePage, fetchTree } = usePages()
  const { pageTags, fetchPageTags, addTag, removeTag } = useTags()
  const { checkBookmark, addBookmark, removeBookmark, fetchBookmarks } = useBookmarks()
  const [page, setPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [bookmarked, setBookmarked] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [pageData, , isBookmarked] = await Promise.all([
          getPage(slug),
          fetchPageTags(slug),
          checkBookmark(slug),
        ])
        if (!cancelled) {
          setPage(pageData)
          setBookmarked(isBookmarked)
          setLoading(false)
        }
      } catch {
        if (!cancelled) navigate('/')
      }
    }
    setLoading(true)
    load()
    return () => { cancelled = true }
  }, [slug])

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

  if (loading) return <div className="text-gray-500">Loading...</div>
  if (!page) return null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">{page.title}</h1>
          <button
            onClick={handleToggleBookmark}
            className={`text-xl transition-colors ${bookmarked ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}
            title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            {bookmarked ? '\u2605' : '\u2606'}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/page/${slug}/edit`)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            title="Edit (Ctrl+E)"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {pageTags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
            {t.name}
            <button
              onClick={() => handleRemoveTag(t.name)}
              className="text-blue-400 hover:text-blue-600 ml-0.5"
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
              className="text-xs px-2 py-1 border border-gray-300 rounded-full w-24 outline-none focus:border-blue-400"
            />
          </form>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="text-xs px-2 py-1 text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 rounded-full hover:border-gray-400"
          >
            + tag
          </button>
        )}
      </div>

      <div className="text-sm text-gray-400 mb-6">
        /{page.slug} &middot; {page.view_count} views &middot; Updated {new Date(page.updated_at).toLocaleString()}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <MarkdownViewer content={page.content_md} />
      </div>
    </div>
  )
}
