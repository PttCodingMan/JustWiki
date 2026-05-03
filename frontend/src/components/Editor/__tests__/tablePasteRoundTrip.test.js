// Integration test: copy a body-row CellSelection, serialize through the
// same DOM-clipboard round-trip the OS clipboard performs, and verify the
// resulting paste over another body row replaces it (rather than wiping
// the target with the parser's autofilled empty header).
import { describe, it, expect } from 'vitest'
import { DOMSerializer, DOMParser as PMDOMParser, Slice, Fragment } from 'prosemirror-model'
import { CellSelection, handlePaste as pmTableHandlePaste } from 'prosemirror-tables'
import { EditorState } from 'prosemirror-state'
import { __test__ } from '../tablePasteExpand'
import {
  testSchema,
  th,
  td,
  headerRow,
  bodyRow,
  docNode,
  describeTable,
  findTable,
  stateInCell,
} from './tableTestUtils'

const { stripAutofilledHeader } = __test__

const s = testSchema

// Stand-in for view.serializeForClipboard: build the same `<table data-pm-slice>`
// wrapper ProseMirror's clipboard serializer produces, including the slice's
// open depths in the data-pm-slice attribute.
function serializeSlice(slice) {
  const serializer = DOMSerializer.fromSchema(s)
  const fragment = serializer.serializeFragment(slice.content, { document })
  const wrap = document.createElement('div')
  wrap.appendChild(fragment)
  // pm-view wraps a slice with `<table data-pm-slice="openStart openEnd ...">`
  // when the top-level is row content. Replicate the wrapper so the parser
  // round-trip mirrors what the OS clipboard hands back.
  if (
    wrap.firstElementChild &&
    wrap.firstElementChild.tagName === 'TABLE'
  ) {
    wrap.firstElementChild.setAttribute(
      'data-pm-slice',
      `${slice.openStart} ${slice.openEnd} -2 []`
    )
    return wrap.innerHTML
  }
  // Otherwise wrap rows in <table> manually — pm-view does this when the
  // slice's top is below a table boundary.
  const tbl = document.createElement('table')
  tbl.setAttribute('data-pm-slice', `${slice.openStart + 1} ${slice.openEnd + 1} -2 []`)
  const tbody = document.createElement('tbody')
  while (wrap.firstChild) tbody.appendChild(wrap.firstChild)
  tbl.appendChild(tbody)
  return tbl.outerHTML
}

function parseHtmlToSlice(html, schema) {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  const tableEl = wrap.querySelector('table[data-pm-slice]')
  let openStart = 0
  let openEnd = 0
  if (tableEl) {
    const m = tableEl.getAttribute('data-pm-slice').split(/\s+/)
    openStart = parseInt(m[0], 10) || 0
    openEnd = parseInt(m[1], 10) || 0
  }
  const parser = PMDOMParser.fromSchema(schema)
  const slice = parser.parseSlice(wrap, { preserveWhitespace: true })
  // The parser returns its own openStart/openEnd; trust those over the
  // attribute (parser may adjust based on schema fitting).
  return new Slice(slice.content, slice.openStart || openStart, slice.openEnd || openEnd)
}

function buildTableDoc() {
  return docNode(
    s.nodes.table.create(null, [
      headerRow(th('Z1'), th('< 143 bpm'), th('熱身')),
      bodyRow(td('Z2'), td('143 - 155'), td('有氧基礎')),
      bodyRow(td('Z3'), td('155 - 168'), td('節奏跑')),
      bodyRow(td('Z4'), td('168 - 180'), td('閾值')),
    ])
  )
}

describe('table row copy/paste round-trip', () => {
  it('reproduces the bug: parser auto-fills an empty header_row in the slice', () => {
    const doc = buildTableDoc()
    // Z3 is row index 2; build a row CellSelection on it.
    const z3State = stateInCell(doc, 2, 0)
    const tableInfo = findTable(z3State.doc)
    let z3RowStart = tableInfo.pos + 1
    for (let i = 0; i < 2; i += 1) z3RowStart += tableInfo.node.child(i).nodeSize
    const z3 = tableInfo.node.child(2)
    const firstCell = z3RowStart + 1
    let lastCell = z3RowStart + 1
    for (let i = 0; i < z3.childCount - 1; i += 1) lastCell += z3.child(i).nodeSize
    const cellSel = CellSelection.create(z3State.doc, firstCell, lastCell)
    const slice = cellSel.content()

    const html = serializeSlice(slice)
    const reparsed = parseHtmlToSlice(html, s)

    // Walk the table wrapper to inspect what came out of the parser.
    let inner = reparsed.content
    while (inner.childCount === 1 && inner.child(0).type.spec.tableRole === 'table') {
      inner = inner.child(0).content
    }
    const rowKinds = []
    inner.forEach((r) => rowKinds.push(r.type.name))
    expect(rowKinds.length).toBeGreaterThanOrEqual(2)
    expect(rowKinds[0]).toBe('table_header_row')

    // And that auto-filled header is empty — that is what wipes Z4 if we
    // hand the slice straight to pmTableHandlePaste.
    const firstRow = inner.child(0)
    let headerHasText = false
    firstRow.forEach((c) => { if (c.textContent.trim()) headerHasText = true })
    expect(headerHasText).toBe(false)
  })

  it('stripAutofilledHeader removes the empty leading header from a round-tripped slice', () => {
    const doc = buildTableDoc()
    let tableStart = 1 // table sits at doc pos 0, content starts at 1
    let z3RowStart = tableStart
    const tableNode = doc.nodeAt(0)
    for (let i = 0; i < 2; i += 1) z3RowStart += tableNode.child(i).nodeSize
    const z3 = tableNode.child(2)
    const firstCell = z3RowStart + 1
    let lastCell = z3RowStart + 1
    for (let i = 0; i < z3.childCount - 1; i += 1) lastCell += z3.child(i).nodeSize
    const cellSel = CellSelection.create(doc, firstCell, lastCell)
    const slice = cellSel.content()

    const html = serializeSlice(slice)
    const reparsed = parseHtmlToSlice(html, s)
    const fixed = stripAutofilledHeader(reparsed)

    let inner = fixed.content
    while (inner.childCount === 1 && inner.child(0).type.spec.tableRole === 'table') {
      inner = inner.child(0).content
    }
    const rowKinds = []
    inner.forEach((r) => rowKinds.push(r.type.name))
    // Only the body row should remain.
    expect(rowKinds).toEqual(['table_row'])
    // And it should carry the original content.
    const cellTexts = []
    inner.child(0).forEach((c) => cellTexts.push(c.textContent))
    expect(cellTexts).toEqual(['Z3', '155 - 168', '節奏跑'])
  })

  it('end-to-end: round-tripped Z3 row replaces Z4 row via pmTableHandlePaste after fix', () => {
    const doc = buildTableDoc()
    const tableNode = doc.nodeAt(0)
    let z3RowStart = 1
    for (let i = 0; i < 2; i += 1) z3RowStart += tableNode.child(i).nodeSize
    const z3 = tableNode.child(2)
    const firstZ3Cell = z3RowStart + 1
    let lastZ3Cell = z3RowStart + 1
    for (let i = 0; i < z3.childCount - 1; i += 1) lastZ3Cell += z3.child(i).nodeSize
    const z3Sel = CellSelection.create(doc, firstZ3Cell, lastZ3Cell)
    const z3Slice = z3Sel.content()

    // Round-trip via DOM clipboard
    const html = serializeSlice(z3Slice)
    const reparsed = parseHtmlToSlice(html, s)
    const fixedSlice = stripAutofilledHeader(reparsed)

    // Now build state with Z4 row CellSelection and dispatch the paste.
    const z4RowStart = z3RowStart + z3.nodeSize
    const z4 = tableNode.child(3)
    const firstZ4Cell = z4RowStart + 1
    let lastZ4Cell = z4RowStart + 1
    for (let i = 0; i < z4.childCount - 1; i += 1) lastZ4Cell += z4.child(i).nodeSize

    const z4State = EditorState.create({
      doc,
      schema: s,
      selection: CellSelection.create(doc, firstZ4Cell, lastZ4Cell),
    })

    // pmTableHandlePaste needs a view-like — accept (state, dispatch).
    const fakeView = {
      state: z4State,
      dispatch(tr) { fakeView._tr = tr },
    }
    const handled = pmTableHandlePaste(fakeView, {}, fixedSlice)
    expect(handled).toBe(true)
    expect(fakeView._tr).toBeTruthy()

    const after = z4State.apply(fakeView._tr).doc
    const tbl = findTable(after).node
    const desc = describeTable(tbl)
    expect(desc.rows).toHaveLength(4) // no row growth
    expect(desc.rows[3].cells.map((c) => c.text)).toEqual(['Z3', '155 - 168', '節奏跑'])
  })
})
