import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import usePages from '../store/usePages'
import api from '../api/client'
import Editor from '../components/Editor/Editor'
import MediaPickerModal from '../components/Editor/MediaPickerModal'
import DrawioModal from '../components/DrawioModal'
import useUnsavedWarning from '../hooks/useUnsavedWarning'

export default function NewPage() {
  const navigate = useNavigate()
  const { createPage, fetchTree } = usePages()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
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

  const selectTemplate = (tmpl) => {
    setSelectedTemplate(tmpl)
    setContent(tmpl.content_md)
    setEditorKey((k) => k + 1)
    setShowTemplates(false)
  }

  const skipTemplates = () => {
    setSelectedTemplate(null)
    setContent('')
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
        content_md: content,
        template_id: selectedTemplate?.id,
      })
      await fetchTree()
      setSaved(true)
      navigate(`/page/${page.slug}`)
    } catch (err) {
      console.error('Create failed:', err)
      setError(err?.response?.data?.detail || err.message || 'Create failed')
      setSaving(false)
    }
  }, [title, content, saving, selectedTemplate, createPage, fetchTree, navigate])

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

  if (showTemplates) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-text mb-6">New Page</h1>
        <p className="text-text-secondary mb-4">Start from a template or blank page</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={skipTemplates}
            className="p-4 bg-surface rounded-xl border-2 border-dashed border-border hover:border-primary text-left transition-colors"
          >
            <div className="font-medium text-text">Blank Page</div>
            <div className="text-sm text-text-secondary mt-1">Start from scratch</div>
          </button>
          {templates.map((tmpl) => (
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
