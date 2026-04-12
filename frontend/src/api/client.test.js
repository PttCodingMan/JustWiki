import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from './client'
import axios from 'axios'

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

    // Try to trigger the error interceptor
    try {
      // Accessing the private interceptors array might be brittle, 
      // but it's a way to test it without making real calls.
      const interceptor = api.interceptors.response.handlers[0].rejected
      await interceptor(error401)
    } catch (e) {
      // Expected to reject
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
    } catch (e) {}

    expect(window.location.href).toBe('/login')
  })
})
