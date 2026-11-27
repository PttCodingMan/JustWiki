import { describe, it, expect } from 'vitest'
import DOMPurify from 'dompurify'
import { sanitizeDiagramSvg } from './diagramSvg'

const EVIL =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">' +
  '<style>body{display:none}</style>' +
  '<a href="https://evil.example/"><rect class="drawio-lightbox-overlay" ' +
  'style="position:fixed;top:0;left:0;fill:red" width="100" height="50"/></a>' +
  '<text x="5" y="20" onclick="alert(1)">hi</text>' +
  '<script>alert(1)</script></svg>'

describe('sanitizeDiagramSvg', () => {
  const out = sanitizeDiagramSvg(EVIL)

  it('drops document-wide <style> and links', () => {
    expect(out).not.toMatch(/<style/i)
    expect(out).not.toMatch(/<a[\s>]/i)
    expect(out).not.toContain('evil.example')
  })

  it('drops class and CSS position, keeps other styling', () => {
    expect(out).not.toContain('class=')
    expect(out).not.toMatch(/position/i)
    expect(out).toContain('fill: red')
  })

  it('still removes scripts and handlers, keeps the drawing', () => {
    expect(out).not.toMatch(/script|onclick/i)
    expect(out).toContain('<rect')
    expect(out).toContain('>hi</text>')
  })

  it('does not leak its hooks into the shared DOMPurify instance', () => {
    const shared = DOMPurify.sanitize('<p style="position:fixed">x</p>')
    expect(shared).toContain('position')
  })

  it('handles empty input', () => {
    expect(sanitizeDiagramSvg('')).toBe('')
    expect(sanitizeDiagramSvg(null)).toBe('')
  })
})
