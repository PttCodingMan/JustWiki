import { create } from 'zustand'

/**
 * Mindmap-specific palettes. These are *independent* of the wiki theme: a
 * reader can keep the wiki on Dark while viewing a Forest-palette mindmap,
 * for instance. Each palette defines per-level fill/border/text colors; the
 * SVG renderer applies them via inline `fill` / `stroke` attributes (no CSS
 * variable indirection, so palettes compose with any wiki theme).
 *
 * `classic` is the historical default — it defers to the wiki theme by
 * leaving colors null, and the renderer falls back to `var(--color-*)`.
 */
export const mindmapThemes = {
  classic: {
    name: 'Classic (follow wiki theme)',
    preview: ['#7ea7d8', '#eef4fb', '#ffffff', '#f2f6fa'],
    useWikiTheme: true,
  },
  colorful: {
    name: 'Colorful',
    preview: ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f'],
    levels: [
      { fill: '#e76f51', text: '#ffffff', stroke: '#b8533b' },
      { fill: '#f4a261', text: '#2c2c2c', stroke: '#c67f48' },
      { fill: '#e9c46a', text: '#2c2c2c', stroke: '#b99a4c' },
      { fill: '#2a9d8f', text: '#ffffff', stroke: '#207a6f' },
      { fill: '#264653', text: '#ffffff', stroke: '#1a3340' },
    ],
    edge: '#8a8a8a',
    background: null,
  },
  pastel: {
    name: 'Pastel',
    preview: ['#ffd6e0', '#ffeecc', '#d4f0e0', '#cde7f7'],
    levels: [
      { fill: '#ffd6e0', text: '#6a3d4b', stroke: '#e8adbb' },
      { fill: '#ffeecc', text: '#6a5230', stroke: '#e0c795' },
      { fill: '#d4f0e0', text: '#2f5f45', stroke: '#a8cdb8' },
      { fill: '#cde7f7', text: '#2e4a63', stroke: '#a0c4d9' },
      { fill: '#e5d6f3', text: '#4b3562', stroke: '#b9a3cf' },
    ],
    edge: '#b5b0bb',
    background: null,
  },
  mono: {
    name: 'Monochrome',
    preview: ['#1f2937', '#4b5563', '#9ca3af', '#e5e7eb'],
    levels: [
      { fill: '#1f2937', text: '#ffffff', stroke: '#111827' },
      { fill: '#4b5563', text: '#ffffff', stroke: '#374151' },
      { fill: '#9ca3af', text: '#1f2937', stroke: '#6b7280' },
      { fill: '#d1d5db', text: '#1f2937', stroke: '#9ca3af' },
      { fill: '#f3f4f6', text: '#374151', stroke: '#d1d5db' },
    ],
    edge: '#9ca3af',
    background: null,
  },
  forest: {
    name: 'Forest',
    preview: ['#2d5016', '#4a7c2e', '#8ab661', '#e8f0dd'],
    levels: [
      { fill: '#2d5016', text: '#ffffff', stroke: '#1e3810' },
      { fill: '#4a7c2e', text: '#ffffff', stroke: '#365b21' },
      { fill: '#8ab661', text: '#1e3810', stroke: '#6b944a' },
      { fill: '#c7dba5', text: '#2d5016', stroke: '#9cb87e' },
      { fill: '#e8f0dd', text: '#2d5016', stroke: '#c7dba5' },
    ],
    edge: '#6b944a',
    background: null,
  },
  ocean: {
    name: 'Ocean',
    preview: ['#023e8a', '#0077b6', '#00b4d8', '#caf0f8'],
    levels: [
      { fill: '#023e8a', text: '#ffffff', stroke: '#012a5f' },
      { fill: '#0077b6', text: '#ffffff', stroke: '#005885' },
      { fill: '#00b4d8', text: '#ffffff', stroke: '#0086a1' },
      { fill: '#90e0ef', text: '#023e8a', stroke: '#5fb5c7' },
      { fill: '#caf0f8', text: '#023e8a', stroke: '#9cc9d6' },
    ],
    edge: '#0077b6',
    background: null,
  },
}

const STORAGE_KEY = 'mindmapTheme'
const DEFAULT = 'classic'

function readSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved && mindmapThemes[saved] ? saved : DEFAULT
  } catch {
    return DEFAULT
  }
}

const useMindmapTheme = create((set) => ({
  theme: readSaved(),
  setTheme: (id) => {
    if (!mindmapThemes[id]) return
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // localStorage may be blocked in private-browsing / embedded contexts;
      // the selection still applies for the current session.
    }
    set({ theme: id })
  },
}))

export default useMindmapTheme
