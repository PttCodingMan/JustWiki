import { describe, it, expect } from 'vitest'
import {
  locateTable,
  deleteTable,
  deleteRow,
  deleteColumn,
  addRow,
  addColumn,
} from '../tableOps'
import {
  th,
  td,
  headerRow,
  bodyRow,
  tableNode,
  docNode,
  stateInCell,
  stateOutsideTable,
  describeTable,
  findTable,
  testSchema,
} from './tableTestUtils'

// Apply a tr to a state and return the post-doc + the table within.
function apply(state, tr) {
  if (!tr) return { doc: state.doc, table: findTable(state.doc)?.node ?? null }
  const next = state.apply(tr)
  return { doc: next.doc, table: findTable(next.doc)?.node ?? null }
}

describe('locateTable', () => {
  it('returns null when selection is not inside a table', () => {
    const para = testSchema.nodes.paragraph.create(null, testSchema.text('hello'))
    const doc = testSchema.nodes.doc.create(null, [para])
    const state = stateOutsideTable(doc, 1)
    expect(locateTable(state)).toBeNull()
  })

  it('returns row/col indices for cursor inside a body cell', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B'), th('C')),
        bodyRow(td('1'), td('2'), td('3')),
        bodyRow(td('4'), td('5'), td('6'))
      )
    )
    const state = stateInCell(doc, 2, 1) // body row 1, col 1 — cell "5"
    const loc = locateTable(state)
    expect(loc).not.toBeNull()
    expect(loc.rowIndex).toBe(2)
    expect(loc.colIndex).toBe(1)
    expect(loc.row.node.type.name).toBe('table_row')
  })

  it('handles cursor in header row', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2'))
      )
    )
    const state = stateInCell(doc, 0, 1)
    const loc = locateTable(state)
    expect(loc.rowIndex).toBe(0)
    expect(loc.row.node.type.name).toBe('table_header_row')
  })
})

describe('deleteTable', () => {
  it('removes the entire table', () => {
    const doc = docNode(
      tableNode(headerRow(th('A')), bodyRow(td('1')))
    )
    const state = stateInCell(doc, 1, 0)
    const loc = locateTable(state)
    const { doc: after } = apply(state, deleteTable(state, loc))
    expect(findTable(after)).toBeNull()
  })
})

describe('deleteRow', () => {
  it('removes a body row when more than one body row exists', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2')),
        bodyRow(td('3'), td('4')),
        bodyRow(td('5'), td('6'))
      )
    )
    const state = stateInCell(doc, 2, 0) // delete the middle body row
    const loc = locateTable(state)
    const { table } = apply(state, deleteRow(state, loc))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(3)
    expect(desc.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['A', 'B'],
      ['1', '2'],
      ['5', '6'],
    ])
  })

  it('deletes the whole table when removing the only body row', () => {
    const doc = docNode(
      tableNode(headerRow(th('A')), bodyRow(td('1')))
    )
    const state = stateInCell(doc, 1, 0)
    const loc = locateTable(state)
    const { doc: after } = apply(state, deleteRow(state, loc))
    expect(findTable(after)).toBeNull()
  })

  it('promotes the first body row when the header is deleted', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2')),
        bodyRow(td('3'), td('4'))
      )
    )
    const state = stateInCell(doc, 0, 0) // cursor in header
    const loc = locateTable(state)
    const { table } = apply(state, deleteRow(state, loc))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(2)
    expect(desc.rows[0].kind).toBe('table_header_row')
    expect(desc.rows[0].cells.every((c) => c.kind === 'table_header')).toBe(true)
    expect(desc.rows[0].cells.map((c) => c.text)).toEqual(['1', '2'])
    expect(desc.rows[1].kind).toBe('table_row')
    expect(desc.rows[1].cells.map((c) => c.text)).toEqual(['3', '4'])
  })
})

describe('deleteColumn', () => {
  it('removes a column from every row', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B'), th('C')),
        bodyRow(td('1'), td('2'), td('3')),
        bodyRow(td('4'), td('5'), td('6'))
      )
    )
    const state = stateInCell(doc, 1, 1) // body row, middle column
    const loc = locateTable(state)
    const { table } = apply(state, deleteColumn(state, loc))
    const desc = describeTable(table)
    expect(desc.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['A', 'C'],
      ['1', '3'],
      ['4', '6'],
    ])
  })

  it('deletes the whole table when removing the only column', () => {
    const doc = docNode(
      tableNode(headerRow(th('A')), bodyRow(td('1')), bodyRow(td('2')))
    )
    const state = stateInCell(doc, 1, 0)
    const loc = locateTable(state)
    const { doc: after } = apply(state, deleteColumn(state, loc))
    expect(findTable(after)).toBeNull()
  })

  it('drops a row that would become empty', () => {
    // Body row 2 has only one cell — a ragged row. Removing column 0
    // would leave it with zero cells (invalid), so the row is dropped.
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2')),
        bodyRow(td('only'))
      )
    )
    const state = stateInCell(doc, 1, 0)
    const loc = locateTable(state)
    const { table } = apply(state, deleteColumn(state, loc))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(2)
    expect(desc.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['B'],
      ['2'],
    ])
  })
})

describe('addRow', () => {
  it('inserts a body row above the current row', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2')),
        bodyRow(td('3'), td('4'))
      )
    )
    const state = stateInCell(doc, 2, 0)
    const loc = locateTable(state)
    const { table } = apply(state, addRow(state, loc, 'before'))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(4)
    expect(desc.rows[2].kind).toBe('table_row')
    expect(desc.rows[2].cells.map((c) => c.text)).toEqual(['', ''])
  })

  it('inserts a body row below the current row', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2'))
      )
    )
    const state = stateInCell(doc, 1, 1)
    const loc = locateTable(state)
    const { table } = apply(state, addRow(state, loc, 'after'))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(3)
    expect(desc.rows[2].kind).toBe('table_row')
  })

  it('treats "row above header" as "row below header" so the schema stays valid', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2'))
      )
    )
    const state = stateInCell(doc, 0, 0) // cursor in header
    const loc = locateTable(state)
    const { table } = apply(state, addRow(state, loc, 'before'))
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(3)
    expect(desc.rows[0].kind).toBe('table_header_row')
    expect(desc.rows[1].kind).toBe('table_row') // newly inserted
    expect(desc.rows[1].cells.map((c) => c.text)).toEqual(['', ''])
    expect(desc.rows[2].cells.map((c) => c.text)).toEqual(['1', '2'])
  })
})

describe('addColumn', () => {
  it('inserts a column before the current cell across all rows', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2')),
        bodyRow(td('3'), td('4'))
      )
    )
    const state = stateInCell(doc, 1, 0)
    const loc = locateTable(state)
    const { table } = apply(state, addColumn(state, loc, 'before'))
    const desc = describeTable(table)
    expect(desc.rows[0].cells.map((c) => c.kind)).toEqual([
      'table_header',
      'table_header',
      'table_header',
    ])
    expect(desc.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['', 'A', 'B'],
      ['', '1', '2'],
      ['', '3', '4'],
    ])
  })

  it('inserts a column after the current cell across all rows', () => {
    const doc = docNode(
      tableNode(
        headerRow(th('A'), th('B')),
        bodyRow(td('1'), td('2'))
      )
    )
    const state = stateInCell(doc, 1, 1)
    const loc = locateTable(state)
    const { table } = apply(state, addColumn(state, loc, 'after'))
    const desc = describeTable(table)
    expect(desc.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['A', 'B', ''],
      ['1', '2', ''],
    ])
    expect(desc.rows[1].cells.map((c) => c.kind)).toEqual([
      'table_cell',
      'table_cell',
      'table_cell',
    ])
  })
})
