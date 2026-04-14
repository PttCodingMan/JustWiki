import { useEffect, useState, useRef } from 'react'
import api from '../../api/client'

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MediaPickerModal({ open, onClose, onInsert }) {
  const [tab, setTab] = useState('media')
  const [items, setItems] = useState([])
  const [diagrams, setDiagrams] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const loadMedia = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/media')
      setItems(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load media library')
    } finally {
      setLoading(false)
    }
  }

  const loadDiagrams = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/diagrams')
      setDiagrams(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load diagrams')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      // Reset to the media tab so the next open starts fresh — this runs
      // while closed so it does not trigger any fetch.
      setTab('media')
      return
    }
    setQuery('')
    if (tab === 'media') loadMedia()
    else if (tab === 'diagrams') loadDiagrams()
  }, [open, tab])

  const handleTabChange = (next) => {
    if (next !== tab) setTab(next)
  }

  if (!open) return null

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post('/media/upload', fd)
      // Insert right away and close
      onInsert(buildMediaMarkdown(res.data))
      onClose()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const buildMediaMarkdown = (item) => {
    const isImage = item.mime_type?.startsWith('image/')
    const label = (item.original_name || '').replace(/[[\]()]/g, '')
    return isImage ? `![${label}](${item.url})` : `[${label}](${item.url})`
  }

  const buildDiagramDirective = (diagram) => `::drawio[${diagram.id}]`

  const q = query.trim().toLowerCase()
  const filteredMedia = q
    ? items.filter(
        (m) =>
          m.original_name.toLowerCase().includes(q) ||
          m.filename.toLowerCase().includes(q)
      )
    : items
  const filteredDiagrams = q
    ? diagrams.filter((d) => (d.name || '').toLowerCase().includes(q))
    : diagrams

  const tabClass = (name) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${
      tab === name
        ? 'bg-primary text-primary-text'
        : 'bg-surface-hover border border-border text-text hover:bg-surface-active'
    }`

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl shadow-xl border border-border w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">Insert from Library</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleTabChange('media')}
            className={tabClass('media')}
          >
            Images &amp; Files
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('diagrams')}
            className={tabClass('diagrams')}
          >
            Diagrams
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'media' ? 'Search by filename...' : 'Search by diagram name...'}
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
          />
          {tab === 'media' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-3 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload new'}
              </button>
            </>
          )}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {loading && <p className="text-sm text-text-secondary">Loading...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!loading && !error && tab === 'media' && (
            <>
              {filteredMedia.length === 0 && (
                <p className="text-sm text-text-secondary">
                  {items.length === 0 ? 'No uploaded media yet.' : 'No matches.'}
                </p>
              )}
              {filteredMedia.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredMedia.map((item) => {
                    const isImage = item.mime_type?.startsWith('image/')
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onInsert(buildMediaMarkdown(item))
                          onClose()
                        }}
                        className="group text-left bg-surface-hover border border-border rounded-lg overflow-hidden hover:border-primary transition"
                        title={`Insert ${item.original_name}`}
                      >
                        <div className="aspect-video bg-surface flex items-center justify-center overflow-hidden">
                          {isImage ? (
                            <img
                              src={item.url}
                              alt={item.original_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-text-secondary px-2 text-center">
                              {item.mime_type || 'file'}
                            </span>
                          )}
                        </div>
                        <div className="p-2">
                          <div
                            className="text-xs text-text truncate"
                            title={item.original_name}
                          >
                            {item.original_name}
                          </div>
                          <div className="text-[10px] text-text-secondary">
                            {formatBytes(item.size_bytes)}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {!loading && !error && tab === 'diagrams' && (
            <>
              {filteredDiagrams.length === 0 && (
                <p className="text-sm text-text-secondary">
                  {diagrams.length === 0
                    ? 'No diagrams yet. Use the slash command "Draw.io Diagram" to create one.'
                    : 'No matches.'}
                </p>
              )}
              {filteredDiagrams.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredDiagrams.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onInsert(buildDiagramDirective(item))
                        onClose()
                      }}
                      className="group text-left bg-surface-hover border border-border rounded-lg overflow-hidden hover:border-primary transition"
                      title={`Insert ::drawio[${item.id}]`}
                    >
                      <div className="aspect-video bg-white flex items-center justify-center overflow-hidden">
                        {item.has_svg ? (
                          <img
                            src={`/api/diagrams/${item.id}/svg`}
                            alt={item.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-text-secondary px-2 text-center">
                            no preview
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <div
                          className="text-xs text-text truncate"
                          title={item.name}
                        >
                          {item.name}
                        </div>
                        <div className="text-[10px] text-text-secondary">
                          {item.reference_count > 0
                            ? `used by ${item.reference_count} page${item.reference_count === 1 ? '' : 's'}`
                            : 'unused'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
