import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import usePages from '../store/usePages'
import useAuth from '../store/useAuth'
import api from '../api/client'
import Editor from '../components/Editor/Editor'
import MediaPickerModal from '../components/Editor/MediaPickerModal'
import DrawioModal from '../components/DrawioModal'
import useUnsavedWarning from '../hooks/useUnsavedWarning'
import { stripBrTags } from '../lib/markdown'
import { MINDMAP_TEMPLATE } from '../lib/mindmap'

function findNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children?.length) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

export default function NewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { createPage, fetchTree, tree } = usePages()
  const { user } = useAuth()

  useEffect(() => {
    if (user?.role === 'viewer') {
      navigate('/', { replace: true })
    }
  }, [user, navigate])
  const parentParam = searchParams.get('parent')
  const parentIdRaw = parentParam ? Number(parentParam) : null
  const parentId = Number.isInteger(parentIdRaw) && parentIdRaw > 0 ? parentIdRaw : null
  const parentNode = useMemo(
    () => (parentId ? findNodeById(tree, parentId) : null),
    [parentId, tree]
  )
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [pageType, setPageType] = useState('document')
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [showTemplates, setShowTemplates] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [editorKey, setEditorKey] = useState(0)
  const editorRef = useRef(null)
  const dirty = !saved && !showTemplates && (title.trim() !== '' || content.trim() !== '')

  // Draw.io state
  const [drawioOpen, setDrawioOpen] = useState(false)

  const handleDrawioOpen = useCallback(() => {
    setDrawioOpen(true)
  }, [])

  // Media picker state
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const handleMediaPickerOpen = useCallback(() => setMediaPickerOpen(true), [])
  const handleMediaPickerClose = useCallback(() => setMediaPickerOpen(false), [])
  const handleMediaInsert = useCallback((snippet) => {
    if (editorRef.current) {
      editorRef.current.insertText(`\n${snippet}\n`)
    }
  }, [])

  const handleDrawioSave = useCallback(async ({ xml, svg }) => {
    try {
      const res = await api.post('/diagrams', {
        name: `Diagram ${Date.now()}`,
        xml_data: xml,
      })
      const newId = res.data.id
      await api.put(`/diagrams/${newId}`, { svg_cache: svg })
      const directive = `\n::drawio[${newId}]\n`
      if (editorRef.current) {
        editorRef.current.insertText(directive)
      }
    } catch (err) {
      console.error('Failed to save diagram:', err)
    }
    setDrawioOpen(false)
  }, [])

  const handleDrawioClose = useCallback(() => {
    setDrawioOpen(false)
  }, [])

  useUnsavedWarning(dirty)

  useEffect(() => {
    api.get('/templates').then((res) => setTemplates(res.data))
  }, [])

  const [parentLookupDone, setParentLookupDone] = useState(false)
  useEffect(() => {
    if (!parentId || parentNode || parentLookupDone) return
    fetchTree()
      .catch(() => {})
      .finally(() => setParentLookupDone(true))
  }, [parentId, parentNode, parentLookupDone, fetchTree])
  const parentMissing = parentId && parentLookupDone && !parentNode

  const selectTemplate = (tmpl) => {
    setSelectedTemplate(tmpl)
    setContent(tmpl.content_md)
    setEditorKey((k) => k + 1)
    setShowTemplates(false)
  }

  const skipTemplates = () => {
    setSelectedTemplate(null)
    // Mindmaps without a starter skeleton are easy to get wrong (the
    // parser requires at least one heading or bullet). Prefilling gives
    // new users a working page they can edit away from.
    setContent(pageType === 'mindmap' ? MINDMAP_TEMPLATE : '')
    setEditorKey((k) => k + 1)
    setShowTemplates(false)
  }

  const changeTemplate = () => {
    setShowTemplates(true)
  }

  const handleSave = useCallback(async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const page = await createPage({
        title,
        content_md: stripBrTags(content),
        template_id: selectedTemplate?.id,
        parent_id: parentMissing ? null : parentId,
        page_type: pageType,
      })
      await fetchTree()
      setSaved(true)
      navigate(`/page/${page.slug}`)
    } catch (err) {
      console.error('Create failed:', err)
      setError(err?.response?.data?.detail || err.message || 'Create failed')
      setSaving(false)
    }
  }, [title, content, saving, selectedTemplate, parentId, parentMissing, pageType, createPage, fetchTree, navigate])

  // Ctrl+S
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

  const parentHint = parentId ? (
    parentMissing ? (
      <div className="flex items-center gap-2 text-xs mb-3 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12a2 2 0 00-3.48 0l-7.07 12a2 2 0 001.74 3z" />
        </svg>
        <span>
          Parent page <span className="font-mono">#{parentId}</span> not found — will create as a root page.
        </span>
        <button
          type="button"
          onClick={() => navigate('/new', { replace: true })}
          className="ml-auto text-yellow-800 hover:text-yellow-900 underline"
        >
          Dismiss
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3 px-3 py-2 rounded-lg bg-surface border border-border">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h12M4 12h8m-8 6h4M20 10v10m-5-5h10" />
        </svg>
        <span>
          Sub-page of:{' '}
          <span className="font-medium text-text">
            {parentNode ? parentNode.title : 'Loading…'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => navigate('/new', { replace: true })}
          className="ml-auto text-primary hover:text-primary-hover underline"
        >
          Remove
        </button>
      </div>
    )
  ) : null

  if (showTemplates) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-text mb-6">New Page</h1>
        {parentHint}

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setPageType('document')}
            className={`px-3 py-2 rounded-lg text-sm ${
              pageType === 'document'
                ? 'bg-primary text-primary-text'
                : 'bg-surface border border-border text-text-secondary hover:border-primary'
            }`}
          >
            📄 Document
          </button>
          <button
            type="button"
            onClick={() => setPageType('mindmap')}
            className={`px-3 py-2 rounded-lg text-sm ${
              pageType === 'mindmap'
                ? 'bg-primary text-primary-text'
                : 'bg-surface border border-border text-text-secondary hover:border-primary'
            }`}
          >
            🧠 Mindmap
          </button>
        </div>

        <p className="text-text-secondary mb-4">
          {pageType === 'mindmap'
            ? 'Write markdown with headings or bullets — the viewer renders a mindmap.'
            : 'Start from a template or blank page'}
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={skipTemplates}
            className="p-4 bg-surface rounded-xl border-2 border-dashed border-border hover:border-primary text-left transition-colors"
          >
            <div className="font-medium text-text">
              {pageType === 'mindmap' ? 'Mindmap starter' : 'Blank Page'}
            </div>
            <div className="text-sm text-text-secondary mt-1">
              {pageType === 'mindmap' ? 'Prefilled with a template outline' : 'Start from scratch'}
            </div>
          </button>
          {pageType === 'document' && templates.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => selectTemplate(tmpl)}
              className="p-4 bg-surface rounded-xl border border-border hover:border-primary text-left transition-colors"
            >
              <div className="font-medium text-text">{tmpl.name}</div>
              <div className="text-sm text-text-secondary mt-1">{tmpl.description}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {parentHint}
      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold text-text bg-transparent border-none outline-none flex-1 mr-4"
          placeholder="Page title"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1.5 text-sm text-text-secondary rounded-lg hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="px-3 py-1.5 text-sm bg-primary text-primary-text rounded-lg hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}
      {selectedTemplate && (
        <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
          <span>Template: {selectedTemplate.name}</span>
          <button
            onClick={changeTemplate}
            className="text-primary hover:text-primary-hover underline"
          >
            Change
          </button>
        </div>
      )}
      {!selectedTemplate && (
        <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
          <span>Blank page</span>
          <button
            onClick={changeTemplate}
            className="text-primary hover:text-primary-hover underline"
          >
            Use template
          </button>
        </div>
      )}
      <div className="bg-surface rounded-xl shadow-sm border border-border min-h-[500px]">
        <Editor
          key={editorKey}
          ref={editorRef}
          defaultValue={content}
          onChange={setContent}
          onDrawioOpen={handleDrawioOpen}
          onMediaPickerOpen={handleMediaPickerOpen}
        />
      </div>

      <DrawioModal
        open={drawioOpen}
        xml=""
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
