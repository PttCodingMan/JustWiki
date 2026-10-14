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

// Reading font. `sans` keeps the default Inter/Instrument Serif pairing; the
// mono options swap both the body and display stacks (see index.css,
// `:root[data-font=…]`). Code blocks keep JetBrains Mono either way.
export const fonts = {
  sans: { name: 'Inter', mono: false },
  jetbrains: { name: 'JetBrains Mono', mono: true },
  plex: { name: 'IBM Plex Mono', mono: true },
}

const DEFAULT_FONT = 'sans'

function applyFont(fontId) {
  document.documentElement.setAttribute('data-font', fontId)
}

function applyTheme(themeId) {
  const theme = themes[themeId] || themes.sand
  const root = document.documentElement
  root.setAttribute('data-theme', themeId)
  root.classList.toggle('dark', theme.dark)
}

// Some privacy modes (Safari in private browsing, sandboxed iframes) throw on
// localStorage access. A throw at module-import time would crash the whole
// app before React ever renders, so we swallow the error and fall back to the
// default theme.
function safeGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore — user can still switch themes in-memory for this session.
  }
}

const useTheme = create((set) => ({
  theme: safeGet('theme') || 'sand',
  dark: false,
  font: safeGet('font') || DEFAULT_FONT,

  setTheme: (themeId) => {
    safeSet('theme', themeId)
    applyTheme(themeId)
    set({ theme: themeId, dark: themes[themeId]?.dark ?? false })
  },

  setFont: (fontId) => {
    if (!fonts[fontId]) return
    safeSet('font', fontId)
    applyFont(fontId)
    set({ font: fontId })
  },

  init: () => {
    const saved = safeGet('theme')
    const themeId = saved && themes[saved] ? saved : 'sand'
    const savedFont = safeGet('font')
    const fontId = savedFont && fonts[savedFont] ? savedFont : DEFAULT_FONT
    applyTheme(themeId)
    applyFont(fontId)
    set({ theme: themeId, dark: themes[themeId]?.dark ?? false, font: fontId })
  },
}))

export default useTheme
