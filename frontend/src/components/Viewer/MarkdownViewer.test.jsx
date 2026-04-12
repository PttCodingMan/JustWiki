import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Authed client: if publicMode works right, these tests must NOT see any
// requests. We still mock it so an accidental call throws a clear error.
vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn(() => Promise.reject(new Error('authed API must not be called in publicMode'))),
  },
}))

// Mermaid: its initializer touches document.documentElement on import; in jsdom
// it's loaded but we don't assert on diagram rendering here, so leave it alone.

import MarkdownViewer from './MarkdownViewer'
import api from '../../api/client'

function renderViewer(props) {
  return render(
    <MemoryRouter>
      <MarkdownViewer {...props} />
    </MemoryRouter>,
  )
}

describe('MarkdownViewer publicMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds rel="nofollow" to wikilinks in publicMode', async () => {
    const { container } = renderViewer({
      content: 'See [[hello]] for more',
      publicMode: true,
    })

    await waitFor(() => {
      const link = container.querySelector('a.wikilink')
      expect(link).not.toBeNull()
      expect(link.getAttribute('rel')).toBe('nofollow')
    })
  })

  it('does not add rel="nofollow" to wikilinks in normal mode', async () => {
    const { container } = renderViewer({
      content: 'See [[hello]] for more',
    })

    // Let effects settle; nothing should annotate the wikilink.
    await waitFor(() => {
      expect(container.querySelector('a.wikilink')).not.toBeNull()
    })
    const link = container.querySelector('a.wikilink')
    expect(link.getAttribute('rel')).toBeNull()
  })

  it('renders transclusion as a placeholder in publicMode (no API call)', async () => {
    const { container } = renderViewer({
      content: '![[other-page]]',
      publicMode: true,
    })

    await waitFor(() => {
      const placeholder = container.querySelector('[data-transclude]')
      expect(placeholder).not.toBeNull()
      expect(placeholder.textContent).toMatch(/transclusion disabled/i)
    })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('renders drawio diagrams from the diagrams prop in publicMode', async () => {
    const { container } = renderViewer({
      content: '::drawio[42]',
      publicMode: true,
      diagrams: { '42': '<svg><text>yo</text></svg>' },
    })

    await waitFor(() => {
      const svg = container.querySelector('[data-diagram-id="42"] .drawio-svg')
      expect(svg).not.toBeNull()
    })
    expect(api.get).not.toHaveBeenCalled()
  })

  it('shows an "unavailable" placeholder when a drawio id has no SVG in publicMode', async () => {
    const { container } = renderViewer({
      content: '::drawio[99]',
      publicMode: true,
      diagrams: {},
    })

    await waitFor(() => {
      const block = container.querySelector('[data-diagram-id="99"]')
      expect(block).not.toBeNull()
      expect(block.textContent).toMatch(/unavailable/i)
    })
    expect(api.get).not.toHaveBeenCalled()
  })
})
