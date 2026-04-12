import { create } from 'zustand'
import api from '../api/client'

const useNotifications = create((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,

  fetchNotifications: async (unreadOnly = false) => {
    set({ loading: true })
    try {
      const res = await api.get('/notifications', { params: { unread_only: unreadOnly } })
      set({
        items: res.data.items || [],
        unreadCount: res.data.unread_count || 0,
        loading: false,
      })
      return res.data
    } catch {
      set({ loading: false })
    }
  },

  markAllRead: async () => {
    await api.post('/notifications/read-all')
    const items = get().items.map((n) => ({
      ...n,
      read_at: n.read_at || new Date().toISOString(),
    }))
    set({ items, unreadCount: 0 })
  },

  markRead: async (id) => {
    await api.post(`/notifications/${id}/read`)
    const items = get().items.map((n) =>
      n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
    )
    const unreadCount = items.filter((n) => !n.read_at).length
    set({ items, unreadCount })
  },
}))

export default useNotifications
