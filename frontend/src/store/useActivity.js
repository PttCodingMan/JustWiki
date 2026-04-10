import { create } from 'zustand'
import api from '../api/client'

const useActivity = create((set) => ({
  activities: [],
  stats: null,
  statsLoaded: false,
  total: 0,
  loading: false,

  fetchActivity: async (page = 1, perPage = 50) => {
    set({ loading: true })
    try {
      const res = await api.get('/activity', { params: { page, per_page: perPage } })
      set({ activities: res.data.activities, total: res.data.total, loading: false })
      return res.data
    } catch {
      set({ loading: false })
    }
  },

  fetchStats: async (force = false) => {
    const { statsLoaded } = useActivity.getState()
    if (statsLoaded && !force) return useActivity.getState().stats
    try {
      const res = await api.get('/activity/stats')
      set({ stats: res.data, statsLoaded: true })
      return res.data
    } catch {
      return null
    }
  },
}))

export default useActivity
