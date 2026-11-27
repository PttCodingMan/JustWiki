// Read-only stand-in for the backend, used by the static demo build
// (VITE_DEMO=true, deployed to GitHub Pages). backend/scripts/build_static_demo.py
// snapshots every read endpoint the guest UI calls into
// `<base>demo-api/<path>.json` as `{ status, data }`; this axios adapter serves
// those files instead of making network calls to an API.
//
// - GET → the snapshot for that path (query params are ignored), 404 if none.
// - /search → filtered client-side over `_search.json`.
// - Anything else → 403, so write paths fail like a viewer's would.
import { AxiosError } from 'axios'

export const IS_DEMO = import.meta.env.VITE_DEMO === 'true'

const BASE = import.meta.env.BASE_URL
const DATA_ROOT = `${BASE}demo-api/`
// Seeded content links media as `/api/media/<file>`. On a project site the
// files live under the base path, so rewrite those links in every response.
const MEDIA_FROM = '/api/media/'
const MEDIA_TO = `${BASE}api/media/`

const cache = new Map()

function rewriteMedia(value) {
  if (MEDIA_FROM === MEDIA_TO) return value
  if (typeof value === 'string') return value.split(MEDIA_FROM).join(MEDIA_TO)
  if (Array.isArray(value)) return value.map(rewriteMedia)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteMedia(v)]))
  }
  return value
}

async function loadJson(file) {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(DATA_ROOT + file).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    )
  }
  return cache.get(file)
}

function pathToFile(path) {
  // Mirror _out_path() in build_static_demo.py: one percent-encoded
  // segment per path component. Encoding the decoded segment twice keeps
  // `%` itself safe for static hosting.
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').map((s) => {
    let decoded = s
    try { decoded = decodeURIComponent(s) } catch { /* keep raw */ }
    return encodeURIComponent(encodeURIComponent(decoded))
  })
  return `${segments.join('/')}.json`
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Same shape as routers/search.make_snippet: text around the first hit,
// HTML-escaped, matches wrapped in <mark>.
function makeSnippet(text, words, maxLen = 200) {
  const lower = text.toLowerCase()
  let pos = -1
  for (const w of words) {
    const i = lower.indexOf(w)
    if (i !== -1 && (pos === -1 || i < pos)) pos = i
  }
  const start = Math.max(0, pos - 50)
  const end = Math.min(text.length, start + maxLen)
  let snippet = escapeHtml(text.slice(start, end))
  for (const w of words) {
    snippet = snippet.replace(new RegExp(escapeRegExp(escapeHtml(w)), 'gi'), (m) => `<mark>${m}</mark>`)
  }
  return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '')
}

async function search(params = {}) {
  const pages = (await loadJson('_search.json')) || []
  const words = String(params.q || '').toLowerCase().split(/\s+/).filter(Boolean)
  const page = Number(params.page) || 1
  const perPage = Number(params.per_page) || 20
  if (!words.length) return { results: [], total: 0, page, per_page: perPage }

  const hits = pages.filter((p) => {
    if (params.tag && !p.tags.includes(params.tag)) return false
    const hay = `${p.title}\n${p.content_md}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  const results = hits.slice((page - 1) * perPage, page * perPage).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    snippet: makeSnippet(p.content_md || '', words),
    updated_at: p.updated_at,
    view_count: p.view_count,
    page_type: p.page_type,
  }))
  return { results, total: hits.length, page, per_page: perPage }
}

function respond(config, status, data) {
  const response = { data, status, statusText: String(status), headers: {}, config, request: {} }
  if (status >= 200 && status < 300) return response
  throw new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    response,
  )
}

export async function demoAdapter(config) {
  const method = (config.method || 'get').toLowerCase()
  const [path, query] = (config.url || '').split('?')
  const params = { ...Object.fromEntries(new URLSearchParams(query || '')), ...(config.params || {}) }

  if (method !== 'get') {
    return respond(config, 403, { detail: 'This is a read-only demo.' })
  }
  if (path === '/search') {
    return respond(config, 200, rewriteMedia(await search(params)))
  }
  const snap = await loadJson(pathToFile(path))
  if (!snap) return respond(config, 404, { detail: 'Not found' })
  return respond(config, snap.status, rewriteMedia(snap.data))
}
