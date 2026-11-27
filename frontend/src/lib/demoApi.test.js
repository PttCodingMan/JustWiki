import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { demoAdapter } from './demoApi'

const FILES = {
  '/demo-api/pages/tree.json': { status: 200, data: [{ slug: 'abc', title: 'Home', children: [] }] },
  '/demo-api/auth/me.json': { status: 401, data: { detail: 'Not authenticated' } },
  '/demo-api/pages/abc.json': { status: 200, data: { slug: 'abc', content_md: '![x](/api/media/logo.png)' } },
  '/demo-api/_search.json': [
    { id: 1, slug: 'abc', title: 'Deploy guide', content_md: 'Run <kubectl> rollout', tags: ['ops'], page_type: 'document' },
    { id: 2, slug: 'def', title: 'Notes', content_md: 'nothing here', tags: [], page_type: 'document' },
  ],
}

describe('demoAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const body = FILES[url]
      return { ok: body !== undefined, json: async () => body }
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('serves a snapshot for a GET path, ignoring query params', async () => {
    const res = await demoAdapter({ method: 'get', url: '/pages/tree', params: { x: 1 } })
    expect(res.status).toBe(200)
    expect(res.data[0].slug).toBe('abc')
  })

  it('replays a recorded error status', async () => {
    await expect(demoAdapter({ method: 'get', url: '/auth/me' }))
      .rejects.toMatchObject({ response: { status: 401 } })
  })

  it('404s for a path that was never snapshotted', async () => {
    await expect(demoAdapter({ method: 'get', url: '/pages/missing' }))
      .rejects.toMatchObject({ response: { status: 404 } })
  })

  it('rejects writes as read-only', async () => {
    await expect(demoAdapter({ method: 'post', url: '/pages', data: '{}' }))
      .rejects.toMatchObject({ response: { status: 403 } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('searches client-side with escaped, highlighted snippets and tag filter', async () => {
    const res = await demoAdapter({ method: 'get', url: '/search', params: { q: 'kubectl' } })
    expect(res.data.total).toBe(1)
    expect(res.data.results[0].slug).toBe('abc')
    expect(res.data.results[0].snippet).toContain('&lt;<mark>kubectl</mark>&gt;')

    const tagged = await demoAdapter({ method: 'get', url: '/search', params: { q: 'notes', tag: 'ops' } })
    expect(tagged.data.total).toBe(0)
  })
})
