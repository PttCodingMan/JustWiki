import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import usePages from '../store/usePages'
import useAuth from '../store/useAuth'
import { canEdit } from '../store/usePermissions'
import Editor from '../components/Editor/Editor'
import MediaPickerModal from '../components/Editor/MediaPickerModal'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import MindmapView from '../components/MindmapView'
import DrawioModal from '../components/DrawioModal'
import useUnsavedWarning from '../hooks/useUnsavedWarning'
import { stripBrTags } from '../lib/markdown'
import api from '../api/client'

export default function PageEdit() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const { getPage, updatePage, fetchTree } = usePages()
  const { user } = useAuth()
  const [page, setPage] = useState(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null)  // { currentVersion } on 409
  const [original, setOriginal] = useState({ title: '', content: '' })
  const baseVersionRef = useRef(null)
  const editorRef = useRef(null)

  const dirty = !!page && (title !== original.title || content !== original.content)

  // Preview state. Document pages default to off; mindmap pages default to
  // on (set inside the page load effect below, so the initial render of a
  // doc never triggers a split layout).
  const [showPreview, setShowPreview] = useState(false)

  // Draw.io state
  const [drawioOpen, setDrawioOpen] = useState(false)
  const [editingDiagram, setEditingDiagram] = useState(null) // { id, xml } or null for new
  const [diagrams, setDiagrams] = useState({}) // id -> diagram data

  // Media picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const handleMediaPickerOpen = useCallback(() => setMediaPickerOpen(true), [])
  const handleMediaPickerClose = useCallback(() => setMediaPickerOpen(false), [])
  const handleMediaInsert = useCallback((snippet) => {
    if (editorRef.current) {
      editorRef.current.insertText(`\n${snippet}\n`)
    }
  }, [])

  useUnsavedWarning(dirty)

  useEffect(() => {
    getPage(slug).then((p) => {
      if (!canEdit(p?.effective_permission, user?.role)) {
        // Read-only users shouldn't land in the editor at all; bounce
        // them to the view page instead.
        navigate(`/page/${slug}`)
        return
      }
      setPage(p)
      setTitle(p.title)
      setContent(p.content_md)
      setOriginal({ title: p.title, content: p.content_md })
      baseVersionRef.current = p.version
      // React Router keeps PageEdit mounted across slug transitions, so
      // ALWAYS reset preview to the per-page default — not just the mindmap
      // branch — otherwise opening a mindmap and then a doc leaves the doc
      // stuck in split view.
      setShowPreview(p.page_type === 'mindmap')
    }).catch(() => {
      navigate('/')
    })
  }, [slug])

  // Extract unique diagram IDs from content; a diagram may be referenced
  // more than once, but the editor preview should render each unique diagram
  // a single time (and React needs unique keys).
  const diagramIds = useMemo(() => {
    const seen = new Set()
    const re = /::drawio\\?\[(\d+)\\?\]/g
    let m
    while ((m = re.exec(content)) !== null) {
      seen.add(parseInt(m[1]))
    }
    return [...seen]
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
    setConflict(null)
    try {
      // Milkdown round-trips pasted <br> tags as raw HTML; normalize to
      // markdown hard breaks before persisting so new content stays clean.
      const cleanContent = stripBrTags(content)
      const updated = await updatePage(slug, {
        title,
        content_md: cleanContent,
        base_version: baseVersionRef.current,
      })
      baseVersionRef.current = updated.version
      await fetchTree()
      setOriginal({ title, content: cleanContent })
      setSaving(false)
      navigate(`/page/${slug}`)
    } catch (err) {
      console.error('Save failed:', err)
      if (err?.response?.status === 409) {
        const detail = err.response.data?.detail
        // Keep user's edits locally; surface a banner so they can decide.
        setConflict({
          currentVersion: detail?.current_version,
          yourVersion: detail?.your_version,
          message: detail?.message || t('pageEdit.conflict.default'),
        })
        setError('')
      } else {
        const detail = err?.response?.data?.detail
        const msg = typeof detail === 'string' ? detail : detail?.message || err.message || t('pageEdit.saveFailed')
        setError(msg)
      }
      setSaving(false)
    }
  }, [slug, title, content, saving, navigate, fetchTree, updatePage, t])

  const handleReloadLatest = useCallback(async () => {
    try {
      const latest = await getPage(slug)
      if (confirm(t('pageEdit.conflict.confirmDiscard'))) {
        setTitle(latest.title)
        setContent(latest.content_md)
        setOriginal({ title: latest.title, content: latest.content_md })
        baseVersionRef.current = latest.version
        setConflict(null)
      }
    } catch (e) {
      console.error('Failed to reload:', e)
    }
  }, [getPage, slug, t])

  const handleOverwrite = useCallback(async () => {
    // Fetch latest so we can show the user what they're about to lose —
    // "yes/no" with no preview invites silent data loss when a third
    // writer has landed between the conflict and the retry.
    let latest
    try {
      latest = await getPage(slug)
    } catch (e) {
      console.error('Failed to fetch latest page state:', e)
      setError(t('pageEdit.conflict.fetchLatestFailed'))
      return
    }
    const serverContent = latest.content_md || ''
    const localContent = content || ''
    const summary =
      serverContent === localContent
        ? t('pageEdit.conflict.summarySame')
        : t('pageEdit.conflict.summaryDiff', { server: serverContent.length, local: localContent.length })
    if (!confirm(t('pageEdit.conflict.confirmOverwrite', { summary }))) return

    baseVersionRef.current = latest.version
    setConflict(null)
    // baseVersionRef is synchronous — no need to defer. If the save still
    // returns 409 (yet another concurrent writer landed between these two
    // lines), handleSave will re-render the conflict banner rather than
    // silently loop here.
    await handleSave()
  }, [getPage, slug, handleSave, content, t])

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

  if (!page) return <div className="text-text-secondary">{t('common.loading')}</div>

  return (
    <div className={showPreview ? 'edit-split-root' : 'max-w-4xl mx-auto'}>
      <div className="mb-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold text-text bg-transparent border-none outline-none w-full"
          placeholder={t('pageEdit.titlePlaceholder')}
        />
      </div>
      {page?.is_public && (
        <div className="mb-3 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 rounded-lg text-sm flex items-center gap-2">
          <span role="img" aria-hidden="true">⚠</span>
          <span>{t('pageEdit.publicWarning')}</span>
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}
      {conflict && (
        <div className="mb-3 px-3 py-3 bg-amber-50 text-amber-900 text-sm rounded-lg border border-amber-300">
          <div className="font-semibold mb-1">{t('pageEdit.conflict.title')}</div>
          <div className="mb-2">
            {t('pageEdit.conflict.detail', {
              message: conflict.message,
              currentVersion: conflict.currentVersion,
              yourVersion: conflict.yourVersion,
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReloadLatest}
              className="px-3 py-1 bg-white border border-amber-400 text-amber-900 rounded hover:bg-amber-100"
            >
              {t('pageEdit.conflict.discardMine')}
            </button>
            <button
              type="button"
              onClick={handleOverwrite}
              className="px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              {t('pageEdit.conflict.overwriteMine')}
            </button>
          </div>
        </div>
      )}
      <div className="text-xs text-text-secondary mb-3">{t('pageEdit.shortcutHint')}</div>

      <div className={showPreview ? 'edit-split-panels' : ''}>
        {/* Editor panel */}
        <div className={showPreview ? 'edit-split-editor' : ''}>
          <div className="bg-surface rounded-xl shadow-sm border border-border min-h-[500px]">
            <Editor
              ref={editorRef}
              defaultValue={content}
              onChange={setContent}
              onDrawioOpen={handleDrawioOpen}
              onMediaPickerOpen={handleMediaPickerOpen}
            />
          </div>

          {/* Diagram previews */}
          {diagramIds.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-text-secondary mb-2">
                {t('pageEdit.diagramsLabel')}
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
                        {t('pageEdit.diagramLoading', { id })}
                      </div>
                    )}
                    <div className="diagram-edit-preview-overlay">
                      <span>{t('pageEdit.diagramOverlay')}</span>
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
              <div className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-4 pb-2 border-b border-border">
                {page?.page_type === 'mindmap' ? t('pageEdit.mindmapPreview') : t('pageEdit.preview')}
              </div>
              {page?.page_type === 'mindmap' ? (
                <MindmapView content={content} title={title} />
              ) : (
                <MarkdownViewer content={content} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating action bar */}
      <div className="floating-action-bar">
        <button
          onClick={() => setShowPreview(v => !v)}
          className={`fab-btn ${showPreview ? 'fab-btn-active' : 'fab-btn-secondary'}`}
          title={showPreview ? t('pageEdit.hidePreview') : t('pageEdit.showPreview')}
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
          {t('pageEdit.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="fab-btn fab-btn-primary"
        >
          {saving ? t('pageEdit.saving') : t('pageEdit.save')}
        </button>
      </div>

      <DrawioModal
        open={drawioOpen}
        xml={editingDiagram?.xml || ''}
        onSave={handleDrawioSave}
        onClose={handleDrawioClose}
      />

      <MediaPickerModal
        open={mediaPickerOpen}
        onClose={handleMediaPickerClose}
        onInsert={handleMediaInsert}
      />
    </div>
  )
}
