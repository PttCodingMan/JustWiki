import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import usePages from '../store/usePages'
import Editor from '../components/Editor/Editor'
import useUnsavedWarning from '../hooks/useUnsavedWarning'

export default function PageEdit() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { getPage, updatePage, fetchTree } = usePages()
  const [page, setPage] = useState(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const originalRef = useRef({ title: '', content: '' })

  useUnsavedWarning(dirty)

  useEffect(() => {
    getPage(slug).then((p) => {
      setPage(p)
      setTitle(p.title)
      setContent(p.content_md)
      originalRef.current = { title: p.title, content: p.content_md }
    })
  }, [slug])

  useEffect(() => {
    if (!page) return
    const { title: origTitle, content: origContent } = originalRef.current
    setDirty(title !== origTitle || content !== origContent)
  }, [title, content, page])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await updatePage(slug, { title, content_md: content })
      await fetchTree()
      setDirty(false)
      navigate(`/page/${slug}`)
    } catch (err) {
      console.error('Save failed:', err)
      setError(err?.response?.data?.detail || err.message || 'Save failed')
      setSaving(false)
    }
  }, [slug, title, content, saving])

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  if (!page) return <div className="text-gray-500">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold text-gray-800 bg-transparent border-none outline-none flex-1 mr-4"
          placeholder="Page title"
        />
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/page/${slug}`)}
            className="px-3 py-1.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}
      <div className="text-xs text-gray-400 mb-3">Press Ctrl+S to save</div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-h-[500px]">
        <Editor defaultValue={content} onChange={setContent} />
      </div>
    </div>
  )
}
