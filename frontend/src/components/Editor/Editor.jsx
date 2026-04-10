import { useEffect, useRef } from 'react'
import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, commandsCtx } from '@milkdown/kit/core'
import { commonmark, headingSchema, blockquoteSchema, hrSchema, bulletListSchema, orderedListSchema, codeBlockSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import { clearTextInCurrentBlockCommand, setBlockTypeCommand, wrapInBlockTypeCommand, addBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { history } from '@milkdown/kit/plugin/history'
import { getMarkdown } from '@milkdown/kit/utils'
import { slashFactory, SlashProvider } from '@milkdown/kit/plugin/slash'
import { TextSelection } from '@milkdown/kit/prose/state'
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
]

function executeSlashCommand(ctx, id, view) {
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
  constructor(ctx, view) {
    this.ctx = ctx
    this.view = view
    this.selectedIndex = 0
    this.filteredItems = [...SLASH_ITEMS]

    this.content = document.createElement('div')
    this.content.className = 'slash-menu'
    this.content.style.position = 'fixed'
    this.content.style.zIndex = '100'
    this.content.dataset.show = 'false'

    this.renderItems()

    this.handleKeyDown = (e) => {
      if (this.content.dataset.show !== 'true') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1)
        this.renderItems()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.renderItems()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = this.filteredItems[this.selectedIndex]
        if (item) {
          executeSlashCommand(this.ctx, item.id, this.view)
          this.provider.hide()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        this.provider.hide()
      }
    }
    document.addEventListener('keydown', this.handleKeyDown, true)

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

    this.update(view)
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
        this.renderItems()
      })
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        executeSlashCommand(this.ctx, item.id, this.view)
        this.provider.hide()
      })
      this.content.appendChild(el)
    })
  }

  update(view) {
    this.view = view
    this.provider.update(view)
  }

  destroy() {
    this.provider.destroy()
    this.content.remove()
    document.removeEventListener('keydown', this.handleKeyDown, true)
  }
}

export default function Editor({ defaultValue = '', onChange }) {
  const editorRef = useRef(null)
  const containerRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    const slash = slashFactory('slash-menu')

    const init = async () => {
      const editor = await MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, containerRef.current)
          ctx.set(defaultValueCtx, defaultValue)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChangeRef.current?.(markdown)
          })
          ctx.set(slash.key, {
            view: (view) => new SlashMenuView(ctx, view),
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(slash)
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
              const md = getMarkdown()(editor.ctx)
              const newMd = md + `\n![image](${url})\n`
              onChangeRef.current?.(newMd)
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
}
