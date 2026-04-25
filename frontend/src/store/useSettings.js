import { create } from 'zustand'
import api from '../api/client'

// Built-in fallbacks. Mirror DEFAULT_SETTINGS in backend/app/routers/settings.py
// so the UI renders sensible labels before the GET /api/settings response
// arrives — prevents a one-frame flash of empty title bars on cold load.
const DEFAULTS = {
  site_name: 'JustWiki',
  login_title: 'JustWiki',
  login_subtitle: 'Just clone, run, and write.',
  home_page_slug: '',
  footer_text: 'Powered by JustWiki',
}

const useSettings = create((set) => ({
  ...DEFAULTS,
  loaded: false,

  fetch: async () => {
    try {
      const res = await api.get('/settings')
      set({ ...DEFAULTS, ...res.data, loaded: true })
    } catch {
      // Backend offline or first-time setup — keep defaults so the UI
      // still renders. `loaded:true` releases gates that wait on settings.
      set({ loaded: true })
    }
  },

  update: async (patch) => {
    const res = await api.put('/settings', patch)
    set({ ...DEFAULTS, ...res.data, loaded: true })
    return res.data
  },
}))

export default useSettings
