import { useMemo, useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import mermaid from 'mermaid'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import api from '../../api/client'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
})

function renderKatex(text, displayMode = false) {
  try {
    return katex.renderToString(text, { displayMode, throwOnError: false })
  } catch {
    return `<code class="katex-error">${text}</code>`
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseCallouts(html) {
  // :::info, :::warning, :::tip, :::danger
  const icons = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
    danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  }
  const titles = { info: 'Info', warning: 'Warning', tip: 'Tip', danger: 'Danger' }
  return html.replace(
    /:::[ \t]*(info|warning|tip|danger)\s*\n([\s\S]*?):::/g,
    (_, type, content) => {
      return `<div class="callout callout-${type}"><div class="callout-title"><span class="callout-icon">${icons[type]}</span>${titles[type]}</div><div class="callout-body">${simpleMarkdown(content.trim())}</div></div>`
    }
  )
}

function matchListItem(line) {
  let m = line.match(/^(\s*)[-*] \[x\]\s+(.+)$/)
  if (m) return { indent: m[1].length, content: `<input type="checkbox" checked disabled /> ${m[2]}`, type: 'ul' }

  m = line.match(/^(\s*)[-*] \[\s?\]\s+(.+)$/)
  if (m) return { indent: m[1].length, content: `<input type="checkbox" disabled /> ${m[2]}`, type: 'ul' }

  m = line.match(/^(\s*)[-*] \\\[\s?\]$/)
  if (m) return { indent: m[1].length, content: `<input type="checkbox" disabled />`, type: 'ul' }

  m = line.match(/^(\s*)[-*] \\\[\s?\]\s+(.+)$/)
  if (m) return { indent: m[1].length, content: `<input type="checkbox" disabled /> ${m[2]}`, type: 'ul' }

  m = line.match(/^(\s*)[-*] (.+)$/)
  if (m) return { indent: m[1].length, content: m[2], type: 'ul' }

  m = line.match(/^(\s*)\d+\.\s+(.+)$/)
  if (m) return { indent: m[1].length, content: m[2], type: 'ol' }

  return null
}

function buildNestedList(items) {
  const uniqueIndents = [...new Set(items.map(it => it.indent))].sort((a, b) => a - b)
  const levelOf = (indent) => uniqueIndents.indexOf(indent)

  let html = ''
  let currentLevel = -1
  const typeStack = []

  for (const item of items) {
    const level = levelOf(item.indent)

    if (level > currentLevel) {
      for (let l = currentLevel + 1; l <= level; l++) {
        html += `<${item.type}>`
        typeStack.push(item.type)
      }
    } else if (level < currentLevel) {
      for (let l = currentLevel; l > level; l--) {
        html += `</li></${typeStack.pop()}>`
      }
      html += '</li>'
    } else {
      if (currentLevel >= 0) html += '</li>'
    }

    html += `<li>${item.content}`
    currentLevel = level
  }

  for (let l = currentLevel; l >= 0; l--) {
    html += `</li></${typeStack.pop()}>`
  }

  return html
}

function parseLists(html) {
  const lines = html.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    const match = matchListItem(lines[i])
    if (!match) {
      result.push(lines[i])
      i++
      continue
    }

    const listLines = []
    while (i < lines.length) {
      const m = matchListItem(lines[i])
      if (m) {
        listLines.push(m)
        i++
      } else if (lines[i].trim() === '' && i + 1 < lines.length && matchListItem(lines[i + 1])) {
        // Skip blank lines between list items
        i++
      } else {
        break
      }
    }
    result.push(buildNestedList(listLines))
  }

  return result.join('\n')
}

function parseWikilinks(html) {
  // Transclusion: ![[slug]] → embedded block with link
  html = html.replace(/!\[\[([^\]|]+)\]\]/g, (_, slug) => {
    const s = slug.trim()
    return `<div class="transclusion"><div class="transclusion-header"><a href="/page/${s}" class="wikilink transclusion-link">📄 ${s}</a></div><div class="transclusion-content" data-transclude="${s}">Loading...</div></div>`
  })

  // Wikilink: [[slug|display]] or [[slug]]
  html = html.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, slug, display) => {
    const s = slug.trim()
    const label = display ? display.trim() : s
    return `<a href="/page/${s}" class="wikilink">${escapeHtml(label)}</a>`
  })

  return html
}

function parseTables(html) {
  const lines = html.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    if (/^\|.+\|$/.test(lines[i])) {
      const tableLines = []
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        tableLines.push(lines[i])
        i++
      }

      let tableHtml = '<table>'
      if (tableLines.length >= 2) {
        const cells2 = tableLines[1].slice(1, -1).split('|').map(c => c.trim())
        const hasSeparator = cells2.every(c => /^-+$/.test(c))

        if (hasSeparator) {
          const headerCells = tableLines[0].slice(1, -1).split('|').map(c => c.trim())
          tableHtml += '<thead><tr>' + headerCells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          for (let j = 2; j < tableLines.length; j++) {
            const cells = tableLines[j].slice(1, -1).split('|').map(c => c.trim())
            tableHtml += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'
          }
          tableHtml += '</tbody>'
        } else {
          tableHtml += '<tbody>'
          for (const line of tableLines) {
            const cells = line.slice(1, -1).split('|').map(c => c.trim())
            tableHtml += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>'
          }
          tableHtml += '</tbody>'
        }
      } else {
        const cells = tableLines[0].slice(1, -1).split('|').map(c => c.trim())
        tableHtml += '<tbody><tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr></tbody>'
      }
      tableHtml += '</table>'
      result.push(tableHtml)
    } else {
      result.push(lines[i])
      i++
    }
  }

  return result.join('\n')
}

function simpleMarkdown(text) {
  if (!text) return ''

  // Extract mermaid and code blocks BEFORE escaping HTML (to preserve >, <, etc.)
  const codeBlocks = []
  let processed = text.replace(/```([\w]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length
    if (lang === 'mermaid') {
      codeBlocks.push(`<div class="mermaid-block" data-mermaid="${encodeURIComponent(code.trim())}"><pre class="mermaid-loading">Loading diagram...</pre></div>`)
    } else {
      codeBlocks.push(`<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`)
    }
    return `%%CODEBLOCK_${index}%%`
  })

  let html = escapeHtml(processed)

  // Restore <br/> tags
  html = html.replace(/&lt;br\s*\/?\s*&gt;/g, '<br />')

  // Restore code blocks from placeholders
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => codeBlocks[parseInt(i)])

  // Callouts before other processing
  html = parseCallouts(html)

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr />')

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // KaTeX block math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) =>
    `<div class="katex-block">${renderKatex(math.trim(), true)}</div>`
  )

  // KaTeX inline math: $...$  (not inside code)
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, math) =>
    `<span class="katex-inline">${renderKatex(math.trim(), false)}</span>`
  )

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Wikilinks (before standard links, since [[ looks like [)
  html = parseWikilinks(html)

  // Images (before links, so ![alt](url) is not consumed by the link regex)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Lists (unordered, ordered, checkboxes — with nesting support)
  html = parseLists(html)

  // Tables — process as blocks to detect header rows
  html = parseTables(html)

  // Draw.io directive: ::drawio[id] (also handles \[ escaped by Milkdown)
  html = html.replace(/::drawio\\?\[(\d+)\\?\]/g, (_, id) =>
    `<div class="drawio-embed" data-diagram-id="${id}"><div class="drawio-placeholder">Loading Draw.io diagram #${id}...</div></div>`
  )

  // Paragraphs — wrap remaining text lines
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>')

  // Clean up empty lines
  html = html.replace(/\n{3,}/g, '\n\n')

  return html
}

export default function MarkdownViewer({ content, onDiagramClick }) {
  const html = useMemo(() => simpleMarkdown(content || ''), [content])
  const containerRef = useRef(null)
  const navigate = useNavigate()
  const [lightboxSvg, setLightboxSvg] = useState(null)

  // Handle wikilink and diagram clicks
  const handleClick = useCallback((e) => {
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
        // View mode: zoom lightbox
        const svgEl = diagram.querySelector('.drawio-svg')
        if (svgEl) setLightboxSvg(svgEl.innerHTML)
      }
    }
  }, [navigate, onDiagramClick])

  // Load transclusions
  useEffect(() => {
    if (!containerRef.current) return
    const elements = containerRef.current.querySelectorAll('[data-transclude]')
    elements.forEach(async (el) => {
      const slug = el.dataset.transclude
      try {
        const res = await api.get(`/pages/${slug}`)
        el.innerHTML = DOMPurify.sanitize(simpleMarkdown(res.data.content_md || ''))
      } catch {
        el.innerHTML = '<em class="text-gray-400">Page not found</em>'
      }
    })
  }, [html])

  // Render Mermaid diagrams
  useEffect(() => {
    if (!containerRef.current) return
    const blocks = containerRef.current.querySelectorAll('[data-mermaid]')
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

  // Load Draw.io diagram SVGs
  useEffect(() => {
    if (!containerRef.current) return
    const blocks = containerRef.current.querySelectorAll('[data-diagram-id]')
    blocks.forEach(async (el) => {
      const id = el.dataset.diagramId
      try {
        const res = await api.get(`/diagrams/${id}`)
        if (res.data.svg_cache) {
          const safeSvg = DOMPurify.sanitize(res.data.svg_cache, { USE_PROFILES: { svg: true, svgFilters: true } })
          el.innerHTML = `<div class="drawio-svg">${safeSvg}</div>`
          el.classList.add('drawio-clickable')
        } else {
          el.innerHTML = `<div class="drawio-placeholder">Draw.io diagram #${id} (no SVG preview)</div>`
        }
      } catch {
        el.innerHTML = `<div class="drawio-placeholder drawio-error">Diagram #${id} not found</div>`
      }
    })
  }, [html])

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-viewer"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleClick}
      />
      {lightboxSvg && (
        <div
          className="drawio-lightbox-overlay"
          onClick={() => setLightboxSvg(null)}
        >
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
