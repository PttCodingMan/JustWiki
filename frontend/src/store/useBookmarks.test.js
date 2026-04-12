import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useBookmarks from './useBookmarks'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from '../api/client'

describe('useBookmarks Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useBookmarks.setState({
        bookmarks: [],
        loading: false,
      })
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useBookmarks())
    expect(result.current.bookmarks).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('should fetch bookmarks successfully', async () => {
    const mockBookmarks = [{ id: 1, title: 'Test Page', slug: 'test-page' }]
    api.get.mockResolvedValueOnce({ data: mockBookmarks })

    const { result } = renderHook(() => useBookmarks())
    
    await act(async () => {
      await result.current.fetchBookmarks()
    })

    expect(api.get).toHaveBeenCalledWith('/bookmarks')
    expect(result.current.bookmarks).toEqual(mockBookmarks)
    expect(result.current.loading).toBe(false)
  })

  it('should add a bookmark and refresh the list', async () => {
    const mockBookmarks = [{ id: 1, title: 'Test Page', slug: 'test-page' }]
    api.post.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: mockBookmarks })

    const { result } = renderHook(() => useBookmarks())
    
    await act(async () => {
      await result.current.addBookmark('test-page')
    })

    expect(api.post).toHaveBeenCalledWith('/bookmarks/test-page')
    expect(api.get).toHaveBeenCalledWith('/bookmarks')
    expect(result.current.bookmarks).toEqual(mockBookmarks)
  })

  it('should remove a bookmark and refresh the list', async () => {
    api.delete.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: [] })

    const { result } = renderHook(() => useBookmarks())
    
    await act(async () => {
      await result.current.removeBookmark('test-page')
    })

    expect(api.delete).toHaveBeenCalledWith('/bookmarks/test-page')
    expect(api.get).toHaveBeenCalledWith('/bookmarks')
    expect(result.current.bookmarks).toEqual([])
  })

  it('should check if a page is bookmarked', async () => {
    api.get.mockResolvedValueOnce({ data: { bookmarked: true } })

    const { result } = renderHook(() => useBookmarks())
    
    let isBookmarked
    await act(async () => {
      isBookmarked = await result.current.checkBookmark('test-page')
    })

    expect(api.get).toHaveBeenCalledWith('/bookmarks/check/test-page')
    expect(isBookmarked).toBe(true)
  })

  it('should return false if checkBookmark fails', async () => {
    api.get.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useBookmarks())
    
    let isBookmarked
    await act(async () => {
      isBookmarked = await result.current.checkBookmark('test-page')
    })

    expect(isBookmarked).toBe(false)
  })
})
