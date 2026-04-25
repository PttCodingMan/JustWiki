import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderMindmap, MindmapParseError } from '../lib/mindmap'
import { layoutMindmap, LAYOUT } from '../lib/mindmapLayout'
import useMindmapTheme, { mindmapThemes } from '../store/useMindmapTheme'

/**
 * XMind-style left-to-right mindmap renderer.
 *
 * Pipeline:
 *   markdown → `renderMindmap` → tree → `layoutMindmap` → SVG JSX
 *
 * The renderer has no Mermaid / DOMParser / dangerouslySetInnerHTML: the text
 * goes straight into React's `<text>` element so XSS is impossible, and the
 * layout functions are pure so theme / palette changes re-render instantly.
 *
 * Palettes (see `useMindmapTheme`) can be chosen per-reader via the dropdown
 * at the top-right of the diagram. `classic` defers to the wiki theme; other
 * palettes override node fill/stroke/text with their own color scale.
 */

function levelStyle(palette, depth) {
  if (palette.useWikiTheme) {
    const n = Math.min(depth, 4)
    return {
      fill: `var(--mindmap-lv${n}-fill)`,
      stroke: `var(--mindmap-lv${n}-stroke)`,
      text: `var(--mindmap-lv${n}-text)`,
    }
  }
  const levels = palette.levels
  const idx = Math.min(depth, levels.length - 1)
  return levels[idx]
}

function ThemeDropdown({ value, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const current = mindmapThemes[value] || mindmapThemes.classic
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1 text-xs rounded-lg border border-border bg-surface hover:bg-surface-hover text-text-secondary"
        title={t('mindmap.themeLabel')}
        aria-label={t('mindmap.themeLabel')}
      >
        <span className="flex gap-0.5">
          {current.preview.map((c, i) => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-full border border-border"
              style={{ background: c }}
            />
          ))}
        </span>
        <span>{current.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded-xl shadow-lg p-1.5 min-w-[220px]">
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 py-1">
            {t('mindmap.themeLabel')}
          </div>
          {Object.entries(mindmapThemes).map(([id, t]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange(id)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                value === id
                  ? 'bg-surface-hover text-text font-medium'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              <span className="flex gap-0.5 shrink-0">
                {t.preview.map((c, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full border border-border"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span className="flex-1">{t.name}</span>
              {value === id && <span className="text-primary text-xs">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function MindmapView({ content, title }) {
  const mindmapTheme = useMindmapTheme((s) => s.theme)
  const setMindmapTheme = useMindmapTheme((s) => s.setTheme)
  const [zoomed, setZoomed] = useState(null)

  const parsed = useMemo(() => {
    try {
      return { tree: renderMindmap(content || '', title || ''), error: '' }
    } catch (e) {
      if (e instanceof MindmapParseError) return { tree: null, error: e.message }
      throw e
    }
  }, [content, title])

  const layout = useMemo(
    () => (parsed.tree ? layoutMindmap(parsed.tree) : null),
    [parsed.tree],
  )

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e) => {
      if (e.key === 'Escape') setZoomed(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zoomed])

  if (parsed.error) {
    return (
      <div className="p-4 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
        {parsed.error}
      </div>
    )
  }
  if (!layout) return null

  const palette = mindmapThemes[mindmapTheme] || mindmapThemes.classic
  const edgeStroke = palette.useWikiTheme ? 'var(--mindmap-edge)' : palette.edge

  return (
    <div className="mindmap-container" data-mindmap-theme={mindmapTheme}>
      {/* Toolbar sits above the SVG in normal flow so it never covers the
          mindmap — absolute positioning over the diagram obscured root nodes
          on narrow screens. */}
      <div className="flex justify-end mb-3">
        <ThemeDropdown value={mindmapTheme} onChange={setMindmapTheme} />
      </div>
      <svg
        role="img"
        aria-label={title ? `Mindmap: ${title}` : 'Mindmap'}
        viewBox={layout.viewBox.join(' ')}
        width={layout.viewBox[2]}
        height={layout.viewBox[3]}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      >
        <g className="mindmap-edges" fill="none" stroke={edgeStroke} strokeWidth="1.5">
          {layout.edges.map((e) => (
            <path key={e.id} d={e.d} />
          ))}
        </g>
        <g className="mindmap-nodes" fontFamily={LAYOUT.FONT_FAMILY} fontSize={LAYOUT.FONT_SIZE}>
          {layout.nodes.map((n) => {
            const s = levelStyle(palette, n.depth)
            const hasImage = !!n.image
            const hasText = !!n.text
            // Layout image + text within the node's local frame (origin = rect
            // center). Image-and-text: a left-anchored block centered in the
            // rect, image on the left. Image-only: image centered. Text-only:
            // text centered (matches the legacy behavior).
            let imgX = 0
            let textX = 0
            if (hasImage && hasText) {
              const contentW = LAYOUT.IMG_SIZE + LAYOUT.IMG_GAP + n.textW
              imgX = -contentW / 2
              textX = imgX + LAYOUT.IMG_SIZE + LAYOUT.IMG_GAP + n.textW / 2
            } else if (hasImage) {
              imgX = -LAYOUT.IMG_SIZE / 2
            }
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <rect
                  x={-n.w / 2}
                  y={-n.h / 2}
                  width={n.w}
                  height={n.h}
                  rx="6"
                  ry="6"
                  fill={s.fill}
                  stroke={s.stroke}
                  strokeWidth="1.5"
                />
                {hasImage && (
                  <image
                    href={n.image.src}
                    x={imgX}
                    y={-LAYOUT.IMG_SIZE / 2}
                    width={LAYOUT.IMG_SIZE}
                    height={LAYOUT.IMG_SIZE}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ cursor: 'zoom-in' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setZoomed(n.image)
                    }}
                  >
                    {n.image.alt ? <title>{n.image.alt}</title> : null}
                  </image>
                )}
                {hasText && (
                  <text
                    x={textX}
                    y="0"
                    fill={s.text}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {n.text}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      {zoomed && (
        <div
          className="image-lightbox-overlay"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
          aria-label={zoomed.alt || 'Image preview'}
        >
          <img
            src={zoomed.src}
            alt={zoomed.alt || ''}
            className="image-lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
