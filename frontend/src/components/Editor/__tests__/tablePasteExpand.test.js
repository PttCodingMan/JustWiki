import { describe, it, expect } from 'vitest'
import { Slice, Fragment } from 'prosemirror-model'
import { __test__ } from '../tablePasteExpand'
import {
  testSchema,
  th,
  td,
  headerRow,
  bodyRow,
  describeTable,
} from './tableTestUtils'

const { collectRows, isTrivialSingleCell, buildStandaloneTable } = __test__

const s = testSchema

function sliceFrom(...nodes) {
  return new Slice(Fragment.from(nodes), 0, 0)
}

describe('collectRows', () => {
  it('extracts rows from a slice that already contains a table wrapper', () => {
    const inner = s.nodes.table.create(null, [
      headerRow(th('A'), th('B')),
      bodyRow(td('1'), td('2')),
    ])
    const rows = collectRows(sliceFrom(inner))
    expect(rows).toHaveLength(2)
    expect(rows[0].type.name).toBe('table_header_row')
    expect(rows[1].type.name).toBe('table_row')
  })

  it('drops a leading auto-filled empty header row', () => {
    // ProseMirror can synthesize an empty header row when round-tripping
    // body-only fragments. collectRows should strip it as long as it's
    // not the only row.
    const emptyHeader = s.nodes.table_header_row.create(null, [
      th(''),
      th(''),
    ])
    const realBody = bodyRow(td('1'), td('2'))
    const rows = collectRows(sliceFrom(emptyHeader, realBody))
    expect(rows).toHaveLength(1)
    expect(rows[0].type.name).toBe('table_row')
  })

  it('keeps a single empty row rather than returning nothing', () => {
    const onlyHeader = s.nodes.table_header_row.create(null, [th('')])
    const rows = collectRows(sliceFrom(onlyHeader))
    expect(rows).toHaveLength(1)
  })

  it('returns an empty array when the slice has no row-typed nodes', () => {
    const para = s.nodes.paragraph.create(null, s.text('not a table'))
    const rows = collectRows(sliceFrom(para))
    expect(rows).toEqual([])
  })
})

describe('isTrivialSingleCell', () => {
  it('detects a single 1x1 row as trivial (so it should pass through as text)', () => {
    expect(isTrivialSingleCell([bodyRow(td('hello'))])).toBe(true)
  })

  it('does not flag multi-cell rows', () => {
    expect(isTrivialSingleCell([bodyRow(td('a'), td('b'))])).toBe(false)
  })

  it('does not flag multi-row pastes', () => {
    expect(
      isTrivialSingleCell([bodyRow(td('a')), bodyRow(td('b'))])
    ).toBe(false)
  })
})

describe('buildStandaloneTable', () => {
  it('promotes the first row to header and pads ragged rows', () => {
    const rows = [
      bodyRow(td('a'), td('b')),
      bodyRow(td('c')),
      bodyRow(td('d'), td('e'), td('f')),
    ]
    const table = buildStandaloneTable(s, rows)
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(3)
    expect(desc.rows[0].kind).toBe('table_header_row')
    expect(desc.rows[0].cells.every((c) => c.kind === 'table_header')).toBe(true)
    // All rows padded to width=3.
    expect(desc.rows.map((r) => r.cells.length)).toEqual([3, 3, 3])
    expect(desc.rows[0].cells.map((c) => c.text)).toEqual(['a', 'b', ''])
    expect(desc.rows[1].cells.map((c) => c.text)).toEqual(['c', '', ''])
    expect(desc.rows[2].cells.map((c) => c.text)).toEqual(['d', 'e', 'f'])
  })

  it('autofills a body row when only a header was provided (GFM requires >=1 body)', () => {
    const rows = [bodyRow(td('only'))]
    const table = buildStandaloneTable(s, rows)
    const desc = describeTable(table)
    expect(desc.rows).toHaveLength(2)
    expect(desc.rows[0].kind).toBe('table_header_row')
    expect(desc.rows[1].kind).toBe('table_row')
    expect(desc.rows[1].cells.map((c) => c.text)).toEqual([''])
  })

  it('returns null when the rows have zero cells', () => {
    const emptyRow = s.nodes.table_row.create(null, [])
    const table = buildStandaloneTable(s, [emptyRow])
    expect(table).toBeNull()
  })
})
