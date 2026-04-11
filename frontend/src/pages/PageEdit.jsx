import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import usePages from '../store/usePages'
import Editor from '../components/Editor/Editor'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import DrawioModal from '../components/DrawioModal'
import useUnsavedWarning from '../hooks/useUnsavedWarning'
import api from '../api/client'

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
  const editorRef = useRef(null)

  // Preview state
  const [showPreview, setShowPreview] = useState(false)

  // Draw.io state
  const [drawioOpen, setDrawioOpen] = useState(false)
  const [editingDiagram, setEditingDiagram] = useState(null) // { id, xml } or null for new
  const [diagrams, setDiagrams] = useState({}) // id -> diagram data

  useUnsavedWarning(dirty)

  useEffect(() => {
    getPage(slug).then((p) => {
      setPage(p)
      setTitle(p.title)
      setContent(p.content_md)
      originalRef.current = { title: p.title, content: p.content_md }
    }).catch(() => {
      navigate('/')
    })
  }, [slug])

  useEffect(() => {
    if (!page) return
    const { title: origTitle, content: origContent } = originalRef.current
    setDirty(title !== origTitle || content !== origContent)
  }, [title, content, page])

  // Extract diagram IDs from content and fetch their data
  const diagramIds = useMemo(() => {
    const ids = []
    const re = /::drawio\\?\[(\d+)\\?\]/g
    let m
    while ((m = re.exec(content)) !== null) {
      ids.push(parseInt(m[1]))
    }
    return ids
  }, [content])

  useEffect(() => {
    const controller = new AbortController()
    for (const id of diagramIds) {
      if (!diagrams[id]) {
        api.get(`/diagrams/${id}`, { signal: controller.signal }).then(res => {
          setDiagrams(prev => ({ ...prev, [id]: res.data }))
        }).catch(() => {})
      }
    }
    return () => controller.abort()
  }, [diagramIds])

  // Draw.io handlers
  const handleDrawioOpen = useCallback(() => {
    setEditingDiagram(null)
    setDrawioOpen(true)
  }, [])

  const handleDiagramEdit = useCallback((diagramId) => {
    const diagram = diagrams[diagramId]
    if (diagram) {
      setEditingDiagram({ id: diagramId, xml: diagram.xml_data })
      setDrawioOpen(true)
    }
  }, [diagrams])

  const handleDrawioSave = useCallback(async ({ xml, svg }) => {
    try {
      if (editingDiagram) {
        // Update existing diagram
        await api.put(`/diagrams/${editingDiagram.id}`, {
          xml_data: xml,
          svg_cache: svg,
        })
        setDiagrams(prev => ({
          ...prev,
          [editingDiagram.id]: { ...prev[editingDiagram.id], xml_data: xml, svg_cache: svg }
        }))
      } else {
        // Create new diagram
        const res = await api.post('/diagrams', {
          name: `Diagram ${Date.now()}`,
          xml_data: xml,
          page_id: page?.id,
        })
        const newId = res.data.id
        // Save SVG cache
        await api.put(`/diagrams/${newId}`, { svg_cache: svg })
        // Insert directive into editor at cursor position
        const directive = `\n::drawio[${newId}]\n`
        if (editorRef.current) {
          editorRef.current.insertText(directive)
        }
        setDiagrams(prev => ({ ...prev, [newId]: { ...res.data, svg_cache: svg } }))
      }
    } catch (err) {
      console.error('Failed to save diagram:', err)
    }
    setDrawioOpen(false)
    setEditingDiagram(null)
  }, [editingDiagram, page])

  const handleDrawioClose = useCallback(() => {
    setDrawioOpen(false)
    setEditingDiagram(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await updatePage(slug, { title, content_md: content })
      await fetchTree()
      setDirty(false)
      setSaving(false)
      navigate(`/page/${slug}`)
    } catch (err) {
      console.error('Save failed:', err)
      setError(err?.response?.data?.detail || err.message || 'Save failed')
      setSaving(false)
    }
  }, [slug, title, content, saving, navigate, fetchTree, updatePage])

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

  if (!page) return <div className="text-text-secondary">Loading...</div>

  return (
    <div className={showPreview ? 'edit-split-root' : 'max-w-4xl mx-auto'}>
      <div className="mb-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold text-text bg-transparent border-none outline-none w-full"
          placeholder="Page title"
        />
      </div>
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}
      <div className="text-xs text-text-secondary mb-3">Press Ctrl+S to save &middot; Type / for commands</div>

      <div className={showPreview ? 'edit-split-panels' : ''}>
        {/* Editor panel */}
        <div className={showPreview ? 'edit-split-editor' : ''}>
          <div className="bg-surface rounded-xl shadow-sm border border-border min-h-[500px]">
            <Editor
              ref={editorRef}
              defaultValue={content}
              onChange={setContent}
              onDrawioOpen={handleDrawioOpen}
            />
          </div>

          {/* Diagram previews */}
          {diagramIds.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-text-secondary mb-2">
                Diagrams in this page (click to edit)
              </div>
              <div className="space-y-3">
                {diagramIds.map(id => (
                  <div
                    key={id}
                    className="diagram-edit-preview"
                    onClick={() => handleDiagramEdit(id)}
                  >
                    {diagrams[id]?.svg_cache ? (
                      <div
                        className="diagram-edit-preview-svg"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(diagrams[id].svg_cache, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
                      />
                    ) : (
                      <div className="diagram-edit-preview-placeholder">
                        Loading diagram #{id}...
                      </div>
                    )}
                    <div className="diagram-edit-preview-overlay">
                      <span>Click to edit in Draw.io</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live preview panel */}
        {showPreview && (
          <div className="edit-split-preview">
            <div className="bg-surface rounded-xl shadow-sm border border-border min-h-[500px] p-6 overflow-auto">
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-4 pb-2 border-b border-border">Preview</div>
              <MarkdownViewer content={content} />
            </div>
          </div>
        )}
      </div>

      {/* Floating action bar */}
      <div className="floating-action-bar">
        <button
          onClick={() => setShowPreview(v => !v)}
          className={`fab-btn ${showPreview ? 'fab-btn-active' : 'fab-btn-secondary'}`}
          title={showPreview ? 'Hide preview' : 'Show preview'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" fill={showPreview ? 'currentColor' : 'none'} fillOpacity="0.15"/>
          </svg>
        </button>
        <button
          onClick={() => navigate(`/page/${slug}`)}
          className="fab-btn fab-btn-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="fab-btn fab-btn-primary"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <DrawioModal
        open={drawioOpen}
        xml={editingDiagram?.xml || ''}
        onSave={handleDrawioSave}
        onClose={handleDrawioClose}
      />
    </div>
  )
}
