import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { commandsCtx } from '@milkdown/kit/core'
import { findParent } from '@milkdown/prose'
import {
  addRowBeforeCommand,
  addRowAfterCommand,
  addColBeforeCommand,
  addColAfterCommand,
  selectRowCommand,
  selectColCommand,
  selectTableCommand,
  deleteSelectedCellsCommand,
} from '@milkdown/preset-gfm'

const CELL_TYPES = ['table_cell', 'table_header']
const ROW_TYPES = ['table_row', 'table_header_row']

function findNodeIndex(parent, child) {
  for (let i = 0; i < parent.childCount; i += 1) {
    if (parent.child(i) === child) return i
  }
  return -1
}

function locateTable(state) {
  const { selection } = state
  const $pos = selection.$from
  const table = findParent((n) => n.type.name === 'table')($pos)
  if (!table) return null
  const row = findParent((n) => ROW_TYPES.includes(n.type.name))($pos)
  const cell = findParent((n) => CELL_TYPES.includes(n.type.name))($pos)
  if (!row || !cell) return null
  const rowIndex = findNodeIndex(table.node, row.node)
  const colIndex = findNodeIndex(row.node, cell.node)
  if (rowIndex < 0 || colIndex < 0) return null
  return {
    tablePos: table.from,
    rowIndex,
    colIndex,
  }
}

class TableTooltip {
  constructor(ctx, labels) {
    this.ctx = ctx
    this.labels = labels
    this.view = null
    this.location = null
    this.tableDom = null

    this.el = document.createElement('div')
    this.el.className = 'table-tooltip'
    this.el.style.display = 'none'
    this.el.style.position = 'fixed'
    this.el.style.zIndex = '150'
    // Stop mousedown from clearing the editor selection before the click fires.
    this.el.addEventListener('mousedown', (e) => e.preventDefault())

    this.actions = [
      { id: 'rowAbove', icon: '↑+', label: labels.addRowAbove, group: 'add' },
      { id: 'rowBelow', icon: '↓+', label: labels.addRowBelow, group: 'add' },
      { id: 'colLeft', icon: '←+', label: labels.addColLeft, group: 'add' },
      { id: 'colRight', icon: '→+', label: labels.addColRight, group: 'add' },
      { id: 'delRow', icon: '⨯—', label: labels.deleteRow, group: 'del' },
      { id: 'delCol', icon: '⨯│', label: labels.deleteCol, group: 'del' },
      { id: 'delTable', icon: '⨯▦', label: labels.deleteTable, group: 'del' },
    ]

    let prevGroup = null
    this.actions.forEach((action) => {
      if (prevGroup && prevGroup !== action.group) {
        const sep = document.createElement('div')
        sep.className = 'table-tooltip-sep'
        this.el.appendChild(sep)
      }
      prevGroup = action.group
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'table-tooltip-btn'
      if (action.group === 'del') btn.classList.add('is-danger')
      btn.title = action.label
      btn.setAttribute('aria-label', action.label)
      btn.textContent = action.icon
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.runAction(action.id)
      })
      this.el.appendChild(btn)
    })

    document.body.appendChild(this.el)

    this.onScrollOrResize = () => {
      if (this.location) this.reposition()
    }
    window.addEventListener('scroll', this.onScrollOrResize, true)
    window.addEventListener('resize', this.onScrollOrResize)
  }

  attach(view) {
    this.view = view
  }

  update(view) {
    this.view = view
    if (view.composing) return
    const next = locateTable(view.state)
    if (!next) {
      this.hide()
      return
    }
    this.location = next
    this.tableDom = view.nodeDOM(next.tablePos) || null
    if (!this.tableDom || this.tableDom.nodeType !== 1) {
      this.hide()
      return
    }
    this.show()
  }

  show() {
    this.el.style.display = ''
    this.reposition()
  }

  hide() {
    this.location = null
    this.tableDom = null
    this.el.style.display = 'none'
  }

  reposition() {
    if (!this.tableDom) return
    const rect = this.tableDom.getBoundingClientRect()
    // Render once to measure
    const tipRect = this.el.getBoundingClientRect()
    let top = rect.top - tipRect.height - 6
    if (top < 4) top = rect.bottom + 6
    let left = rect.left
    const maxLeft = window.innerWidth - tipRect.width - 4
    if (left > maxLeft) left = Math.max(4, maxLeft)
    this.el.style.left = `${left}px`
    this.el.style.top = `${top}px`
  }

  runAction(id) {
    if (!this.view) return
    const commands = this.ctx.get(commandsCtx)
    // Re-resolve row/col index from current state — `this.location` may be stale
    // by the time a click handler runs (e.g. after a prior add-row/col op).
    const fresh = locateTable(this.view.state)
    if (!fresh) return
    const { rowIndex, colIndex } = fresh

    switch (id) {
      case 'rowAbove':
        commands.call(addRowBeforeCommand.key)
        break
      case 'rowBelow':
        commands.call(addRowAfterCommand.key)
        break
      case 'colLeft':
        commands.call(addColBeforeCommand.key)
        break
      case 'colRight':
        commands.call(addColAfterCommand.key)
        break
      case 'delRow':
        commands.call(selectRowCommand.key, { index: rowIndex })
        commands.call(deleteSelectedCellsCommand.key)
        break
      case 'delCol':
        commands.call(selectColCommand.key, { index: colIndex })
        commands.call(deleteSelectedCellsCommand.key)
        break
      case 'delTable':
        commands.call(selectTableCommand.key)
        commands.call(deleteSelectedCellsCommand.key)
        break
      default:
        break
    }
    this.view.focus()
  }

  destroy() {
    window.removeEventListener('scroll', this.onScrollOrResize, true)
    window.removeEventListener('resize', this.onScrollOrResize)
    this.el.remove()
  }
}

const tableTooltipKey = new PluginKey('jw-table-tooltip')

export function tableTooltip(labels) {
  return $prose((ctx) => {
    let tooltip = null
    return new Plugin({
      key: tableTooltipKey,
      view(editorView) {
        tooltip = new TableTooltip(ctx, labels)
        tooltip.attach(editorView)
        tooltip.update(editorView)
        return {
          update(view) {
            tooltip.update(view)
          },
          destroy() {
            tooltip.destroy()
            tooltip = null
          },
        }
      },
    })
  })
}
