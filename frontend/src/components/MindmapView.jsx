import { useEffect, useMemo, useRef, useState } from 'react'
import useTheme from '../store/useTheme'
import { renderMindmap, MindmapParseError } from '../lib/mindmap'
import { ensureMermaid } from '../lib/mermaidBootstrap'

/**
 * Read the active wiki theme into concrete hex / rgb values.
 *
 * Mermaid classDef cannot reference CSS variables directly — the Mermaid
 * SVG lives in its own style tree and `var(--...)` would not resolve
 * against the wiki's `:root`. We snapshot the computed values at render
 * time and embed them into the classDef block, so the diagram picks up
 * theme switches on its next render.
 */
function readTheme() {
  if (typeof document === 'undefined') return null
  const cs = getComputedStyle(document.documentElement)
  const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback
  return {
    primary: read('--color-primary', '#7ea7d8'),
    primaryText: read('--color-primary-text', '#ffffff'),
    primarySoft: read('--color-primary-soft', '#eef4fb'),
    accent: read('--color-accent', '#a8c5e4'),
    surface: read('--color-surface', '#ffffff'),
    surfaceHover: read('--color-surface-hover', '#f2f6fa'),
    text: read('--color-text', '#3e4b5e'),
    textSecondary: read('--color-text-secondary', '#7a8798'),
    border: read('--color-border', '#e6ecf4'),
  }
}

/**
 * Append per-level classDef rules so nodes inherit wiki colors.
 *
 * - lv0 is the root (primary fill, white text)
 * - lv1 uses the soft-primary tint (so top-level branches pop)
 * - lv2..lv4 fade through surface/surface-hover for depth
 *
 * Link styling picks up `border` so edges look like part of the card.
 */
function withThemeStyles(code, theme) {
  if (!theme) return code
  const levels = [
    ['lv0', theme.primary, theme.primaryText, theme.primary],
    ['lv1', theme.primarySoft, theme.text, theme.accent],
    ['lv2', theme.surface, theme.text, theme.border],
    ['lv3', theme.surfaceHover, theme.text, theme.border],
    ['lv4', theme.surfaceHover, theme.textSecondary, theme.border],
  ]
  const defs = levels.map(
    ([name, fill, color, stroke]) =>
      `  classDef ${name} fill:${fill},color:${color},stroke:${stroke},stroke-width:1.5px,rx:6,ry:6`,
  )
  return [code, ...defs, `  linkStyle default stroke:${theme.border},stroke-width:1.5px`].join('\n')
}

export default function MindmapView({ content, title }) {
  const ref = useRef(null)
  const [svg, setSvg] = useState('')
  const [renderError, setRenderError] = useState('')
  // Theme identifier is a proxy for "CSS vars changed": the store updates
  // `data-theme` on <html>, which swaps `--color-*` values. Include it in
  // the useMemo deps so a theme switch re-computes the embedded classDef.
  const themeId = useTheme((s) => s.theme)

  const { code, parseError } = useMemo(() => {
    try {
      const base = renderMindmap(content || '', title || '')
      return { code: withThemeStyles(base, readTheme()), parseError: '' }
    } catch (e) {
      if (e instanceof MindmapParseError) return { code: '', parseError: e.message }
      throw e
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, title, themeId])

  useEffect(() => {
    if (parseError || !code) return
    const mermaid = ensureMermaid()
    const id = `mm-${Math.random().toString(36).slice(2)}`
    let cancelled = false
    mermaid
      .render(id, code)
      .then((res) => {
        if (!cancelled) {
          // Mermaid is initialized with `securityLevel: 'strict'`, which
          // runs DOMPurify over the generated SVG internally. Wrapping
          // again with `USE_PROFILES: { svg: true }` strips foreignObject
          // children and the labels vanish — matches MarkdownViewer.
          setSvg(res.svg)
          setRenderError('')
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSvg('')
          setRenderError(err?.message || 'Mermaid render failed')
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, parseError])

  if (parseError) {
    return (
      <div className="p-4 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
        {parseError}
      </div>
    )
  }
  if (renderError) {
    return (
      <div className="p-4 text-red-700 bg-red-50 border border-red-200 rounded-lg">
        <div className="font-medium mb-1">Mermaid render error</div>
        <pre className="text-sm whitespace-pre-wrap">{renderError}</pre>
      </div>
    )
  }
  return (
    <div
      ref={ref}
      className="mindmap-container overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
