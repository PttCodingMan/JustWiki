import { create } from 'zustand'

export const themes = {
  light: {
    name: 'Light',
    dark: false,
    preview: ['#ffffff', '#f8fafc', '#2563eb', '#1d4ed8'],
  },
  dark: {
    name: 'Dark',
    dark: true,
    preview: ['#0f172a', '#1e293b', '#3b82f6', '#60a5fa'],
  },
  lavender: {
    name: 'Lavender',
    dark: false,
    preview: ['#f2eae0', '#bda6ce', '#9b8ec7', '#b4d3d9'],
  },
  forest: {
    name: 'Forest',
    dark: true,
    preview: ['#091413', '#285a48', '#408a71', '#b0e4cc'],
  },
  rose: {
    name: 'Rose',
    dark: false,
    preview: ['#fff5f8', '#fbc3c1', '#faacbf', '#fe81d4'],
  },
  ocean: {
    name: 'Ocean',
    dark: true,
    preview: ['#1a3263', '#547792', '#efd2b0', '#ffc570'],
  },
  sand: {
    name: 'Sand',
    dark: false,
    preview: ['#f3e4c9', '#babf94', '#bfa28c', '#a98b76'],
  },
  sunset: {
    name: 'Sunset',
    dark: true,
    preview: ['#1a1410', '#c44a3a', '#d97a2b', '#f2d479'],
  },
  nord: {
    name: 'Nord',
    dark: true,
    preview: ['#021a54', '#0d1a3a', '#ff85bb', '#ffcee3'],
  },
}

function applyTheme(themeId) {
  const theme = themes[themeId] || themes.light
  const root = document.documentElement
  root.setAttribute('data-theme', themeId)
  root.classList.toggle('dark', theme.dark)
}

const useTheme = create((set) => ({
  theme: localStorage.getItem('theme') || 'light',
  dark: false,

  setTheme: (themeId) => {
    localStorage.setItem('theme', themeId)
    applyTheme(themeId)
    set({ theme: themeId, dark: themes[themeId]?.dark ?? false })
  },

  init: () => {
    const saved = localStorage.getItem('theme')
    const themeId = saved && themes[saved] ? saved : 'light'
    applyTheme(themeId)
    set({ theme: themeId, dark: themes[themeId]?.dark ?? false })
  },
}))

export default useTheme
