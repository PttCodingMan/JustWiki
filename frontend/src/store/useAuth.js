import { create } from 'zustand'
import api from '../api/client'

const useAuth = create((set) => ({
  user: null,
  isAuthenticated: false,
  loading: true,

  login: async (username, password) => {
    const res = await api.post('/auth/login', { username, password })
    set({ user: res.data.user, isAuthenticated: true })
    return res.data
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    set({ user: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    try {
      const res = await api.get('/auth/me')
      set({ user: res.data, isAuthenticated: true, loading: false })
    } catch {
      set({ user: null, isAuthenticated: false, loading: false })
    }
  },
}))

export default useAuth
