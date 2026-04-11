import { create } from 'zustand'

const useTheme = create((set) => ({
  dark: localStorage.getItem('theme') === 'dark',

  toggle: () => set((state) => {
    const next = !state.dark
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', next)
    return { dark: next }
  }),

  init: () => {
    const saved = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = saved ? saved === 'dark' : prefersDark
    document.documentElement.classList.toggle('dark', dark)
    set({ dark })
  },
}))

export default useTheme
