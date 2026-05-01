// Pure transaction builders for the in-editor table tooltip.
//
// All add/delete operations operate on the document via direct node-range
// edits instead of prosemirror-tables' TableMap helpers. TableMap silently
// no-ops on ragged or otherwise malformed tables, and milkdown's gfm
// addRow* commands always insert a body-typed row — which violates the
// `table_header_row table_row+` schema when the cursor is in the header.
//
// Each helper takes (state, location) and returns a Transaction or null
// when the operation cannot proceed. `null` means "no-op": the caller
// should not dispatch.
//
// The schema invariant we enforce everywhere:
//
//     table = table_header_row + table_row+
//
// i.e. a table must keep exactly one header row and at least one body
// row. Any operation that would violate it is rerouted to "delete the
// whole table" — which is safer than producing a doc the editor would
// silently reject.

import { Fragment } from '@milkdown/kit/prose/model'
import { findParent } from '@milkdown/prose'

const HEADER_ROW = 'table_header_row'
const BODY_ROW = 'table_row'
const ROW_TYPES = [HEADER_ROW, BODY_ROW]
const CELL_TYPES = ['table_cell', 'table_header']

function findNodeIndex(parent, child) {
  for (let i = 0; i < parent.childCount; i += 1) {
    if (parent.child(i) === child) return i
  }
  return -1
}

function isRowType(node) {
  return ROW_TYPES.includes(node.type.name)
}

export function locateTable(state) {
  const $pos = state.selection.$from
  const table = findParent((n) => n.type.name === 'table')($pos)
  if (!table) return null
  const row = findParent((n) => ROW_TYPES.includes(n.type.name))($pos)
  const cell = findParent((n) => CELL_TYPES.includes(n.type.name))($pos)
  if (!row || !cell) return null
  const rowIndex = findNodeIndex(table.node, row.node)
  const colIndex = findNodeIndex(row.node, cell.node)
  if (rowIndex < 0 || colIndex < 0) return null
  return { table, row, cell, rowIndex, colIndex }
}

function countBodyRows(tableNode) {
  let n = 0
  tableNode.forEach((child) => {
    if (child.type.name === BODY_ROW) n += 1
  })
  return n
}

function tableWidth(tableNode) {
  let width = 0
  tableNode.forEach((rowNode) => {
    if (isRowType(rowNode)) width = Math.max(width, rowNode.childCount)
  })
  return width
}

// Position of the row at `rowIndex` inside the table — i.e. where the row's
// opening token sits in the doc. table.from + 1 jumps past the table's own
// opening token to land on the first row.
function rowStartPos(tableLoc, rowIndex) {
  let pos = tableLoc.from + 1
  for (let i = 0; i < rowIndex; i += 1) {
    pos += tableLoc.node.child(i).nodeSize
  }
  return pos
}

function buildEmptyCell(schema, type) {
  const cellType = schema.nodes[type]
  if (!cellType) return null
  return cellType.createAndFill()
}

function buildRow(schema, rowType, width) {
  const isHeader = rowType === HEADER_ROW
  const cellTypeName = isHeader ? 'table_header' : 'table_cell'
  const cells = []
  for (let i = 0; i < width; i += 1) {
    const cell = buildEmptyCell(schema, cellTypeName)
    if (cell) cells.push(cell)
  }
  const rowSchema = schema.nodes[rowType]
  if (!rowSchema) return null
  return rowSchema.create(null, Fragment.from(cells))
}

// Convert a `table_row` to a `table_header_row` (or vice versa), preserving
// each cell's content and alignment. Used when the header row is removed:
// the next body row is promoted so the table keeps a valid header.
function retypeRow(schema, sourceRow, targetRowType) {
  const isTargetHeader = targetRowType === HEADER_ROW
  const targetCellTypeName = isTargetHeader ? 'table_header' : 'table_cell'
  const cellSchema = schema.nodes[targetCellTypeName]
  const rowSchema = schema.nodes[targetRowType]
  if (!cellSchema || !rowSchema) return null

  const cells = []
  sourceRow.forEach((cell) => {
    cells.push(
      cellSchema.create(
        { alignment: cell.attrs?.alignment ?? null },
        cell.content
      )
    )
  })
  return rowSchema.create(null, Fragment.from(cells))
}

// ── Public ops ───────────────────────────────────────────────────────────

export function deleteTable(state, location) {
  const { table } = location
  return state.tr.delete(table.from, table.to)
}

export function deleteRow(state, location) {
  const { table, row } = location
  const isHeader = row.node.type.name === HEADER_ROW
  const bodyCount = countBodyRows(table.node)

  if (isHeader) {
    // Need a body row to promote into the new header.
    if (bodyCount === 0) return deleteTable(state, location)
    const firstBodyIndex = 1
    const firstBody = table.node.child(firstBodyIndex)
    const newHeader = retypeRow(state.schema, firstBody, HEADER_ROW)
    if (!newHeader) return null
    const bodyFrom = row.from + row.node.nodeSize
    const bodyTo = bodyFrom + firstBody.nodeSize
    return state.tr.replaceWith(row.from, bodyTo, newHeader)
  }

  // Body row: refuse to leave the table headerless-or-bodyless.
  if (bodyCount <= 1) return deleteTable(state, location)
  return state.tr.delete(row.from, row.to)
}

export function deleteColumn(state, location) {
  const { table, colIndex } = location
  const ranges = []
  let survivingRows = 0
  let headerSurvives = false
  let cursor = table.from + 1

  table.node.forEach((rowNode) => {
    const rowFrom = cursor
    const rowTo = rowFrom + rowNode.nodeSize
    cursor = rowTo

    if (!isRowType(rowNode)) {
      survivingRows += 1
      return
    }

    const isHeader = rowNode.type.name === HEADER_ROW

    if (rowNode.childCount <= colIndex) {
      // Ragged row with no cell at this column — leave it alone.
      survivingRows += 1
      if (isHeader) headerSurvives = true
      return
    }

    if (rowNode.childCount === 1) {
      // Removing the only cell would leave an invalid empty row.
      // Drop the entire row instead.
      ranges.push([rowFrom, rowTo])
      return
    }

    let cellOffset = 0
    for (let i = 0; i < colIndex; i += 1) cellOffset += rowNode.child(i).nodeSize
    const cellFrom = rowFrom + 1 + cellOffset
    const cellTo = cellFrom + rowNode.child(colIndex).nodeSize
    ranges.push([cellFrom, cellTo])
    survivingRows += 1
    if (isHeader) headerSurvives = true
  })

  if (ranges.length === 0) return null

  // If the column delete would invalidate the table (no header left, or no
  // surviving rows at all), wipe the whole table — better than producing a
  // doc the schema rejects.
  if (survivingRows === 0 || !headerSurvives) {
    return deleteTable(state, location)
  }

  // Apply deletes in reverse document order so earlier positions stay valid.
  ranges.sort((a, b) => b[0] - a[0])
  const tr = state.tr
  ranges.forEach(([from, to]) => tr.delete(from, to))
  return tr
}

export function addRow(state, location, where) {
  const { table, row, rowIndex } = location
  const isHeader = row.node.type.name === HEADER_ROW
  const width = Math.max(row.node.childCount, tableWidth(table.node), 1)

  // The header must stay first. "Above the header" silently becomes
  // "below the header" — there is no valid position for a body row above
  // it, and inserting another header would break the schema.
  let insertIndex
  if (isHeader && where === 'before') {
    insertIndex = 1
  } else if (where === 'after') {
    insertIndex = rowIndex + 1
  } else {
    insertIndex = rowIndex
  }

  const newRow = buildRow(state.schema, BODY_ROW, width)
  if (!newRow) return null
  const insertPos = rowStartPos(table, insertIndex)
  return state.tr.insert(insertPos, newRow)
}

export function addColumn(state, location, where) {
  const { table, colIndex } = location
  const ranges = [] // [rowFrom, insertOffset, type] — collected in doc order
  let cursor = table.from + 1

  table.node.forEach((rowNode) => {
    const rowFrom = cursor
    cursor = rowFrom + rowNode.nodeSize

    if (!isRowType(rowNode)) return

    // Clamp column index to this row's width — if the row is shorter than
    // colIndex we append at the end.
    const target = Math.min(colIndex + (where === 'after' ? 1 : 0), rowNode.childCount)
    let cellOffset = 0
    for (let i = 0; i < target; i += 1) cellOffset += rowNode.child(i).nodeSize
    const insertPos = rowFrom + 1 + cellOffset
    const cellTypeName =
      rowNode.type.name === HEADER_ROW ? 'table_header' : 'table_cell'
    ranges.push([insertPos, cellTypeName])
  })

  if (ranges.length === 0) return null

  // Inserts must also go in reverse so earlier offsets stay valid.
  ranges.sort((a, b) => b[0] - a[0])
  const tr = state.tr
  for (const [pos, cellTypeName] of ranges) {
    const cell = buildEmptyCell(state.schema, cellTypeName)
    if (cell) tr.insert(pos, cell)
  }
  return tr
}
