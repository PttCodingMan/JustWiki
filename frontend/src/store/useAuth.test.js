import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useAuth from './useAuth'
import useSettings from './useSettings'
import { isGuestMode } from '../lib/authState'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}))

import client from '../api/client'

describe('useAuth Store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset Zustand store state before each test
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.logout()
    })
  })

  it('should initialize with null user and not authenticated', async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      // just wait for potential async init
    })
    expect(result.current.user).toBe(null)
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('should set user and authenticated on successful check', async () => {
    const mockUser = { id: 1, username: 'admin', role: 'admin' }
    client.get.mockResolvedValueOnce({ data: mockUser })

    const { result } = renderHook(() => useAuth())
    
    await act(async () => {
      await result.current.checkAuth()
    })

    expect(result.current.user).toEqual(mockUser)
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('should clear user on 401 response when anonymous_read is off', async () => {
    // First /auth/me 401 → triggers settings.fetch → returns flag off.
    client.get.mockRejectedValueOnce({ response: { status: 401 } })
    client.get.mockResolvedValueOnce({ data: { anonymous_read: false } })
    useSettings.setState({ loaded: false, anonymous_read: false })

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.checkAuth()
    })

    expect(result.current.user).toBe(null)
    expect(result.current.isAuthenticated).toBe(false)
    expect(isGuestMode()).toBe(false)
  })

  it('should fall back to guest user on 401 when anonymous_read is on', async () => {
    client.get.mockRejectedValueOnce({ response: { status: 401 } })
    // /api/settings response inside settings.fetch → flag is on.
    client.get.mockResolvedValueOnce({
      data: { site_name: 'Demo', anonymous_read: true },
    })
    useSettings.setState({ loaded: false, anonymous_read: false })

    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.checkAuth()
    })

    expect(result.current.user).toMatchObject({
      anonymous: true,
      role: 'viewer',
      username: 'guest',
    })
    // isAuthenticated stays false so anything that gates on a real session
    // (CSRF-y operations, AI chat, profile edit) treats guest as logged-out.
    expect(result.current.isAuthenticated).toBe(false)
    expect(isGuestMode()).toBe(true)
  })

  it('should clear guest mode after a real login', async () => {
    // Start in guest mode.
    client.get.mockRejectedValueOnce({ response: { status: 401 } })
    client.get.mockResolvedValueOnce({ data: { anonymous_read: true } })
    useSettings.setState({ loaded: false, anonymous_read: false })
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.checkAuth() })
    expect(isGuestMode()).toBe(true)

    // Now log in for real.
    client.post.mockResolvedValueOnce({
      data: { user: { id: 1, username: 'real', role: 'editor' } },
    })
    await act(async () => {
      await result.current.login('real', 'pw')
    })

    expect(result.current.user).toEqual({ id: 1, username: 'real', role: 'editor' })
    expect(result.current.isAuthenticated).toBe(true)
    expect(isGuestMode()).toBe(false)
  })
})
