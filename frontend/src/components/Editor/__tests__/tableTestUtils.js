import { Schema } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'
import { EditorState, TextSelection } from 'prosemirror-state'

// Mirror Milkdown's GFM table schema as closely as needed for our ops:
// `table_header_row table_row+`, header rows hold `table_header` cells,
// body rows hold `table_cell`. Cell content is a paragraph, matching the
// real schema's `cellContent: 'paragraph'`.
const baseTableNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'paragraph',
  cellAttributes: {
    alignment: { default: 'left' },
  },
})

export const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
    table: {
      ...baseTableNodes.table,
      content: 'table_header_row table_row+',
    },
    table_header_row: {
      ...baseTableNodes.table_row,
      content: '(table_header)*',
    },
    table_row: {
      ...baseTableNodes.table_row,
      content: '(table_cell)*',
    },
    table_cell: baseTableNodes.table_cell,
    table_header: baseTableNodes.table_header,
  },
})

const s = testSchema

function paragraph(text) {
  return s.nodes.paragraph.create(null, text ? [s.text(text)] : null)
}

export function th(text, alignment = 'left') {
  return s.nodes.table_header.create({ alignment }, paragraph(text))
}

export function td(text, alignment = 'left') {
  return s.nodes.table_cell.create({ alignment }, paragraph(text))
}

export function headerRow(...cells) {
  return s.nodes.table_header_row.create(null, cells)
}

export function bodyRow(...cells) {
  return s.nodes.table_row.create(null, cells)
}

export function tableNode(headerCellsOrRow, ...rows) {
  // Accept either (headerRow, ...bodyRows) or shorthand (headerCellsArray, ...bodyArrays)
  return s.nodes.table.create(null, [headerCellsOrRow, ...rows])
}

export function docNode(...content) {
  return s.nodes.doc.create(null, content)
}

// Build an EditorState with the cursor inside the (rowIndex, colIndex) cell
// of the first table found at `tableDocPos`. tableDocPos defaults to 0,
// matching `docNode(table(...))`.
export function stateInCell(doc, rowIndex, colIndex, tableDocPos = 0) {
  const tableNodeAtPos = doc.nodeAt(tableDocPos)
  if (!tableNodeAtPos || tableNodeAtPos.type.name !== 'table') {
    throw new Error(`No table at doc position ${tableDocPos}`)
  }
  // Walk into the table → row → cell → paragraph.
  let pos = tableDocPos + 1 // inside table
  for (let i = 0; i < rowIndex; i += 1) {
    pos += tableNodeAtPos.child(i).nodeSize
  }
  const row = tableNodeAtPos.child(rowIndex)
  pos += 1 // inside row
  for (let i = 0; i < colIndex; i += 1) {
    pos += row.child(i).nodeSize
  }
  // pos = start of cell. Skip cell-open + paragraph-open to land in text.
  pos += 2
  return EditorState.create({
    doc,
    schema: s,
    selection: TextSelection.create(doc, pos),
  })
}

export function stateOutsideTable(doc, pos) {
  return EditorState.create({
    doc,
    schema: s,
    selection: TextSelection.create(doc, pos),
  })
}

// Inspect a table after a transaction. Returns a plain JS structure:
// { rows: [{ kind, cells: [{ kind, text }] }] } — easy for assertions.
export function describeTable(tableNode) {
  if (!tableNode || tableNode.type.name !== 'table') return null
  const rows = []
  tableNode.forEach((rowNode) => {
    const cells = []
    rowNode.forEach((cellNode) => {
      cells.push({ kind: cellNode.type.name, text: cellNode.textContent })
    })
    rows.push({ kind: rowNode.type.name, cells })
  })
  return { rows }
}

// Find the first table in a doc (descend top-level only — sufficient for tests).
export function findTable(doc) {
  let result = null
  doc.forEach((child, offset) => {
    if (!result && child.type.name === 'table') {
      result = { node: child, pos: offset }
    }
  })
  return result
}
