import { create } from 'zustand'
import api from '../api/client'

const usePages = create((set) => ({
  pages: [],
  tree: [],
  total: 0,
  loading: false,

  fetchPages: async (page = 1, perPage = 20) => {
    set({ loading: true })
    const res = await api.get('/pages', { params: { page, per_page: perPage } })
    set({ pages: res.data.pages, total: res.data.total, loading: false })
    return res.data
  },

  fetchTree: async () => {
    const res = await api.get('/pages/tree')
    set({ tree: res.data })
    return res.data
  },

  getPage: async (slug) => {
    const res = await api.get(`/pages/${slug}`)
    return res.data
  },

  createPage: async (data) => {
    const res = await api.post('/pages', data)
    return res.data
  },

  updatePage: async (slug, data) => {
    // `data` may contain `base_version` for optimistic locking; the backend
    // returns 409 if the server has a newer version than what the client holds.
    const res = await api.put(`/pages/${slug}`, data)
    return res.data
  },

  deletePage: async (slug) => {
    await api.delete(`/pages/${slug}`)
  },

  restorePage: async (slug) => {
    const res = await api.post(`/trash/${slug}/restore`)
    return res.data
  },

  purgePage: async (slug) => {
    await api.delete(`/trash/${slug}`)
  },

  fetchTrash: async () => {
    const res = await api.get('/trash')
    return res.data
  },

  movePage: async (slug, parentId, sortOrder) => {
    await api.patch(`/pages/${slug}/move`, { parent_id: parentId, sort_order: sortOrder })
    // Refresh tree after move
    const res = await api.get('/pages/tree')
    set({ tree: res.data })
  },
}))

export default usePages
