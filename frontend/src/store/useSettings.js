import { create } from 'zustand'
import api from '../api/client'

// Built-in fallbacks. Mirror DEFAULT_SETTINGS in backend/app/routers/settings.py
// so the UI renders sensible labels before the GET /api/settings response
// arrives — prevents a one-frame flash of empty title bars on cold load.
// `anonymous_read` mirrors the server-side ANONYMOUS_READ env var; default
// false so the UI stays in "redirect to login" mode until proven otherwise.
const DEFAULTS = {
  site_name: 'JustWiki',
  login_title: 'JustWiki',
  login_subtitle: 'Just clone, run, and write.',
  home_page_slug: '',
  footer_text: 'Powered by JustWiki',
  anonymous_read: false,
}

// In-flight `/api/settings` request shared across callers so App.jsx's
// boot-time fetch and useAuth.checkAuth's lazy "make sure settings are
// loaded" don't race into two parallel network calls. Cleared once the
// promise settles so a subsequent fetch (e.g. after an admin update) still
// fires fresh.
let _inflight = null

const useSettings = create((set) => ({
  ...DEFAULTS,
  loaded: false,

  fetch: async () => {
    if (_inflight) return _inflight
    _inflight = (async () => {
      try {
        const res = await api.get('/settings')
        set({ ...DEFAULTS, ...res.data, loaded: true })
      } catch {
        // Backend offline or first-time setup — keep defaults so the UI
        // still renders. `loaded:true` releases gates that wait on settings.
        set({ loaded: true })
      } finally {
        _inflight = null
      }
    })()
    return _inflight
  },

  update: async (patch) => {
    const res = await api.put('/settings', patch)
    set({ ...DEFAULTS, ...res.data, loaded: true })
    return res.data
  },
}))

export default useSettings
