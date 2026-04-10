import { create } from 'zustand'
import api from '../api/client'

const useBookmarks = create((set) => ({
  bookmarks: [],
  loading: false,

  fetchBookmarks: async () => {
    set({ loading: true })
    try {
      const res = await api.get('/bookmarks')
      set({ bookmarks: res.data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addBookmark: async (slug) => {
    await api.post(`/bookmarks/${slug}`)
    // Refresh
    const res = await api.get('/bookmarks')
    set({ bookmarks: res.data })
  },

  removeBookmark: async (slug) => {
    await api.delete(`/bookmarks/${slug}`)
    const res = await api.get('/bookmarks')
    set({ bookmarks: res.data })
  },

  checkBookmark: async (slug) => {
    try {
      const res = await api.get(`/bookmarks/check/${slug}`)
      return res.data.bookmarked
    } catch {
      return false
    }
  },
}))

export default useBookmarks
