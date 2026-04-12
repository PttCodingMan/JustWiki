import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useActivity from './useActivity'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '../api/client'

describe('useActivity Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const { result } = renderHook(() => useActivity())
    act(() => {
      // Reset state
      useActivity.setState({
        activities: [],
        stats: null,
        statsLoaded: false,
        total: 0,
        loading: false,
      })
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useActivity())
    expect(result.current.activities).toEqual([])
    expect(result.current.stats).toBe(null)
    expect(result.current.statsLoaded).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('should fetch activities successfully', async () => {
    const mockRes = {
      data: {
        activities: [{ id: 1, action: 'edit' }],
        total: 1
      }
    }
    api.get.mockResolvedValueOnce(mockRes)

    const { result } = renderHook(() => useActivity())
    
    await act(async () => {
      await result.current.fetchActivity(1, 10)
    })

    expect(api.get).toHaveBeenCalledWith('/activity', { params: { page: 1, per_page: 10 } })
    expect(result.current.activities).toEqual(mockRes.data.activities)
    expect(result.current.total).toBe(1)
    expect(result.current.loading).toBe(false)
  })

  it('should handle fetch activity failure', async () => {
    api.get.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useActivity())
    
    await act(async () => {
      await result.current.fetchActivity()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.activities).toEqual([])
  })

  it('should fetch stats successfully', async () => {
    const mockStats = { views: 100, edits: 10 }
    api.get.mockResolvedValueOnce({ data: mockStats })

    const { result } = renderHook(() => useActivity())
    
    let res
    await act(async () => {
      res = await result.current.fetchStats()
    })

    expect(api.get).toHaveBeenCalledWith('/activity/stats')
    expect(result.current.stats).toEqual(mockStats)
    expect(result.current.statsLoaded).toBe(true)
    expect(res).toEqual(mockStats)
  })

  it('should not fetch stats if already loaded unless forced', async () => {
    const mockStats = { views: 100 }
    act(() => {
      useActivity.setState({ stats: mockStats, statsLoaded: true })
    })

    const { result } = renderHook(() => useActivity())
    
    await act(async () => {
      await result.current.fetchStats()
    })

    expect(api.get).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.fetchStats(true)
    })

    expect(api.get).toHaveBeenCalled()
  })
})
