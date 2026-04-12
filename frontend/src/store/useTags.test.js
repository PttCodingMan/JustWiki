import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useTags from './useTags'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from '../api/client'

describe('useTags Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useTags.setState({
        allTags: [],
        pageTags: [],
        loading: false,
      })
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useTags())
    expect(result.current.allTags).toEqual([])
    expect(result.current.pageTags).toEqual([])
  })

  it('should fetch all tags successfully', async () => {
    const mockTags = [{ name: 'tag1', count: 5 }]
    api.get.mockResolvedValueOnce({ data: mockTags })

    const { result } = renderHook(() => useTags())
    
    await act(async () => {
      await result.current.fetchAllTags()
    })

    expect(api.get).toHaveBeenCalledWith('/tags')
    expect(result.current.allTags).toEqual(mockTags)
  })

  it('should fetch page tags successfully', async () => {
    const mockTags = ['tag1', 'tag2']
    api.get.mockResolvedValueOnce({ data: mockTags })

    const { result } = renderHook(() => useTags())
    
    let res
    await act(async () => {
      res = await result.current.fetchPageTags('page-1')
    })

    expect(api.get).toHaveBeenCalledWith('/pages/page-1/tags')
    expect(result.current.pageTags).toEqual(mockTags)
    expect(res).toEqual(mockTags)
  })

  it('should add a tag to a page', async () => {
    const mockTags = ['tag1']
    api.post.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: mockTags })

    const { result } = renderHook(() => useTags())
    
    await act(async () => {
      await result.current.addTag('page-1', 'tag1')
    })

    expect(api.post).toHaveBeenCalledWith('/pages/page-1/tags', { name: 'tag1' })
    expect(api.get).toHaveBeenCalledWith('/pages/page-1/tags')
    expect(result.current.pageTags).toEqual(mockTags)
  })

  it('should remove a tag from a page', async () => {
    api.delete.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: [] })

    const { result } = renderHook(() => useTags())
    
    await act(async () => {
      await result.current.removeTag('page-1', 'tag1')
    })

    expect(api.delete).toHaveBeenCalledWith('/pages/page-1/tags/tag1')
    expect(api.get).toHaveBeenCalledWith('/pages/page-1/tags')
    expect(result.current.pageTags).toEqual([])
  })

  it('should handle URI encoded tag names in removeTag', async () => {
    api.delete.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: [] })

    const { result } = renderHook(() => useTags())
    
    await act(async () => {
      await result.current.removeTag('page-1', 'tag with spaces')
    })

    expect(api.delete).toHaveBeenCalledWith('/pages/page-1/tags/tag%20with%20spaces')
  })
})
