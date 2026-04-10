import { create } from 'zustand'
import api from '../api/client'

const useTags = create((set) => ({
  allTags: [],
  pageTags: [],
  loading: false,

  fetchAllTags: async () => {
    try {
      const res = await api.get('/tags')
      set({ allTags: res.data })
    } catch {
      // ignore
    }
  },

  fetchPageTags: async (slug) => {
    try {
      const res = await api.get(`/pages/${slug}/tags`)
      set({ pageTags: res.data })
      return res.data
    } catch {
      set({ pageTags: [] })
      return []
    }
  },

  addTag: async (slug, name) => {
    await api.post(`/pages/${slug}/tags`, { name })
    const res = await api.get(`/pages/${slug}/tags`)
    set({ pageTags: res.data })
  },

  removeTag: async (slug, tagName) => {
    await api.delete(`/pages/${slug}/tags/${encodeURIComponent(tagName)}`)
    const res = await api.get(`/pages/${slug}/tags`)
    set({ pageTags: res.data })
  },
}))

export default useTags
