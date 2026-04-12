import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, commandsCtx } from '@milkdown/kit/core'
import { commonmark, headingSchema, blockquoteSchema, hrSchema, bulletListSchema, orderedListSchema, codeBlockSchema, insertImageCommand } from '@milkdown/kit/preset/commonmark'
import { clearTextInCurrentBlockCommand, setBlockTypeCommand, wrapInBlockTypeCommand, addBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { slashFactory, SlashProvider } from '@milkdown/kit/plugin/slash'
import { TextSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import api from '../../api/client'

const SLASH_ITEMS = [
  { id: 'h1', label: 'Heading 1', icon: 'H1', desc: 'Big section heading' },
  { id: 'h2', label: 'Heading 2', icon: 'H2', desc: 'Medium section heading' },
  { id: 'h3', label: 'Heading 3', icon: 'H3', desc: 'Small section heading' },
  { id: 'bullet', label: 'Bullet List', icon: '\u2022', desc: 'Unordered list' },
  { id: 'ordered', label: 'Ordered List', icon: '1.', desc: 'Numbered list' },
  { id: 'quote', label: 'Blockquote', icon: '\u275D', desc: 'Quote block' },
  { id: 'code', label: 'Code Block', icon: '</>', desc: 'Code snippet' },
  { id: 'hr', label: 'Divider', icon: '\u2014', desc: 'Horizontal rule' },
  { id: 'callout-info', label: 'Info Callout', icon: '\u2139', desc: ':::info block' },
  { id: 'callout-warning', label: 'Warning Callout', icon: '\u26A0', desc: ':::warning block' },
  { id: 'callout-tip', label: 'Tip Callout', icon: '\u2713', desc: ':::tip block' },
  { id: 'callout-danger', label: 'Danger Callout', icon: '\u2715', desc: ':::danger block' },
  { id: 'mermaid', label: 'Mermaid Diagram', icon: '\u25C7', desc: 'Insert mermaid chart' },
  { id: 'math', label: 'Math Formula', icon: '\u03A3', desc: 'KaTeX math block' },
  { id: 'drawio', label: 'Draw.io Diagram', icon: '\u25A1', desc: 'Insert Draw.io embed' },
]

function executeSlashCommand(ctx, id, view, drawioHandlerRef) {
  const commands = ctx.get(commandsCtx)
  commands.call(clearTextInCurrentBlockCommand.key)

  if (id.startsWith('callout-')) {
    const type = id.replace('callout-', '')
    if (view) {
      const { state, dispatch } = view
      const { from } = state.selection
      const text = `\n:::${type}\n\n:::\n`
      dispatch(state.tr.insertText(text, from))
    }
    return
  }

  if (id === 'mermaid' && view) {
    const { state, dispatch } = view
    const { from } = state.selection
    const text = '\n```mermaid\ngraph TD\n    A[Start] --> B[End]\n```\n'
    dispatch(state.tr.insertText(text, from))
    return
  }

  if (id === 'math' && view) {
    const { state, dispatch } = view
    const { from } = state.selection
    const text = '\n$$\nE = mc^2\n$$\n'
    dispatch(state.tr.insertText(text, from))
    return
  }

  if (id === 'drawio') {
    if (drawioHandlerRef?.current) drawioHandlerRef.current()
    return
  }

  switch (id) {
    case 'h1':
      commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level: 1 } })
      break
    case 'h2':
      commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level: 2 } })
      break
    case 'h3':
      commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level: 3 } })
      break
    case 'bullet':
      commands.call(wrapInBlockTypeCommand.key, { nodeType: bulletListSchema.type(ctx) })
      break
    case 'ordered':
      commands.call(wrapInBlockTypeCommand.key, { nodeType: orderedListSchema.type(ctx) })
      break
    case 'quote':
      commands.call(wrapInBlockTypeCommand.key, { nodeType: blockquoteSchema.type(ctx) })
      break
    case 'code':
      commands.call(setBlockTypeCommand.key, { nodeType: codeBlockSchema.type(ctx) })
      break
    case 'hr':
      commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) })
      break
  }
}

class SlashMenuView {
  constructor(ctx, view, drawioHandlerRef, editorViewRef) {
    this.ctx = ctx
    this.view = view
    this.drawioHandlerRef = drawioHandlerRef
    this.editorViewRef = editorViewRef
    editorViewRef.current = view
    this.selectedIndex = 0
    this.filteredItems = [...SLASH_ITEMS]
    this.isVisible = false

    this.content = document.createElement('div')
    this.content.className = 'slash-menu'
    this.content.style.position = 'fixed'
    this.content.style.zIndex = '100'
    this.content.dataset.show = 'false'

    this.renderItems()

    this.provider = new SlashProvider({
      content: this.content,
      debounce: 50,
      shouldShow: (view) => {
        const currentText = this.provider.getContent(
          view,
          (node) => ['paragraph', 'heading'].includes(node.type.name)
        )
        if (currentText == null) return false
        const { selection } = view.state
        if (!(selection instanceof TextSelection)) return false
        const { $head } = selection
        if ($head.parentOffset !== $head.parent.content.size) return false
        if (!currentText.startsWith('/')) return false

        const filter = currentText.slice(1).toLowerCase()
        this.filteredItems = SLASH_ITEMS.filter(
          (item) => item.label.toLowerCase().includes(filter) || item.id.includes(filter)
        )
        this.selectedIndex = 0
        this.renderItems()
        return this.filteredItems.length > 0
      },
      offset: 10,
    })
    this.provider.onShow = () => { this.isVisible = true }
    this.provider.onHide = () => { this.isVisible = false }

    this.update(view)
  }

  handleKey(event) {
    if (!this.isVisible) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1)
      this.updateActiveItem()
      return true
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
      this.updateActiveItem()
      return true
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = this.filteredItems[this.selectedIndex]
      if (item) {
        executeSlashCommand(this.ctx, item.id, this.view, this.drawioHandlerRef)
        this.provider.hide()
      }
      return true
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.provider.hide()
      return true
    }
    return false
  }

  renderItems() {
    this.content.innerHTML = ''
    this.filteredItems.forEach((item, i) => {
      const el = document.createElement('div')
      el.className = 'slash-menu-item' + (i === this.selectedIndex ? ' active' : '')
      el.innerHTML = `
        <span class="slash-menu-icon">${item.icon}</span>
        <div>
          <div class="slash-menu-label">${item.label}</div>
          <div class="slash-menu-desc">${item.desc}</div>
        </div>
      `
      el.addEventListener('mouseenter', () => {
        this.selectedIndex = i
        this.updateActiveItem()
      })
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        executeSlashCommand(this.ctx, item.id, this.view, this.drawioHandlerRef)
        this.provider.hide()
      })
      this.content.appendChild(el)
    })
  }

  updateActiveItem() {
    const items = this.content.querySelectorAll('.slash-menu-item')
    items.forEach((el, i) => {
      el.classList.toggle('active', i === this.selectedIndex)
    })
    // Scroll selected item into view
    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }

  update(view) {
    this.view = view
    this.editorViewRef.current = view
    this.provider.update(view)
  }

  destroy() {
    this.provider.destroy()
    this.content.remove()
  }
}

// ── Wikilink [[ autocomplete ──

class WikilinkMenu {
  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'wikilink-menu'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)

    this.pages = []
    this.filtered = []
    this.selectedIndex = 0
    this.active = false
    this.triggerPos = null  // doc position where [[ starts

    // Cache pages list
    this.loadPages()
  }

  async loadPages() {
    try {
      const res = await api.get('/pages')
      this.pages = (res.data.pages || res.data || []).map((p) => ({
        slug: p.slug,
        title: p.title,
      }))
    } catch { /* ignore */ }
  }

  show(view, from, query) {
    this.active = true
    this.triggerPos = from
    this.filter(query)

    // Position near cursor
    const coords = view.coordsAtPos(view.state.selection.head)
    this.el.style.position = 'fixed'
    this.el.style.left = coords.left + 'px'
    this.el.style.top = (coords.bottom + 4) + 'px'
    this.el.style.display = ''
    this.el.style.zIndex = '200'
  }

  hide() {
    this.active = false
    this.el.style.display = 'none'
    this.triggerPos = null
  }

  filter(query) {
    const q = query.toLowerCase()
    this.filtered = this.pages.filter(
      (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
    ).slice(0, 8)
    this.selectedIndex = 0
    this.render()
  }

  render() {
    this.el.innerHTML = ''
    if (this.filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'wikilink-menu-empty'
      empty.textContent = 'No pages found'
      this.el.appendChild(empty)
      return
    }
    this.filtered.forEach((page, i) => {
      const item = document.createElement('div')
      item.className = 'wikilink-menu-item' + (i === this.selectedIndex ? ' active' : '')
      item.innerHTML = `
        <span class="wikilink-menu-title">${page.title}</span>
        <span class="wikilink-menu-slug">/${page.slug}</span>
      `
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = i
        this.render()
      })
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.select(page)
      })
      this.el.appendChild(item)
    })
  }

  select(page) {
    if (!this._view || this.triggerPos == null) return
    const { state, dispatch } = this._view
    // Replace from triggerPos (the first [) to current cursor with [[slug|title]]
    const to = state.selection.head
    const text = `[[${page.slug}|${page.title}]]`
    dispatch(state.tr.replaceWith(this.triggerPos, to, state.schema.text(text)))
    this.hide()
  }

  handleKeyDown(view, event) {
    if (!this.active) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filtered.length - 1)
      this.render()
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
      this.render()
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const page = this.filtered[this.selectedIndex]
      if (page) this.select(page)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.hide()
      return true
    }
    return false
  }

  destroy() {
    this.el.remove()
  }
}

const wikilinkPluginKey = new PluginKey('wikilink-autocomplete')

const Editor = forwardRef(function Editor({ defaultValue = '', onChange, onDrawioOpen }, ref) {
  const editorRef = useRef(null)
  const containerRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const drawioHandlerRef = useRef(onDrawioOpen)
  const editorViewRef = useRef(null)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    drawioHandlerRef.current = onDrawioOpen || null
  }, [onDrawioOpen])

  useImperativeHandle(ref, () => ({
    insertText(text) {
      const view = editorViewRef.current
      if (!view) return
      const { state, dispatch } = view
      const pos = state.selection.from
      dispatch(state.tr.insertText(text, pos))
    }
  }), [])

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    const slash = slashFactory('slash-menu')

    // Create wikilink plugin per editor instance to avoid stale DOM references
    const wikilinkMenu = new WikilinkMenu()
    const wikilinkPlugin = $prose(() => {
      return new Plugin({
        key: wikilinkPluginKey,
        props: {
          handleKeyDown(view, event) {
            return wikilinkMenu.handleKeyDown(view, event)
          },
        },
        view(editorView) {
          wikilinkMenu._view = editorView
          return {
            update(view) {
              wikilinkMenu._view = view
              const { state } = view
              const { selection } = state
              if (!(selection instanceof TextSelection)) {
                wikilinkMenu.hide()
                return
              }

              const { $head } = selection
              const textBefore = $head.parent.textContent.slice(0, $head.parentOffset)

              const lastOpen = textBefore.lastIndexOf('[[')
              if (lastOpen === -1) {
                wikilinkMenu.hide()
                return
              }
              const afterOpen = textBefore.slice(lastOpen + 2)
              if (afterOpen.includes(']]')) {
                wikilinkMenu.hide()
                return
              }

              const query = afterOpen.split('|')[0]
              const blockStart = $head.pos - $head.parentOffset
              const triggerPos = blockStart + lastOpen

              wikilinkMenu.show(view, triggerPos, query)
            },
            destroy() {
              wikilinkMenu.destroy()
            },
          }
        },
      })
    })

    const init = async () => {
      const editor = await MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, containerRef.current)
          ctx.set(defaultValueCtx, defaultValue)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChangeRef.current?.(markdown)
          })
          let slashMenuView = null
          ctx.set(slash.key, {
            view: (editorView) => {
              slashMenuView = new SlashMenuView(ctx, editorView, drawioHandlerRef, editorViewRef)
              return slashMenuView
            },
            props: {
              handleKeyDown(view, event) {
                return slashMenuView?.handleKey(event) ?? false
              },
            },
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(slash)
        .use(wikilinkPlugin)
        .create()

      // StrictMode: if cleanup ran while we were awaiting, destroy immediately
      if (cancelled) {
        editor.destroy()
        return
      }
      editorRef.current = editor
    }

    init()

    return () => {
      cancelled = true
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
      }
      editorViewRef.current = null
      // Clear leftover DOM from any editor
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [])

  // Image paste handler
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePaste = async (e) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          const formData = new FormData()
          formData.append('file', file)

          try {
            const res = await api.post('/media/upload', formData)
            const url = res.data.url
            const editor = editorRef.current
            if (editor) {
              editor.action((ctx) => {
                const commands = ctx.get(commandsCtx)
                commands.call(insertImageCommand.key, { src: url, alt: 'image' })
              })
            }
          } catch (err) {
            console.error('Image upload failed:', err)
          }
        }
      }
    }

    container.addEventListener('paste', handlePaste)
    return () => container.removeEventListener('paste', handlePaste)
  }, [])

  return (
    <div className="milkdown" ref={containerRef} />
  )
})

export default Editor
