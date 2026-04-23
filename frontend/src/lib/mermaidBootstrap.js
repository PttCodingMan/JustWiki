/**
 * Centralized Mermaid initialization.
 *
 * Before this existed, MarkdownViewer.jsx was calling `mermaid.initialize`
 * at module scope AND inside `renderMermaidIn` on every render. That was
 * harmless but noisy; once MindmapView needed its own init too, the risk
 * of two components racing on the global theme setting got real. Everyone
 * now goes through `ensureMermaid()` — init runs once per theme switch.
 */
import mermaid from 'mermaid'

let lastTheme = null

function currentTheme() {
  return typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'default'
}

/**
 * Idempotent init. Safe to call on every render: the underlying `initialize`
 * is cheap when the config hasn't changed, and we short-circuit when the
 * theme is the same as the previous call.
 */
export function ensureMermaid() {
  const theme = currentTheme()
  if (theme === lastTheme) return mermaid
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
  })
  lastTheme = theme
  return mermaid
}

export default mermaid
