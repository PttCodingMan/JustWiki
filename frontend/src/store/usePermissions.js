import { create } from 'zustand'
import api from '../api/client'

// Cache keyed by slug. Seeded from `effective_permission` on page-view
// responses so the common path doesn't need a round-trip; falls back to
// /api/pages/{slug}/my-permission when the cache is cold.
//
// Permission values: 'admin' | 'write' | 'read' | 'none'.
const usePermissions = create((set, get) => ({
  cache: {},

  seed: (slug, permission) => {
    if (!slug || !permission) return
    set((state) => ({ cache: { ...state.cache, [slug]: permission } }))
  },

  fetch: async (slug) => {
    if (!slug) return null
    const cached = get().cache[slug]
    if (cached) return cached
    try {
      const res = await api.get(`/pages/${slug}/my-permission`)
      const perm = res.data?.permission || null
      if (perm) {
        set((state) => ({ cache: { ...state.cache, [slug]: perm } }))
      }
      return perm
    } catch {
      return null
    }
  },

  invalidate: (slug) => {
    if (!slug) {
      set({ cache: {} })
      return
    }
    set((state) => {
      const next = { ...state.cache }
      delete next[slug]
      return { cache: next }
    })
  },
}))

// Pure helpers — safe to call from render without hooks (permission is
// passed in from useState-stored page data).

export function canEdit(permission, role) {
  if (role === 'viewer') return false
  return permission === 'admin' || permission === 'write'
}

export function canManageAcl(permission, role) {
  if (role === 'viewer') return false
  return permission === 'admin' || permission === 'write'
}

export function canRead(permission) {
  return permission && permission !== 'none'
}

export default usePermissions
