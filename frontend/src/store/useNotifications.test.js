import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useNotifications from './useNotifications'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../api/client'

describe('useNotifications store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useNotifications.setState({ items: [], unreadCount: 0, loading: false })
    })
  })

  it('fetches notifications and populates store', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: 1, event: 'page.updated', page_slug: 'foo', read_at: null, created_at: '2026-01-01' },
          { id: 2, event: 'page.created', page_slug: 'bar', read_at: '2026-01-01', created_at: '2026-01-01' },
        ],
        unread_count: 1,
      },
    })

    const { result } = renderHook(() => useNotifications())

    await act(async () => {
      await result.current.fetchNotifications()
    })

    expect(api.get).toHaveBeenCalledWith('/notifications', { params: { unread_only: false } })
    expect(result.current.items.length).toBe(2)
    expect(result.current.unreadCount).toBe(1)
  })

  it('fetch with unread_only passes the param through', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [], unread_count: 0 } })
    const { result } = renderHook(() => useNotifications())
    await act(async () => {
      await result.current.fetchNotifications(true)
    })
    expect(api.get).toHaveBeenCalledWith('/notifications', { params: { unread_only: true } })
  })

  it('markAllRead clears unread count locally', async () => {
    act(() => {
      useNotifications.setState({
        items: [
          { id: 1, read_at: null, created_at: '2026-01-01' },
          { id: 2, read_at: null, created_at: '2026-01-01' },
        ],
        unreadCount: 2,
      })
    })
    api.post.mockResolvedValueOnce({})

    const { result } = renderHook(() => useNotifications())
    await act(async () => {
      await result.current.markAllRead()
    })

    expect(api.post).toHaveBeenCalledWith('/notifications/read-all')
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.items.every((n) => n.read_at)).toBe(true)
  })

  it('markRead decrements unread count by one', async () => {
    act(() => {
      useNotifications.setState({
        items: [
          { id: 1, read_at: null, created_at: '2026-01-01' },
          { id: 2, read_at: null, created_at: '2026-01-01' },
        ],
        unreadCount: 2,
      })
    })
    api.post.mockResolvedValueOnce({})

    const { result } = renderHook(() => useNotifications())
    await act(async () => {
      await result.current.markRead(1)
    })

    expect(api.post).toHaveBeenCalledWith('/notifications/1/read')
    expect(result.current.unreadCount).toBe(1)
    expect(result.current.items.find((n) => n.id === 1).read_at).toBeTruthy()
    expect(result.current.items.find((n) => n.id === 2).read_at).toBeFalsy()
  })

  it('markRead on an already-read notification is a no-op for unreadCount', async () => {
    act(() => {
      useNotifications.setState({
        items: [{ id: 1, read_at: '2026-01-01', created_at: '2026-01-01' }],
        unreadCount: 0,
      })
    })
    api.post.mockResolvedValueOnce({})

    const { result } = renderHook(() => useNotifications())
    await act(async () => {
      await result.current.markRead(1)
    })

    expect(result.current.unreadCount).toBe(0)
  })
})
