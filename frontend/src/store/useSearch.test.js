import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useSearch from './useSearch'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from '../api/client'

describe('useSearch Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useSearch.setState({
        results: [],
        total: 0,
        loading: false,
        query: '',
      })
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSearch())
    expect(result.current.results).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.query).toBe('')
  })

  it('should search successfully', async () => {
    const mockRes = {
      data: {
        results: [{ id: 1, title: 'Result 1' }],
        total: 1
      }
    }
    api.get.mockResolvedValueOnce(mockRes)

    const { result } = renderHook(() => useSearch())
    
    let res
    await act(async () => {
      res = await result.current.search('test')
    })

    expect(api.get).toHaveBeenCalledWith('/search', { params: { q: 'test', page: 1, per_page: 20 } })
    expect(result.current.results).toEqual(mockRes.data.results)
    expect(result.current.total).toBe(1)
    expect(result.current.query).toBe('test')
    expect(res).toEqual(mockRes.data)
  })

  it('should search with tag successfully', async () => {
    const mockRes = { data: { results: [], total: 0 } }
    api.get.mockResolvedValueOnce(mockRes)

    const { result } = renderHook(() => useSearch())
    
    await act(async () => {
      await result.current.search('test', 'tag1')
    })

    expect(api.get).toHaveBeenCalledWith('/search', { params: { q: 'test', page: 1, per_page: 20, tag: 'tag1' } })
  })

  it('should handle search failure', async () => {
    api.get.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useSearch())
    
    let res
    await act(async () => {
      res = await result.current.search('test')
    })

    expect(result.current.results).toEqual([])
    expect(result.current.total).toBe(0)
    expect(res).toEqual({ results: [], total: 0 })
  })

  it('should clear search results', () => {
    act(() => {
      useSearch.setState({ results: [{ id: 1 }], total: 1, query: 'test' })
    })

    const { result } = renderHook(() => useSearch())
    
    act(() => {
      result.current.clearSearch()
    })

    expect(result.current.results).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.query).toBe('')
  })
})
