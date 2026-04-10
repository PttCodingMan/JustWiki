import { create } from 'zustand'
import api from '../api/client'

const useSearch = create((set) => ({
  results: [],
  total: 0,
  loading: false,
  query: '',

  search: async (q, tag = null, page = 1) => {
    set({ loading: true, query: q })
    try {
      const params = { q, page, per_page: 20 }
      if (tag) params.tag = tag
      const res = await api.get('/search', { params })
      set({ results: res.data.results, total: res.data.total, loading: false })
      return res.data
    } catch {
      set({ results: [], total: 0, loading: false })
      return { results: [], total: 0 }
    }
  },

  clearSearch: () => set({ results: [], total: 0, query: '' }),
}))

export default useSearch
