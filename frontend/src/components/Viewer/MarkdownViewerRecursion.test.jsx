import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarkdownViewer from './MarkdownViewer'
import api from '../../api/client'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

vi.mock('../../lib/mermaidBootstrap', () => ({
  ensureMermaid: vi.fn(() => ({
    render: vi.fn(() => Promise.resolve({ svg: '<svg>mermaid</svg>' })),
  })),
}))

function renderViewer(props) {
  return render(
    <MemoryRouter>
      <MarkdownViewer {...props} />
    </MemoryRouter>,
  )
}

function pageResponse(content) {
  return Promise.resolve({ data: { content_md: content } })
}

function httpError(status) {
  const err = new Error(`HTTP ${status}`)
  err.response = { status }
  return Promise.reject(err)
}

describe('MarkdownViewer transclusion recursion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads nested transclusions A → B → C', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/pages/B') return pageResponse('B body ![[C]]')
      if (url === '/pages/C') return pageResponse('C body content')
      return httpError(404)
    })

    const { container } = renderViewer({ content: 'A header ![[B]]' })

    await waitFor(() => {
      expect(container.textContent).toContain('B body')
      expect(container.textContent).toContain('C body content')
    })
  })

  it('detects self-cycle A → A', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/pages/A') return pageResponse('A self ![[A]]')
      return httpError(404)
    })

    const { container } = renderViewer({ content: '![[A]]' })

    await waitFor(() => {
      expect(container.textContent).toContain('(circular transclusion)')
    })
  })

  it('detects mutual cycle A → B → A', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/pages/A') return pageResponse('![[B]]')
      if (url === '/pages/B') return pageResponse('![[A]]')
      return httpError(404)
    })

    const { container } = renderViewer({ content: '![[A]]' })

    await waitFor(() => {
      expect(container.textContent).toContain('(circular transclusion)')
    })
  })

  it('stops a runaway chain at max depth', async () => {
    // Each page transcludes the next letter. Without a cap this is unbounded;
    // assert the cap fires and surfaces the message.
    api.get.mockImplementation((url) => {
      const slug = url.split('/').pop()
      const next = String.fromCharCode(slug.charCodeAt(0) + 1)
      return pageResponse(`level ${slug} ![[${next}]]`)
    })

    const { container } = renderViewer({ content: '![[A]]' })

    await waitFor(() => {
      expect(container.textContent).toContain('(max transclusion depth reached)')
    })
    // The cap fires once on the deepest unrendered placeholder, not on every
    // intermediate level.
    expect(container.textContent.match(/max transclusion depth/g)).toHaveLength(1)
  })

  it('loads sibling transclusions of the same slug independently', async () => {
    // Two separate ![[B]] occurrences: per-path visited means both must load,
    // not get deduped into a single render.
    api.get.mockImplementation((url) => {
      if (url === '/pages/B') return pageResponse('shared B body')
      return httpError(404)
    })

    const { container } = renderViewer({ content: '![[B]]\n\n![[B]]' })

    await waitFor(() => {
      const bodies = container.querySelectorAll('.transclusion-content')
      expect(bodies.length).toBe(2)
      bodies.forEach((el) => {
        expect(el.textContent).toContain('shared B body')
      })
    })
  })

  it('renders Mermaid and Draw.io inside transcluded content', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/pages/B') {
        return pageResponse('::drawio[42]\n\n```mermaid\ngraph TD\nA-->B\n```')
      }
      if (url === '/diagrams/42') {
        return Promise.resolve({ data: { svg_cache: '<svg>diagram-42</svg>' } })
      }
      return httpError(404)
    })

    const { container } = renderViewer({ content: '![[B]]' })

    await waitFor(() => {
      const drawio = container.querySelector('[data-diagram-id="42"]')
      expect(drawio).not.toBeNull()
      // The recursive renderDiagramsIn call should replace the placeholder
      // with the resolved SVG even though the diagram lives inside a
      // transcluded subtree.
      expect(drawio.querySelector('.drawio-svg')).not.toBeNull()
      expect(container.querySelector('[data-mermaid]')).not.toBeNull()
    })
  })

  it('shows distinct messages for 404, 403, and other errors', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/pages/missing') return httpError(404)
      if (url === '/pages/forbidden') return httpError(403)
      if (url === '/pages/broken') return httpError(500)
      return httpError(404)
    })

    const { container } = renderViewer({
      content: '![[missing]]\n\n![[forbidden]]\n\n![[broken]]',
    })

    await waitFor(() => {
      const text = container.textContent
      expect(text).toContain('Page not found')
      expect(text).toContain('(no access)')
      expect(text).toContain('Failed to load transclusion')
    })
  })
})
