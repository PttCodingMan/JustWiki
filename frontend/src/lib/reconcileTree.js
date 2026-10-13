/**
 * Structural sharing for the page tree.
 *
 * `/api/pages/tree` returns a brand-new object graph on every fetch, so a
 * memoized sidebar would still re-render every node after each save. This
 * walks the fresh tree and reuses the previous node object (and children
 * array) wherever nothing in that subtree changed, keeping identity stable
 * so `React.memo` can skip untouched rows.
 */
function sameScalars(a, b) {
  const ak = Object.keys(a)
  if (ak.length !== Object.keys(b).length) return false
  for (const k of ak) {
    if (k === 'children') continue
    if (a[k] !== b[k]) return false
  }
  return true
}

function reconcileList(prevList, nextList) {
  if (!Array.isArray(prevList) || !Array.isArray(nextList)) return nextList
  const prevById = new Map()
  for (const n of prevList) if (n && n.id != null) prevById.set(n.id, n)
  let samePrev = prevList.length === nextList.length
  let sameNext = true
  const out = nextList.map((n, i) => {
    const r = reconcileNode(prevById.get(n?.id), n)
    if (r !== prevList[i]) samePrev = false
    if (r !== n) sameNext = false
    return r
  })
  if (samePrev) return prevList
  return sameNext ? nextList : out
}

function reconcileNode(prev, next) {
  if (!prev || !next || typeof next !== 'object') return next
  const children = reconcileList(prev.children, next.children)
  if (children === prev.children && sameScalars(prev, next)) return prev
  return children === next.children ? next : { ...next, children }
}

export function reconcileTree(prev, next) {
  return reconcileList(prev, next)
}
