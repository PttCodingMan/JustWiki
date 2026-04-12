import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import usePages from './usePages'

// Mock the API client
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}))

import api from '../api/client'

describe('usePages Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      usePages.setState({
        pages: [],
        tree: [],
        total: 0,
        loading: false,
      })
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => usePages())
    expect(result.current.pages).toEqual([])
    expect(result.current.tree).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('should fetch pages successfully', async () => {
    const mockRes = {
      data: {
        pages: [{ id: 1, title: 'Page 1', slug: 'page-1' }],
        total: 1
      }
    }
    api.get.mockResolvedValueOnce(mockRes)

    const { result } = renderHook(() => usePages())
    
    await act(async () => {
      await result.current.fetchPages(1, 10)
    })

    expect(api.get).toHaveBeenCalledWith('/pages', { params: { page: 1, per_page: 10 } })
    expect(result.current.pages).toEqual(mockRes.data.pages)
    expect(result.current.total).toBe(1)
    expect(result.current.loading).toBe(false)
  })

  it('should fetch tree successfully', async () => {
    const mockTree = [{ id: 1, title: 'Root', children: [] }]
    api.get.mockResolvedValueOnce({ data: mockTree })

    const { result } = renderHook(() => usePages())
    
    await act(async () => {
      await result.current.fetchTree()
    })

    expect(api.get).toHaveBeenCalledWith('/pages/tree')
    expect(result.current.tree).toEqual(mockTree)
  })

  it('should get a single page', async () => {
    const mockPage = { id: 1, title: 'Page 1', slug: 'page-1' }
    api.get.mockResolvedValueOnce({ data: mockPage })

    const { result } = renderHook(() => usePages())
    
    let page
    await act(async () => {
      page = await result.current.getPage('page-1')
    })

    expect(api.get).toHaveBeenCalledWith('/pages/page-1')
    expect(page).toEqual(mockPage)
  })

  it('should create a page', async () => {
    const mockPage = { id: 1, title: 'New Page', slug: 'new-page' }
    api.post.mockResolvedValueOnce({ data: mockPage })

    const { result } = renderHook(() => usePages())
    
    let res
    await act(async () => {
      res = await result.current.createPage({ title: 'New Page' })
    })

    expect(api.post).toHaveBeenCalledWith('/pages', { title: 'New Page' })
    expect(res).toEqual(mockPage)
  })

  it('should update a page', async () => {
    const mockPage = { id: 1, title: 'Updated Page', slug: 'page-1' }
    api.put.mockResolvedValueOnce({ data: mockPage })

    const { result } = renderHook(() => usePages())
    
    let res
    await act(async () => {
      res = await result.current.updatePage('page-1', { title: 'Updated Page' })
    })

    expect(api.put).toHaveBeenCalledWith('/pages/page-1', { title: 'Updated Page' })
    expect(res).toEqual(mockPage)
  })

  it('should delete a page', async () => {
    api.delete.mockResolvedValueOnce({})

    const { result } = renderHook(() => usePages())
    
    await act(async () => {
      await result.current.deletePage('page-1')
    })

    expect(api.delete).toHaveBeenCalledWith('/pages/page-1')
  })

  it('should move a page and refresh tree', async () => {
    const mockTree = [{ id: 1, title: 'Root', children: [] }]
    api.patch.mockResolvedValueOnce({})
    api.get.mockResolvedValueOnce({ data: mockTree })

    const { result } = renderHook(() => usePages())
    
    await act(async () => {
      await result.current.movePage('page-1', 1, 0)
    })

    expect(api.patch).toHaveBeenCalledWith('/pages/page-1/move', { parent_id: 1, sort_order: 0 })
    expect(api.get).toHaveBeenCalledWith('/pages/tree')
    expect(result.current.tree).toEqual(mockTree)
  })
})
