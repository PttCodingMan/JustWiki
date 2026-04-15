import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import usePermissions, { canEdit, canManageAcl, canRead } from './usePermissions'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
  },
}))

import client from '../api/client'

describe('usePermissions store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the store between tests
    const { result } = renderHook(() => usePermissions())
    act(() => {
      result.current.invalidate()
    })
  })

  it('seed stores permission for a slug', () => {
    const { result } = renderHook(() => usePermissions())
    act(() => {
      result.current.seed('page-a', 'write')
    })
    expect(result.current.cache['page-a']).toBe('write')
  })

  it('seed ignores falsy values', () => {
    const { result } = renderHook(() => usePermissions())
    act(() => {
      result.current.seed('page-b', null)
      result.current.seed('page-c', undefined)
    })
    expect(result.current.cache['page-b']).toBeUndefined()
    expect(result.current.cache['page-c']).toBeUndefined()
  })

  it('fetch returns cached value without calling the API', async () => {
    const { result } = renderHook(() => usePermissions())
    act(() => {
      result.current.seed('cached-page', 'read')
    })

    await act(async () => {
      const perm = await result.current.fetch('cached-page')
      expect(perm).toBe('read')
    })
    expect(client.get).not.toHaveBeenCalled()
  })

  it('fetch hits /my-permission on cache miss', async () => {
    client.get.mockResolvedValueOnce({ data: { permission: 'write' } })
    const { result } = renderHook(() => usePermissions())

    await act(async () => {
      const perm = await result.current.fetch('fresh-page')
      expect(perm).toBe('write')
    })
    expect(client.get).toHaveBeenCalledWith('/pages/fresh-page/my-permission')
    expect(result.current.cache['fresh-page']).toBe('write')
  })

  it('invalidate removes a single slug', () => {
    const { result } = renderHook(() => usePermissions())
    act(() => {
      result.current.seed('a', 'read')
      result.current.seed('b', 'write')
      result.current.invalidate('a')
    })
    expect(result.current.cache['a']).toBeUndefined()
    expect(result.current.cache['b']).toBe('write')
  })
})

describe('permission helpers', () => {
  it('canEdit: viewers never pass', () => {
    expect(canEdit('write', 'viewer')).toBe(false)
    expect(canEdit('admin', 'viewer')).toBe(false)
  })

  it('canEdit: editors need write-or-admin', () => {
    expect(canEdit('write', 'editor')).toBe(true)
    expect(canEdit('admin', 'editor')).toBe(true)
    expect(canEdit('read', 'editor')).toBe(false)
    expect(canEdit('none', 'editor')).toBe(false)
  })

  it('canManageAcl: matches canEdit in v1', () => {
    expect(canManageAcl('write', 'editor')).toBe(true)
    expect(canManageAcl('read', 'editor')).toBe(false)
    expect(canManageAcl('write', 'viewer')).toBe(false)
  })

  it('canRead: anything non-none is truthy', () => {
    expect(canRead('read')).toBeTruthy()
    expect(canRead('write')).toBeTruthy()
    expect(canRead('admin')).toBeTruthy()
    expect(canRead('none')).toBeFalsy()
    expect(canRead(null)).toBeFalsy()
    expect(canRead(undefined)).toBeFalsy()
  })
})
