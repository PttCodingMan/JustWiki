import { useMemo } from 'react'

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseCallouts(html) {
  // :::info, :::warning, :::tip, :::danger
  return html.replace(
    /:::(info|warning|tip|danger)\s*\n([\s\S]*?):::/g,
    (_, type, content) => {
      const titles = { info: 'Info', warning: 'Warning', tip: 'Tip', danger: 'Danger' }
      return `<div class="callout callout-${type}"><div class="callout-title">${titles[type]}</div><div>${simpleMarkdown(content.trim())}</div></div>`
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

function simpleMarkdown(text) {
  if (!text) return ''

  let html = escapeHtml(text)

  // Restore <br/> tags
  html = html.replace(/&lt;br\s*\/?\s*&gt;/g, '<br />')

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  )

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

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Lists (unordered, ordered, checkboxes — with nesting support)
  html = parseLists(html)

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split('|').map(c => c.trim())
    if (cells.every(c => /^-+$/.test(c))) return ''
    const tag = 'td'
    return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>'
  })
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')

  // Paragraphs — wrap remaining text lines
  html = html.replace(/^(?!<[a-z/])((?!^\s*$).+)$/gm, '<p>$1</p>')

  // Clean up empty lines
  html = html.replace(/\n{3,}/g, '\n\n')

  return html
}

export default function MarkdownViewer({ content }) {
  const html = useMemo(() => simpleMarkdown(content || ''), [content])

  return (
    <div
      className="markdown-viewer"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
