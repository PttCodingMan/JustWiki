import React, { useMemo, useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../../lib/markdown'
import { ensureMermaid } from '../../lib/mermaidBootstrap'
import api from '../../api/client'

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Single DOMPurify config shared between the top-level sanitize and the
// transclusion sanitize. Previously the transclusion path used the default
// config, which stripped our custom data-* attributes (data-mermaid,
// data-transclude, data-diagram-id) so transcluded Mermaid and Draw.io
// diagrams silently failed to render.
//
// We explicitly list the attributes we emit rather than enabling
// ALLOW_DATA_ATTR: true, which would let any future feature reading
// user-controlled data-* attributes become an XSS sink. Dangerous
// container tags that could smuggle active content are forbidden.
const MARKDOWN_SANITIZE_CONFIG = {
  ADD_TAGS: ['div', 'input', 'svg', 'path', 'line', 'circle', 'polygon'],
  ADD_ATTR: [
    'data-mermaid',
    'data-transclude',
    'data-diagram-id',
    'checked',
    'disabled',
    'type',
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
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'noscript'],
}

function sanitizeMarkdownHtml(dirty) {
  return DOMPurify.sanitize(dirty, MARKDOWN_SANITIZE_CONFIG)
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
    () => sanitizeMarkdownHtml(renderMarkdown(content || '')),
    [content],
  )
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const [lightboxSvg, setLightboxSvg] = useState(null)
  const [lightboxImg, setLightboxImg] = useState(null)

  // React 19 re-applies dangerouslySetInnerHTML on every re-render even when the
  // string is referentially equal, which wipes the Mermaid SVGs and transcluded
  // HTML that the effects below inject imperatively. Setting innerHTML ourselves
  // from a layout effect keyed on `html` means it only rewrites when content
  // genuinely changes — so unrelated parent re-renders leave our DOM alone.
  useLayoutEffect(() => {
    if (containerRef.current) containerRef.current.innerHTML = html
  }, [html])

  useEffect(() => {
    if (!lightboxSvg && !lightboxImg) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLightboxSvg(null)
        setLightboxImg(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightboxSvg, lightboxImg])

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

      // Inline image click → open lightbox. Skip when the image is wrapped in
      // a link (the link wins) or sits inside a draw.io / mermaid block (those
      // have their own handlers right below).
      if (
        e.target.tagName === 'IMG' &&
        !e.target.closest('a') &&
        !e.target.closest('.drawio-embed') &&
        !e.target.closest('[data-mermaid]')
      ) {
        const src = e.target.getAttribute('src')
        if (src) {
          setLightboxImg({ src, alt: e.target.getAttribute('alt') || '' })
          return
        }
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

  // Hoisted so both the top-level effect and the transclusion loader can
  // process mermaid blocks — transcluded content arrives after the initial
  // effect runs, so those diagrams would otherwise stay stuck at the loader.
  const renderMermaidIn = useCallback(async (root) => {
    if (!root) return
    const blocks = root.querySelectorAll('[data-mermaid]:not([data-mermaid-rendered])')
    if (blocks.length === 0) return
    const mermaid = ensureMermaid()
    const stamp = Date.now()
    blocks.forEach(async (el, i) => {
      el.setAttribute('data-mermaid-rendered', '1')
      const code = decodeURIComponent(el.dataset.mermaid)
      try {
        const id = `mermaid-${stamp}-${Math.random().toString(36).slice(2, 8)}-${i}`
        const { svg } = await mermaid.render(id, code)
        el.innerHTML = svg
      } catch (err) {
        el.innerHTML = `<pre class="mermaid-error">Mermaid error: ${escapeHtml(err.message || 'Unknown error')}</pre>`
      }
    })
  }, [])

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
        el.innerHTML = sanitizeMarkdownHtml(renderMarkdown(res.data.content_md || ''))
        await renderMermaidIn(el)
      } catch {
        el.innerHTML = '<em class="text-gray-400">Page not found</em>'
      }
    })
  }, [html, publicMode, renderMermaidIn])

  // Render Mermaid diagrams
  useEffect(() => {
    renderMermaidIn(containerRef.current)
  }, [html, renderMermaidIn])

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
      {lightboxImg && (
        <div
          className="image-lightbox-overlay"
          onClick={() => setLightboxImg(null)}
          role="dialog"
          aria-modal="true"
          aria-label={lightboxImg.alt || 'Image preview'}
        >
          <img
            src={lightboxImg.src}
            alt={lightboxImg.alt}
            className="image-lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
