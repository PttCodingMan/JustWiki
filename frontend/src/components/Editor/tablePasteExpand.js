import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Fragment } from '@milkdown/kit/prose/model'
import { $prose } from '@milkdown/kit/utils'
import { handlePaste as pmTableHandlePaste, isInTable } from '@milkdown/prose/tables'

// Excel-style paste for tables.
//
// Inside a table: route paste through prosemirror-tables' handlePaste so its
// growTable() auto-expands the target to fit the pasted rect. Without this,
// @milkdown/plugin-clipboard returns true first and replaces the selection
// with the raw slice, producing nested/garbled cells.
//
// Outside a table: build a valid standalone GFM table from the pasted rows.
// ProseMirror's default replaceSelection() wraps the slice in <table> but
// can't satisfy Milkdown's `table_header_row table_row+` content rule with
// just the body row in clipboard, so it autofills an empty header_row whose
// default-fill cells serialize to malformed pipes (`|\n|\n|\n|`) — that
// breaks GFM round-trip and the next save fails.
const key = new PluginKey('jw-table-paste-expand')

const ROW_ROLES = new Set(['row'])

function stripTableWrapper(slice) {
  let { content } = slice
  while (
    content.childCount === 1 &&
    content.child(0).type.spec.tableRole === 'table'
  ) {
    content = content.child(0).content
  }
  return content
}

function rowHasContent(rowNode) {
  let found = false
  rowNode.forEach((cell) => {
    if (cell.textContent.trim().length > 0) found = true
  })
  return found
}

function collectRows(slice) {
  const rows = []
  stripTableWrapper(slice).forEach((node) => {
    if (ROW_ROLES.has(node.type.spec.tableRole)) rows.push(node)
  })
  // Drop ProseMirror's autofilled empty header row when present.
  while (rows.length > 1 && !rowHasContent(rows[0])) rows.shift()
  return rows
}

// A 1x1 slice is almost always plain text the user copied from a single
// spreadsheet cell — wrapping it in a 1-row table is rarely what they want.
// Bail and let the default paste handle it as text.
function isTrivialSingleCell(rows) {
  if (rows.length !== 1) return false
  const row = rows[0]
  if (row.childCount !== 1) return false
  return true
}

function buildStandaloneTable(schema, rows) {
  const tableType = schema.nodes.table
  const headerRowType = schema.nodes.table_header_row
  const bodyRowType = schema.nodes.table_row
  const headerCellType = schema.nodes.table_header
  const bodyCellType = schema.nodes.table_cell
  if (!tableType || !headerRowType || !bodyRowType || !headerCellType || !bodyCellType) return null

  let width = 0
  rows.forEach((r) => {
    width = Math.max(width, r.childCount)
  })
  if (width === 0) return null

  const cellsFor = (sourceRow, type) => {
    const out = []
    for (let c = 0; c < width; c++) {
      const src = c < sourceRow.childCount ? sourceRow.child(c) : null
      if (src) {
        out.push(type.create({ alignment: src.attrs.alignment ?? null }, src.content))
      } else {
        const filled = type.createAndFill()
        if (filled) out.push(filled)
      }
    }
    return out
  }

  const headerRow = headerRowType.create(null, Fragment.from(cellsFor(rows[0], headerCellType)))
  const bodyRows = []
  for (let i = 1; i < rows.length; i++) {
    bodyRows.push(bodyRowType.create(null, Fragment.from(cellsFor(rows[i], bodyCellType))))
  }
  // GFM table requires at least one body row.
  if (bodyRows.length === 0) {
    const empties = []
    for (let c = 0; c < width; c++) {
      const filled = bodyCellType.createAndFill()
      if (filled) empties.push(filled)
    }
    bodyRows.push(bodyRowType.create(null, Fragment.from(empties)))
  }
  return tableType.create(null, Fragment.from([headerRow, ...bodyRows]))
}

// Exported for unit tests; not part of the runtime plugin's public surface.
export const __test__ = {
  collectRows,
  isTrivialSingleCell,
  buildStandaloneTable,
}

export const tablePasteExpand = $prose(() => {
  return new Plugin({
    key,
    props: {
      handlePaste(view, event, slice) {
        if (isInTable(view.state)) {
          return pmTableHandlePaste(view, event, slice)
        }
        const rows = collectRows(slice)
        if (rows.length === 0) return false
        if (isTrivialSingleCell(rows)) return false
        const table = buildStandaloneTable(view.state.schema, rows)
        if (!table) return false
        view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView())
        return true
      },
    },
  })
})
