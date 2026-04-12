import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Mock the public axios client — we never want real HTTP in unit tests.
vi.mock('../api/publicClient', () => ({
  default: {
    get: vi.fn(),
  },
}))

// Stub ThemeSwitcher so the test doesn't depend on the theme store.
vi.mock('../components/ThemeSwitcher', () => ({
  default: () => React.createElement('div', { 'data-testid': 'theme-switcher' }),
}))

// Skip MarkdownViewer's real rendering pipeline (mermaid/katex/DOMPurify heavy);
// we're asserting page chrome, not markdown fidelity, and the real component
// imports mermaid which doesn't play nicely with jsdom. Using React.createElement
// rather than JSX inside the vi.mock factory to avoid any transform ordering
// surprises.
vi.mock('../components/Viewer/MarkdownViewer', () => ({
  default: ({ content, publicMode, diagrams }) =>
    React.createElement(
      'div',
      { 'data-testid': 'md-viewer', 'data-public-mode': String(!!publicMode) },
      React.createElement('span', { 'data-testid': 'md-content' }, content),
      React.createElement(
        'span',
        { 'data-testid': 'md-diagrams' },
        JSON.stringify(diagrams || {}),
      ),
    ),
}))

import publicApi from '../api/publicClient'
import PublicPageView from './PublicPageView'

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/public/page/${slug}`]}>
      <Routes>
        <Route path="/public/page/:slug" element={<PublicPageView />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicPageView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clean up any meta tags injected by previous renders.
    document.head
      .querySelectorAll('meta[name="robots"], meta[name="referrer"]')
      .forEach((el) => el.remove())
  })

  it('renders title, author, content from the public endpoint', async () => {
    publicApi.get.mockResolvedValueOnce({
      data: {
        slug: 'hello',
        title: 'Hello World',
        content_md: '# hi',
        updated_at: '2026-04-01T00:00:00Z',
        author_name: 'Alice',
        diagrams: {},
      },
    })

    renderAt('hello')

    expect(await screen.findByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByTestId('md-content').textContent).toBe('# hi')
    expect(screen.getByTestId('md-viewer').dataset.publicMode).toBe('true')
  })

  it('does not render edit/comments/sidebar/backlinks chrome', async () => {
    publicApi.get.mockResolvedValueOnce({
      data: {
        slug: 'hello',
        title: 'Hello',
        content_md: '',
        updated_at: '2026-04-01T00:00:00Z',
        author_name: null,
        diagrams: {},
      },
    })

    renderAt('hello')
    await screen.findByText('Hello')

    // None of these authenticated-only pieces should appear
    expect(screen.queryByText(/comment/i)).toBeNull()
    expect(screen.queryByText(/backlink/i)).toBeNull()
    expect(screen.queryByText(/Linked from/i)).toBeNull()
    expect(screen.queryByText(/Edit/)).toBeNull()
    expect(screen.queryByText(/Watch/)).toBeNull()
    expect(screen.queryByText(/Bookmark/)).toBeNull()
  })

  it('injects noindex and same-origin referrer meta tags', async () => {
    publicApi.get.mockResolvedValueOnce({
      data: {
        slug: 'hello',
        title: 'Hello',
        content_md: '',
        updated_at: '2026-04-01T00:00:00Z',
        author_name: null,
        diagrams: {},
      },
    })

    renderAt('hello')
    await screen.findByText('Hello')

    const robots = document.head.querySelector('meta[name="robots"]')
    const referrer = document.head.querySelector('meta[name="referrer"]')
    expect(robots?.getAttribute('content')).toBe('noindex, nofollow')
    expect(referrer?.getAttribute('content')).toBe('same-origin')
  })

  it('shows a not-found screen when the API rejects', async () => {
    publicApi.get.mockRejectedValueOnce(new Error('404'))
    renderAt('missing')
    await waitFor(() => {
      expect(screen.getByText(/Page not found/)).toBeInTheDocument()
    })
    expect(screen.getByText(/This page is not available/)).toBeInTheDocument()
  })

  it('passes the diagrams prop through to MarkdownViewer', async () => {
    publicApi.get.mockResolvedValueOnce({
      data: {
        slug: 'hello',
        title: 'Hello',
        content_md: '',
        updated_at: '2026-04-01T00:00:00Z',
        author_name: null,
        diagrams: { '42': '<svg>yo</svg>' },
      },
    })

    renderAt('hello')
    await screen.findByText('Hello')

    expect(screen.getByTestId('md-diagrams').textContent).toContain('42')
    expect(screen.getByTestId('md-diagrams').textContent).toContain('svg')
  })
})
