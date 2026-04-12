import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useAuth from './useAuth'

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

  it('should clear user on 401 response', async () => {
    client.get.mockRejectedValueOnce({ response: { status: 401 } })

    const { result } = renderHook(() => useAuth())
    
    await act(async () => {
      await result.current.checkAuth()
    })

    expect(result.current.user).toBe(null)
    expect(result.current.isAuthenticated).toBe(false)
  })
})
