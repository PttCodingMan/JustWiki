import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import api from './client'

describe('API Client', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    delete window.location
    window.location = { ...originalLocation, href: '', pathname: '/' }
  })

  afterAll(() => {
    window.location = originalLocation
  })

  it('has correct baseURL', () => {
    expect(api.defaults.baseURL).toBe('/api')
  })

  it('has withCredentials enabled', () => {
    expect(api.defaults.withCredentials).toBe(true)
  })

  it('redirects to /login on 401 response', async () => {
    // We can't easily trigger the interceptor without a real request,
    // but we can mock the behavior of axios or use the interceptors directly.
    
    const error401 = {
      response: {
        status: 401
      }
    }

    try {
      const interceptor = api.interceptors.response.handlers[0].rejected
      await interceptor(error401)
    } catch {
      // expected: interceptor rejects after redirect
    }

    expect(window.location.href).toBe('/login')
  })

  it('does not redirect on 401 if already on /login', async () => {
    window.location.pathname = '/login'
    window.location.href = '/login'

    const error401 = {
      response: {
        status: 401
      }
    }

    try {
      const interceptor = api.interceptors.response.handlers[0].rejected
      await interceptor(error401)
    } catch {
      // expected: interceptor rejects without redirect
    }

    expect(window.location.href).toBe('/login')
  })

  // Regression: anonymous visitors on /public/page/:slug must not be bounced
  // to /login when the eager checkAuth() call at app boot returns 401.
  // https://… (to-do.md Phase 3 manual verification caught this before shipping)
  it.each([
    '/public/page/some-slug',
    '/public/page/deeply/nested',
  ])('does not redirect on 401 when path is %s', async (pathname) => {
    window.location.pathname = pathname
    window.location.href = pathname

    const error401 = { response: { status: 401 } }

    try {
      const interceptor = api.interceptors.response.handlers[0].rejected
      await interceptor(error401)
    } catch {
      // expected: interceptor rejects without redirect
    }

    // href must stay at the public URL — no hard redirect to /login
    expect(window.location.href).toBe(pathname)
  })

  // Regression: the boot-time /auth/me probe must never hard-redirect, even
  // from non-public paths. This is what lets anonymous visitors land on the
  // unified /page/:slug route and see a publicly-shared page.
  it('does not redirect when the failing request is /auth/me', async () => {
    window.location.pathname = '/page/some-slug'
    window.location.href = '/page/some-slug'

    const error401 = {
      response: { status: 401 },
      config: { url: '/auth/me' },
    }

    try {
      const interceptor = api.interceptors.response.handlers[0].rejected
      await interceptor(error401)
    } catch {
      // expected: interceptor still rejects after skipping redirect
    }

    expect(window.location.href).toBe('/page/some-slug')
  })
})
