import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import usePages from '../store/usePages'
import useAuth from '../store/useAuth'
import api from '../api/client'
import Editor from '../components/Editor/Editor'
import MediaPickerModal from '../components/Editor/MediaPickerModal'
import DrawioModal from '../components/DrawioModal'
import useUnsavedWarning, { confirmDiscard } from '../hooks/useUnsavedWarning'
import { useMediaPicker, useSaveShortcut } from '../hooks/useEditorPage'
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const createPage = usePages((s) => s.createPage)
  const fetchTree = usePages((s) => s.fetchTree)
  const tree = usePages((s) => s.tree)
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
  const createBtnRef = useRef(null)
  const handleEditorTabOut = useCallback(() => {
    createBtnRef.current?.focus()
  }, [])
  const dirty = !saved && !showTemplates && (title.trim() !== '' || content.trim() !== '')

  // Draw.io state
  const [drawioOpen, setDrawioOpen] = useState(false)

  const handleDrawioOpen = useCallback(() => {
    setDrawioOpen(true)
  }, [])

  const mediaPicker = useMediaPicker(editorRef)

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

  useUnsavedWarning(dirty, t('pageEdit.unsavedWarning'))

  const handleCancel = useCallback(() => {
    if (confirmDiscard(dirty, t('pageEdit.unsavedWarning'))) {
      navigate('/')
    }
  }, [dirty, t, navigate])

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
      const liveMarkdown = editorRef.current?.getMarkdown?.()
      const page = await createPage({
        title,
        content_md: stripBrTags(liveMarkdown != null ? liveMarkdown : content),
        template_id: selectedTemplate?.id,
        parent_id: parentMissing ? null : parentId,
        page_type: pageType,
      })
      // Refresh the sidebar in the background; the new row shows up (and its
      // ancestors expand) as soon as the tree arrives.
      fetchTree().catch(() => {})
      setSaved(true)
      navigate(`/page/${page.slug}`)
    } catch (err) {
      console.error('Create failed:', err)
      setError(err?.response?.data?.detail || err.message || t('newPage.createFailed'))
      setSaving(false)
    }
  }, [title, content, saving, selectedTemplate, parentId, parentMissing, pageType, createPage, fetchTree, navigate, t])

  useSaveShortcut(handleSave)

  const parentHint = parentId ? (
    parentMissing ? (
      <div className="flex items-center gap-2 text-xs mb-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/25 text-yellow-800 dark:text-yellow-300">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.74-3l-7.07-12a2 2 0 00-3.48 0l-7.07 12a2 2 0 001.74 3z" />
        </svg>
        <span>{t('newPage.parent.missing', { id: parentId })}</span>
        <button
          type="button"
          onClick={() => navigate('/new', { replace: true })}
          className="ml-auto text-yellow-800 dark:text-yellow-300 hover:text-yellow-900 underline"
        >
          {t('newPage.parent.dismiss')}
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3 px-3 py-2 rounded-lg bg-surface border border-border">
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h12M4 12h8m-8 6h4M20 10v10m-5-5h10" />
        </svg>
        <span>
          {t('newPage.parent.subPageOf')}{' '}
          <span className="font-medium text-text">
            {parentNode ? parentNode.title : t('newPage.parent.loading')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => navigate('/new', { replace: true })}
          className="ml-auto text-primary hover:text-primary-hover underline"
        >
          {t('newPage.parent.remove')}
        </button>
      </div>
    )
  ) : null

  if (showTemplates) {
    return (
      <div className="max-w-3xl mx-auto animate-enter">
        <h1 className="font-display text-[2.6rem] sm:text-[3.6rem] leading-[1.02] tracking-[-0.025em] text-text mb-8">{t('newPage.title')}</h1>
        {parentHint}

        <div className="inline-flex p-1 mb-6 rounded-xl bg-surface-hover/70 ring-1 ring-inset ring-hairline">
          <button
            type="button"
            onClick={() => setPageType('document')}
            aria-pressed={pageType === 'document'}
            className={`h-8 px-4 rounded-[9px] text-[13px] font-medium transition-all duration-200 ${
              pageType === 'document'
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            {t('newPage.type.document')}
          </button>
          <button
            type="button"
            onClick={() => setPageType('mindmap')}
            aria-pressed={pageType === 'mindmap'}
            className={`h-8 px-4 rounded-[9px] text-[13px] font-medium transition-all duration-200 ${
              pageType === 'mindmap'
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            {t('newPage.type.mindmap')}
          </button>
        </div>

        <p className="text-text-secondary mb-6">
          {pageType === 'mindmap' ? t('newPage.intro.mindmap') : t('newPage.intro.document')}
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <button
            onClick={skipTemplates}
            className="group relative p-5 rounded-2xl border-[1.5px] border-dashed border-border hover:border-primary hover:bg-surface text-left transition-all duration-300 hover:-translate-y-0.5"
          >
            <span className="mb-4 w-10 h-10 rounded-xl flex items-center justify-center bg-primary text-primary-text shadow-sm transition-transform duration-300 group-hover:rotate-90" style={{ transitionTimingFunction: 'var(--ease-spring)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <div className="font-semibold text-text">
              {pageType === 'mindmap' ? t('newPage.starter.mindmap') : t('newPage.starter.blank')}
            </div>
            <div className="text-sm text-text-secondary mt-1">
              {pageType === 'mindmap' ? t('newPage.starter.mindmapSub') : t('newPage.starter.blankSub')}
            </div>
          </button>
          {pageType === 'document' && templates.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => selectTemplate(tmpl)}
              className="group p-5 bg-surface rounded-2xl border border-hairline shadow-xs hover:shadow-lg hover:border-primary/40 text-left transition-all duration-300 hover:-translate-y-0.5"
            >
              <span className="mb-4 w-10 h-10 rounded-xl flex items-center justify-center bg-primary-soft text-sidebar-active-text ring-1 ring-inset ring-primary/15">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
              </span>
              <div className="font-semibold text-text">{tmpl.name}</div>
              <div className="text-sm text-text-secondary mt-1">{tmpl.description}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[72rem] mx-auto animate-enter">
      {parentHint}
      <div className="flex items-center justify-between gap-4 mb-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault()
              editorRef.current?.focus()
            }
          }}
          className="font-display text-[2.4rem] sm:text-[3.2rem] leading-[1.05] tracking-[-0.025em] text-text bg-transparent border-none outline-none flex-1 mr-4 min-w-0 placeholder:text-text-tertiary/70"
          placeholder={t('newPage.titlePlaceholder')}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="h-9 px-3.5 text-[13px] font-medium text-text-secondary rounded-[10px] hover:bg-surface-hover hover:text-text transition-colors"
          >
            {t('newPage.cancel')}
          </button>
          <button
            ref={createBtnRef}
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="btn-primary"
          >
            {saving ? t('newPage.creating') : t('newPage.create')}
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-500/10 text-red-600 text-sm rounded-lg border border-red-500/25">
          {error}
        </div>
      )}
      {selectedTemplate && (
        <div className="flex items-center gap-2 text-xs text-text-tertiary mb-5">
          <span>{t('newPage.templateLabel', { name: selectedTemplate.name })}</span>
          <button
            onClick={changeTemplate}
            className="text-primary hover:text-primary-hover underline"
          >
            {t('newPage.change')}
          </button>
        </div>
      )}
      {!selectedTemplate && (
        <div className="flex items-center gap-2 text-xs text-text-tertiary mb-5">
          <span>{t('newPage.blankPage')}</span>
          <button
            onClick={changeTemplate}
            className="text-primary hover:text-primary-hover underline"
          >
            {t('newPage.useTemplate')}
          </button>
        </div>
      )}
      <div className="editor-paper bg-surface rounded-2xl shadow-sm border border-hairline min-h-[500px]">
        <Editor
          key={editorKey}
          ref={editorRef}
          defaultValue={content}
          onChange={setContent}
          onDrawioOpen={handleDrawioOpen}
          onMediaPickerOpen={mediaPicker.onOpen}
          onTabOut={handleEditorTabOut}
        />
      </div>

      <DrawioModal
        open={drawioOpen}
        xml=""
        onSave={handleDrawioSave}
        onClose={handleDrawioClose}
      />

      <MediaPickerModal
        open={mediaPicker.open}
        onClose={mediaPicker.onClose}
        onInsert={mediaPicker.onInsert}
      />
    </div>
  )
}
