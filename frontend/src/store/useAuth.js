import { create } from 'zustand'
import api from '../api/client'
import useSettings from './useSettings'
import { setGuestMode } from '../lib/authState'

// Synthetic user used when ANONYMOUS_READ is on and the visitor has no
// session. Carries `anonymous: true` so UI components can switch off
// write affordances without re-checking permission everywhere.
const GUEST_USER = Object.freeze({
  id: null,
  username: 'guest',
  display_name: 'Guest',
  email: '',
  role: 'viewer',
  anonymous: true,
})

const useAuth = create((set) => ({
  user: null,
  isAuthenticated: false,
  loading: true,

  login: async (username, password) => {
    const res = await api.post('/auth/login', { username, password })
    setGuestMode(false)
    set({ user: res.data.user, isAuthenticated: true })
    return res.data
  },

  logout: async () => {
    await api.post('/auth/logout').catch(() => {})
    setGuestMode(false)
    set({ user: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    try {
      const res = await api.get('/auth/me')
      setGuestMode(false)
      set({ user: res.data, isAuthenticated: true, loading: false })
    } catch {
      // /auth/me 401 means "no real session". Whether to fall back to a
      // guest viewer depends on the server-side ANONYMOUS_READ flag, which
      // ships in /api/settings. Make sure settings have loaded first so the
      // boot sequence doesn't race and miscategorise a guest as logged-out.
      const settings = useSettings.getState()
      if (!settings.loaded) {
        await settings.fetch()
      }
      if (useSettings.getState().anonymous_read) {
        // isAuthenticated stays false so anything that gates on "really
        // logged in" still treats this user as not signed in.
        setGuestMode(true)
        set({ user: GUEST_USER, isAuthenticated: false, loading: false })
      } else {
        setGuestMode(false)
        set({ user: null, isAuthenticated: false, loading: false })
      }
    }
  },
}))

export default useAuth
