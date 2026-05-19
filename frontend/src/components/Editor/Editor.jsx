import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
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
import { wikilink } from './wikilink'
import { mention } from './mention'
import { math, mathBlockSchema } from './math'
import { tableTooltip } from './tableTooltip'
import { tablePasteExpand } from './tablePasteExpand'
import { isStrayPostCompositionEnter } from './imeGuard'

const SLASH_ITEM_DEFS = [
  { id: 'h1', icon: 'H1' },
  { id: 'h2', icon: 'H2' },
  { id: 'h3', icon: 'H3' },
  { id: 'bullet', icon: '\u2022' },
  { id: 'ordered', icon: '1.' },
  { id: 'quote', icon: '\u275D' },
  { id: 'code', icon: '</>' },
  { id: 'hr', icon: '\u2014' },
  { id: 'callout-info', icon: '\u2139' },
  { id: 'callout-warning', icon: '\u26A0' },
  { id: 'callout-tip', icon: '\u2713' },
  { id: 'callout-danger', icon: '\u2715' },
  { id: 'mermaid', icon: '\u25C7' },
  { id: 'math', icon: '\u03A3' },
  { id: 'drawio', icon: '\u25A1' },
  { id: 'media', icon: '\u{1F5BC}' },
]

function buildSlashItems(t) {
  return SLASH_ITEM_DEFS.map((d) => ({
    id: d.id,
    icon: d.icon,
    label: t(`slash.items.${d.id}.label`),
    desc: t(`slash.items.${d.id}.desc`),
  }))
}

function executeSlashCommand(ctx, id, view, drawioHandlerRef, mediaHandlerRef) {
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
    const mathType = mathBlockSchema.type(ctx)
    const node = mathType.create({ value: 'E = mc^2' })
    dispatch(state.tr.replaceSelectionWith(node))
    return
  }

  if (id === 'drawio') {
    if (drawioHandlerRef?.current) drawioHandlerRef.current()
    return
  }

  if (id === 'media') {
    if (mediaHandlerRef?.current) mediaHandlerRef.current()
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
  constructor(ctx, view, drawioHandlerRef, editorViewRef, mediaHandlerRef, items) {
    this.ctx = ctx
    this.view = view
    this.drawioHandlerRef = drawioHandlerRef
    this.mediaHandlerRef = mediaHandlerRef
    this.editorViewRef = editorViewRef
    this.items = items
    editorViewRef.current = view
    this.selectedIndex = 0
    this.filteredItems = [...items]
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
        if (view.composing) return false
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
        this.filteredItems = this.items.filter(
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
    if (event.isComposing || event.keyCode === 229) return false
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
        executeSlashCommand(this.ctx, item.id, this.view, this.drawioHandlerRef, this.mediaHandlerRef)
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
        executeSlashCommand(this.ctx, item.id, this.view, this.drawioHandlerRef, this.mediaHandlerRef)
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
    // Don't query or mutate menu state mid-IME — coordsAtPos / DOM writes
    // triggered here can drop in-flight composition characters on Windows.
    if (view.composing) return
    this.provider.update(view)
  }

  destroy() {
    this.provider.destroy()
    this.content.remove()
  }
}

// ── Wikilink [[ autocomplete ──

class WikilinkMenu {
  constructor(emptyLabel) {
    this.emptyLabel = emptyLabel
    this.el = document.createElement('div')
    this.el.className = 'wikilink-menu'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)

    this.pages = []
    this.filtered = []
    this.selectedIndex = 0
    this.active = false
    this.triggerPos = null  // doc position where [[ starts
    this._lastQuery = null
    this._lastPagesCount = -1  // -1 forces a render on first show()

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
    if (this.active && this.triggerPos === from && this._lastQuery === query
        && this._lastPagesCount === this.pages.length) {
      // Re-position only — query and page list unchanged, no need to re-render
      const coords = view.coordsAtPos(view.state.selection.head)
      this.el.style.left = coords.left + 'px'
      this.el.style.top = (coords.bottom + 4) + 'px'
      return
    }
    this._lastQuery = query
    this._lastPagesCount = this.pages.length
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
    this._lastQuery = null
    this._lastPagesCount = -1
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
      empty.textContent = this.emptyLabel
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
    const to = state.selection.head
    const nodeType = state.schema.nodes.wikilink
    if (!nodeType) {
      // Schema not registered yet — fall back to plain text so typing still works.
      const text = `[[${page.slug}|${page.title}]]`
      dispatch(state.tr.replaceWith(this.triggerPos, to, state.schema.text(text)))
    } else {
      const node = nodeType.create({
        slug: page.slug,
        display: page.title,
        transclusion: false,
      })
      dispatch(state.tr.replaceWith(this.triggerPos, to, node))
    }
    this.hide()
  }

  handleKeyDown(view, event) {
    if (!this.active) return false
    if (event.isComposing || event.keyCode === 229) return false
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

// ── Mention `@` / `@@` autocomplete ──

class MentionMenu {
  constructor({ pageSlug, emptyLabel }) {
    this.pageSlug = pageSlug
    this.emptyLabel = emptyLabel
    this.el = document.createElement('div')
    this.el.className = 'wikilink-menu mention-menu'
    this.el.style.display = 'none'
    document.body.appendChild(this.el)

    this.users = []
    this.groups = []
    this.combined = []
    this.selectedIndex = 0
    this.active = false
    this.triggerPos = null
    this.isGroup = false
    this.lastQuery = null
    this._fetchSeq = 0
  }

  async fetchCandidates(query, isGroup) {
    const seq = ++this._fetchSeq
    try {
      let users = []
      let groups = []
      // Without a page context we can't ACL-filter; fall back to the
      // generic user-search endpoint (already restricted to authenticated
      // users) so the editor still surfaces candidates while editing a
      // brand-new page. The actual notification still re-checks ACL.
      if (this.pageSlug) {
        const res = await api.get('/users/mentionable', {
          params: { page_slug: this.pageSlug, q: query },
        })
        users = res.data.users || []
        groups = res.data.groups || []
      } else {
        const res = await api.get('/users/search', { params: { q: query, limit: 10 } })
        users = (res.data || []).map((u) => ({
          username: u.username,
          display_name: u.display_name || '',
        }))
      }
      // Drop out-of-order responses so a slow earlier request can't paint
      // stale rows over a fresher one.
      if (seq !== this._fetchSeq) return
      this.users = users
      this.groups = groups
      this.combined = isGroup
        ? groups.map((g) => ({ kind: 'group', name: g.name, sub: g.description }))
        : [
            ...users.map((u) => ({ kind: 'user', name: u.username, sub: u.display_name })),
          ]
      this.selectedIndex = 0
      this.render()
    } catch {
      // ignore — autocomplete is best-effort
    }
  }

  show(view, triggerPos, query, isGroup) {
    this.active = true
    this.triggerPos = triggerPos
    this.isGroup = isGroup
    this.lastQuery = query

    const coords = view.coordsAtPos(view.state.selection.head)
    this.el.style.position = 'fixed'
    this.el.style.left = coords.left + 'px'
    this.el.style.top = (coords.bottom + 4) + 'px'
    this.el.style.display = ''
    this.el.style.zIndex = '200'

    this.fetchCandidates(query, isGroup)
  }

  hide() {
    this.active = false
    this.el.style.display = 'none'
    this.triggerPos = null
    this.lastQuery = null
  }

  render() {
    this.el.innerHTML = ''
    if (this.combined.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'wikilink-menu-empty'
      empty.textContent = this.emptyLabel
      this.el.appendChild(empty)
      return
    }
    this.combined.forEach((item, i) => {
      const row = document.createElement('div')
      row.className = 'wikilink-menu-item' + (i === this.selectedIndex ? ' active' : '')
      const sigil = item.kind === 'group' ? '@@' : '@'
      const escName = item.name.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      const escSub = (item.sub || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
      row.innerHTML = `
        <span class="wikilink-menu-title">${sigil}${escName}</span>
        <span class="wikilink-menu-slug">${escSub}</span>
      `
      row.addEventListener('mouseenter', () => {
        this.selectedIndex = i
        this.render()
      })
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.select(item)
      })
      this.el.appendChild(row)
    })
  }

  select(item) {
    if (!this._view || this.triggerPos == null) return
    const { state, dispatch } = this._view
    const to = state.selection.head
    const nodeType = state.schema.nodes.mention
    if (!nodeType) {
      const sigil = item.kind === 'group' ? '@@' : '@'
      const text = `${sigil}${item.name} `
      dispatch(state.tr.replaceWith(this.triggerPos, to, state.schema.text(text)))
    } else {
      const node = nodeType.create({
        name: item.name,
        group: item.kind === 'group',
      })
      // Insert the node + a trailing space so the user can keep typing
      // without the next keystroke being absorbed into the atom node.
      const tr = state.tr.replaceWith(this.triggerPos, to, node)
      tr.insertText(' ', tr.mapping.map(to))
      dispatch(tr)
    }
    this.hide()
  }

  handleKeyDown(view, event) {
    if (!this.active) return false
    if (event.isComposing || event.keyCode === 229) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.combined.length - 1)
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
      if (this.combined.length === 0) return false
      event.preventDefault()
      const item = this.combined[this.selectedIndex]
      if (item) this.select(item)
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

const mentionPluginKey = new PluginKey('mention-autocomplete')

const Editor = forwardRef(function Editor({ defaultValue = '', onChange, onDrawioOpen, onMediaPickerOpen, onTabOut, pageSlug = null }, ref) {
  const { t } = useTranslation()
  const editorRef = useRef(null)
  const containerRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const drawioHandlerRef = useRef(onDrawioOpen)
  const mediaHandlerRef = useRef(onMediaPickerOpen)
  const onTabOutRef = useRef(onTabOut)
  const editorViewRef = useRef(null)
  // The slash menu and wikilink menu both render plain DOM (not React),
  // so they cannot read t() from context. Snapshot translated strings into
  // refs before the editor's init effect runs.
  const slashItemsRef = useRef(null)
  const wikilinkEmptyRef = useRef('')
  const mentionEmptyRef = useRef('')
  const tableTooltipLabelsRef = useRef(null)
  const pageSlugRef = useRef(pageSlug)
  useEffect(() => { pageSlugRef.current = pageSlug }, [pageSlug])
  useEffect(() => {
    slashItemsRef.current = buildSlashItems(t)
    wikilinkEmptyRef.current = t('slash.wikilinkEmpty')
    mentionEmptyRef.current = t('mention.empty', 'No matches')
    tableTooltipLabelsRef.current = {
      addRowAbove: t('tableTooltip.addRowAbove'),
      addRowBelow: t('tableTooltip.addRowBelow'),
      addColLeft: t('tableTooltip.addColLeft'),
      addColRight: t('tableTooltip.addColRight'),
      deleteRow: t('tableTooltip.deleteRow'),
      deleteCol: t('tableTooltip.deleteCol'),
      deleteTable: t('tableTooltip.deleteTable'),
    }
  }, [t])

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    drawioHandlerRef.current = onDrawioOpen || null
  }, [onDrawioOpen])

  useEffect(() => {
    mediaHandlerRef.current = onMediaPickerOpen || null
  }, [onMediaPickerOpen])

  useEffect(() => {
    onTabOutRef.current = onTabOut || null
  }, [onTabOut])

  useImperativeHandle(ref, () => ({
    insertText(text) {
      const view = editorViewRef.current
      if (!view) return
      const { state, dispatch } = view
      const pos = state.selection.from
      dispatch(state.tr.insertText(text, pos))
    },
    focus() {
      const view = editorViewRef.current
      if (!view) return
      view.focus()
    }
  }), [])

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    const slash = slashFactory('slash-menu')

    // Create wikilink plugin per editor instance to avoid stale DOM references
    const wikilinkMenu = new WikilinkMenu(wikilinkEmptyRef.current)
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
              // Bail during IME composition: coordsAtPos + DOM writes from
              // show()/hide() can disturb the active composition on Windows,
              // making characters disappear and the cursor jump.
              if (view.composing) return
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

    const mentionMenu = new MentionMenu({
      pageSlug: pageSlugRef.current,
      emptyLabel: mentionEmptyRef.current,
    })
    const mentionPlugin = $prose(() => {
      return new Plugin({
        key: mentionPluginKey,
        props: {
          handleKeyDown(view, event) {
            return mentionMenu.handleKeyDown(view, event)
          },
        },
        view(editorView) {
          mentionMenu._view = editorView
          return {
            update(view) {
              mentionMenu._view = view
              if (view.composing) return
              const { state } = view
              const { selection } = state
              if (!(selection instanceof TextSelection)) {
                mentionMenu.hide()
                return
              }
              const { $head } = selection
              const textBefore = $head.parent.textContent.slice(0, $head.parentOffset)

              // Find the latest `@` (or `@@`) start that is followed only by
              // mention-name chars up to the cursor. Stop on whitespace or
              // anything outside `[A-Za-z0-9_-@]` so a previous mention on
              // the same line doesn't keep the menu open forever.
              let i = textBefore.length - 1
              while (i >= 0 && /[A-Za-z0-9_-]/.test(textBefore[i])) i--
              if (i < 0 || textBefore[i] !== '@') {
                mentionMenu.hide()
                return
              }
              // Name must start with alphanum (matches the renderer/server
              // regex). `@-bob` typed mid-word is junk, hide rather than
              // surface a mention that won't ever resolve.
              const firstNameChar = textBefore[i + 1]
              if (firstNameChar !== undefined && !/[A-Za-z0-9]/.test(firstNameChar)) {
                mentionMenu.hide()
                return
              }
              let triggerStart = i
              let isGroup = false
              if (i > 0 && textBefore[i - 1] === '@') {
                triggerStart = i - 1
                isGroup = true
              }
              // Boundary check: char before `@` (or `@@`) must not be word/@//.
              if (triggerStart > 0) {
                const prev = textBefore[triggerStart - 1]
                if (/[A-Za-z0-9_@/]/.test(prev)) {
                  mentionMenu.hide()
                  return
                }
              }

              const query = textBefore.slice(i + 1)
              const blockStart = $head.pos - $head.parentOffset
              const triggerPos = blockStart + triggerStart

              if (mentionMenu.active && mentionMenu.triggerPos === triggerPos && mentionMenu.lastQuery === query) {
                return  // already showing this exact state
              }
              mentionMenu.show(view, triggerPos, query, isGroup)
            },
            destroy() {
              mentionMenu.destroy()
            },
          }
        },
      })
    })

    const tabOutPlugin = $prose(() => {
      return new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Tab' || event.shiftKey) return false
            if (event.isComposing || event.keyCode === 229) return false
            if (!onTabOutRef.current) return false
            const { $from } = view.state.selection
            for (let depth = $from.depth; depth >= 0; depth--) {
              const name = $from.node(depth).type.name
              if (['list_item', 'bullet_list', 'ordered_list', 'code_block', 'table'].includes(name)) {
                return false
              }
            }
            event.preventDefault()
            onTabOutRef.current()
            return true
          },
        },
      })
    })

    // On Windows, the Enter that confirms an IME selection can surface as a
    // stray keydown fired right after compositionend (isComposing already
    // false), which ProseMirror's default Enter handler would turn into a
    // spurious block split. Suppress only that stray Enter — scoped to a
    // short window after compositionend — and never an Enter that is still
    // part of an active composition (see imeGuard.js for the rationale).
    const compositionGuardPlugin = $prose(() => {
      let lastCompositionEndAt = 0
      return new Plugin({
        props: {
          handleDOMEvents: {
            compositionend(_view, _event) {
              lastCompositionEndAt = performance.now()
              return false
            },
          },
          handleKeyDown(_view, event) {
            if (isStrayPostCompositionEnter(event, lastCompositionEndAt, performance.now())) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
      })
    })

    const init = async () => {
      const editor = await MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, containerRef.current)
          ctx.set(defaultValueCtx, defaultValue)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            // Skip parent state updates while IME composition is active —
            // the React re-render they trigger can interrupt composition on
            // Windows. ProseMirror dispatches a final transaction at
            // compositionend, which fires the listener again with the
            // committed text, so no input is lost.
            if (editorViewRef.current?.composing) return
            onChangeRef.current?.(markdown)
          })
          let slashMenuView = null
          ctx.set(slash.key, {
            view: (editorView) => {
              slashMenuView = new SlashMenuView(ctx, editorView, drawioHandlerRef, editorViewRef, mediaHandlerRef, slashItemsRef.current)
              return slashMenuView
            },
            props: {
              handleKeyDown(view, event) {
                return slashMenuView?.handleKey(event) ?? false
              },
            },
          })
        })
        .use(tablePasteExpand)
        .use(commonmark)
        .use(gfm)
        .use(math)
        .use(listener)
        .use(clipboard)
        .use(history)
        .use(slash)
        .use(wikilink)
        .use(wikilinkPlugin)
        .use(mention)
        .use(mentionPlugin)
        .use(tabOutPlugin)
        .use(compositionGuardPlugin)
        .use(tableTooltip(tableTooltipLabelsRef.current))
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
