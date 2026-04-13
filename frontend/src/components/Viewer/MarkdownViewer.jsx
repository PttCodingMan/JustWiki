import React, { useMemo, useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../../lib/markdown'
import api from '../../api/client'

mermaid.initialize({
  startOnLoad: false,
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
  securityLevel: 'strict',
})

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Stable default so non-publicMode callers don't retrigger effects every render.
const EMPTY_DIAGRAMS = Object.freeze({})

export default function MarkdownViewer({
  content,
  onDiagramClick,
  publicMode = false,
  diagrams = EMPTY_DIAGRAMS,
  onHeadings,
}) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(renderMarkdown(content || ''), {
        ADD_TAGS: ['div', 'input', 'svg', 'path', 'line', 'circle', 'polygon'],
        ADD_ATTR: [
          'data-mermaid',
          'data-transclude',
          'data-diagram-id',
          'class',
          'checked',
          'disabled',
          'type',
          'target',
          'rel',
          'viewBox',
          'fill',
          'stroke',
          'stroke-width',
          'stroke-linecap',
          'stroke-linejoin',
          'x1',
          'y1',
          'x2',
          'y2',
          'cx',
          'cy',
          'r',
          'd',
          'points',
        ],
        ALLOW_DATA_ATTR: true,
      }),
    [content],
  )
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const [lightboxSvg, setLightboxSvg] = useState(null)

  // React 19 re-applies dangerouslySetInnerHTML on every re-render even when the
  // string is referentially equal, which wipes the Mermaid SVGs and transcluded
  // HTML that the effects below inject imperatively. Setting innerHTML ourselves
  // from a layout effect keyed on `html` means it only rewrites when content
  // genuinely changes — so unrelated parent re-renders leave our DOM alone.
  useLayoutEffect(() => {
    if (containerRef.current) containerRef.current.innerHTML = html
  }, [html])

  // Extract h1-h3 headings for the TOC. Runs after DOM is populated.
  useEffect(() => {
    if (!onHeadings || !containerRef.current) return
    const nodes = containerRef.current.querySelectorAll('h1[id], h2[id], h3[id]')
    const items = Array.from(nodes).map((el) => ({
      id: el.id,
      level: Number(el.tagName.slice(1)),
      text: el.textContent || '',
    }))
    onHeadings(items)
  }, [html, onHeadings])

  const handleClick = useCallback(
    (e) => {
      // Wikilinks: intercept and navigate via router instead of full page load
      const link = e.target.closest('a.wikilink')
      if (link) {
        e.preventDefault()
        const href = link.getAttribute('href')
        if (href) navigate(href)
        return
      }

      // Draw.io diagram click
      const diagram = e.target.closest('.drawio-embed')
      if (diagram) {
        if (onDiagramClick) {
          const id = parseInt(diagram.dataset.diagramId)
          if (id) onDiagramClick(id)
        } else {
          const svgEl = diagram.querySelector('.drawio-svg')
          if (svgEl) {
            setLightboxSvg(
              DOMPurify.sanitize(svgEl.innerHTML, {
                USE_PROFILES: { svg: true, svgFilters: true },
              }),
            )
          }
        }
      }
    },
    [navigate, onDiagramClick],
  )

  // Load transclusions (disabled in publicMode: we never fetch private page
  // content anonymously; show a placeholder instead — see Q2 in to-do.md)
  useEffect(() => {
    if (!containerRef.current) return
    const elements = containerRef.current.querySelectorAll('[data-transclude]')
    if (publicMode) {
      elements.forEach((el) => {
        el.innerHTML =
          '<em class="text-text-secondary">(transclusion disabled on public pages)</em>'
      })
      return
    }
    elements.forEach(async (el) => {
      const slug = el.dataset.transclude
      try {
        const res = await api.get(`/pages/${slug}`)
        el.innerHTML = DOMPurify.sanitize(renderMarkdown(res.data.content_md || ''))
      } catch {
        el.innerHTML = '<em class="text-gray-400">Page not found</em>'
      }
    })
  }, [html, publicMode])

  // Render Mermaid diagrams
  useEffect(() => {
    if (!containerRef.current) return
    const blocks = containerRef.current.querySelectorAll('[data-mermaid]')
    if (blocks.length === 0) return
    const isDark = document.documentElement.classList.contains('dark')
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
    })
    blocks.forEach(async (el, i) => {
      const code = decodeURIComponent(el.dataset.mermaid)
      try {
        const id = `mermaid-${Date.now()}-${i}`
        const { svg } = await mermaid.render(id, code)
        el.innerHTML = svg
      } catch (err) {
        el.innerHTML = `<pre class="mermaid-error">Mermaid error: ${escapeHtml(err.message || 'Unknown error')}</pre>`
      }
    })
  }, [html])

  // Load Draw.io diagram SVGs.
  //
  // In publicMode we don't have access to /api/diagrams/* — the caller passes
  // already-resolved SVGs via the `diagrams` prop (keyed by diagram id).
  useEffect(() => {
    if (!containerRef.current) return
    const blocks = containerRef.current.querySelectorAll('[data-diagram-id]')
    if (publicMode) {
      blocks.forEach((el) => {
        const id = el.dataset.diagramId
        const svg = diagrams[id]
        if (svg) {
          const safeSvg = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
          el.innerHTML = `<div class="drawio-svg">${safeSvg}</div>`
          el.classList.add('drawio-clickable')
        } else {
          el.innerHTML = `<div class="drawio-placeholder">Diagram #${id} unavailable</div>`
        }
      })
      return
    }
    blocks.forEach(async (el) => {
      const id = el.dataset.diagramId
      try {
        const res = await api.get(`/diagrams/${id}`)
        if (res.data.svg_cache) {
          const safeSvg = DOMPurify.sanitize(res.data.svg_cache, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
          el.innerHTML = `<div class="drawio-svg">${safeSvg}</div>`
          el.classList.add('drawio-clickable')
        } else {
          el.innerHTML = `<div class="drawio-placeholder">Draw.io diagram #${id} (no SVG preview)</div>`
        }
      } catch {
        el.innerHTML = `<div class="drawio-placeholder drawio-error">Diagram #${id} not found</div>`
      }
    })
  }, [html, publicMode, diagrams])

  // Add rel="nofollow" to every wikilink when rendering a public page, so
  // crawlers don't waste budget on private slugs (see Q13 in to-do.md).
  useEffect(() => {
    if (!publicMode || !containerRef.current) return
    containerRef.current.querySelectorAll('a.wikilink').forEach((a) => {
      a.setAttribute('rel', 'nofollow')
    })
  }, [html, publicMode])

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-viewer"
        onClick={handleClick}
      />
      {lightboxSvg && (
        <div className="drawio-lightbox-overlay" onClick={() => setLightboxSvg(null)}>
          <div
            className="drawio-lightbox-content"
            dangerouslySetInnerHTML={{ __html: lightboxSvg }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
