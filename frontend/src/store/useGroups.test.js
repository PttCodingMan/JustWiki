import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useGroups from './useGroups'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import client from '../api/client'

describe('useGroups store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useGroups.setState({ groups: [], loading: false, membersByGroup: {} })
  })

  it('fetchGroups populates the groups list', async () => {
    client.get.mockResolvedValueOnce({ data: [{ id: 1, name: 'eng', member_count: 0 }] })
    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.fetchGroups()
    })

    expect(client.get).toHaveBeenCalledWith('/groups')
    expect(result.current.groups).toHaveLength(1)
    expect(result.current.groups[0].name).toBe('eng')
  })

  it('createGroup POSTs and refreshes the list', async () => {
    client.post.mockResolvedValueOnce({ data: { id: 5, name: 'new' } })
    client.get.mockResolvedValueOnce({ data: [{ id: 5, name: 'new', member_count: 0 }] })
    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.createGroup('new', 'desc')
    })

    expect(client.post).toHaveBeenCalledWith('/groups', { name: 'new', description: 'desc' })
    expect(result.current.groups).toHaveLength(1)
  })

  it('deleteGroup purges cached membership', async () => {
    useGroups.setState({
      groups: [{ id: 2, name: 'doomed' }],
      membersByGroup: { 2: [{ id: 10 }] },
    })
    client.delete.mockResolvedValueOnce({})
    client.get.mockResolvedValueOnce({ data: [] })

    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.deleteGroup(2)
    })

    expect(client.delete).toHaveBeenCalledWith('/groups/2')
    expect(result.current.membersByGroup[2]).toBeUndefined()
  })

  it('fetchMembers stores results keyed by group id', async () => {
    client.get.mockResolvedValueOnce({ data: [{ id: 7, username: 'alice' }] })
    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.fetchMembers(3)
    })

    expect(client.get).toHaveBeenCalledWith('/groups/3/members')
    expect(result.current.membersByGroup[3]).toEqual([{ id: 7, username: 'alice' }])
  })

  it('addMember posts and then refreshes members', async () => {
    client.post.mockResolvedValueOnce({})
    client.get.mockResolvedValueOnce({ data: [{ id: 9 }] })
    const { result } = renderHook(() => useGroups())

    await act(async () => {
      await result.current.addMember(4, 9)
    })

    expect(client.post).toHaveBeenCalledWith('/groups/4/members', { user_id: 9 })
    expect(result.current.membersByGroup[4]).toEqual([{ id: 9 }])
  })
})
