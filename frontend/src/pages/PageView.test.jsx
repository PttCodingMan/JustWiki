import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Capture the page object that the store hands back so each test can
// override it (slug, content_md, permissions, etc.) via `currentPage`.
let currentPage = null

// Mock store hooks must return stable function references; PageView's load
// effect lists them in its dep array, so a fresh identity per render would
// retrigger the effect indefinitely (resetting `loading` back to true).
const pagesStore = {
  getPage: async () => currentPage,
  deletePage: async () => {},
  fetchTree: async () => {},
}
const tagsStore = {
  pageTags: [],
  fetchPageTags: async () => {},
  addTag: async () => {},
  removeTag: async () => {},
}
const bookmarksStore = {
  checkBookmark: async () => false,
  addBookmark: async () => {},
  removeBookmark: async () => {},
  fetchBookmarks: async () => {},
}
const authStore = { user: { id: 1, role: 'admin' } }

vi.mock('../store/usePages', () => ({ default: () => pagesStore }))
vi.mock('../store/useTags', () => ({ default: () => tagsStore }))
vi.mock('../store/useBookmarks', () => ({ default: () => bookmarksStore }))
vi.mock('../store/useAuth', () => ({ default: () => authStore }))

vi.mock('../store/usePermissions', () => ({
  default: (selector) => (selector ? selector({ seed: () => {} }) : { seed: () => {} }),
  canEdit: () => true,
  canManageAcl: () => true,
}))

vi.mock('../components/Viewer/MarkdownViewer', () => ({
  default: ({ content }) => React.createElement('div', { 'data-testid': 'md-viewer' }, content),
}))

vi.mock('../components/Viewer/TableOfContents', () => ({
  default: () => React.createElement('div', { 'data-testid': 'toc' }),
}))

vi.mock('../components/Comments', () => ({
  default: () => React.createElement('div', { 'data-testid': 'comments' }),
}))

vi.mock('../components/ConfirmDialog', () => ({
  default: () => null,
}))

vi.mock('../components/AclManager', () => ({
  default: () => null,
}))

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(async (url) => {
      if (url.endsWith('/backlinks')) return { data: [] }
      if (url.endsWith('/watch')) return { data: { watching: false, watcher_count: 0 } }
      return { data: {} }
    }),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  },
}))

import PageView from './PageView'

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/page/${slug}`]}>
      <Routes>
        <Route path="/page/:slug" element={<PageView />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openMenu() {
  // Two More-actions buttons are rendered (mobile + desktop dock); both
  // open menus that share state, so clicking either is sufficient.
  const buttons = await screen.findAllByTitle('More actions')
  fireEvent.click(buttons[0])
}

describe('PageView — Copy Markdown / Download .md', () => {
  beforeEach(() => {
    currentPage = {
      id: 1,
      slug: 'hello',
      title: 'Hello',
      content_md: '# Hello\n\nworld',
      view_count: 0,
      updated_at: '2026-04-01T00:00:00Z',
      author_name: 'Alice',
      version: 1,
      is_public: false,
      effective_permission: 'admin',
    }
  })

  it('writes page content_md to the clipboard and shows toast', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })

    renderAt('hello')
    await openMenu()

    const copyBtn = (await screen.findAllByText('Copy Markdown'))[0]
    fireEvent.click(copyBtn)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Hello\n\nworld'))
    expect(await screen.findByText('Markdown copied')).toBeInTheDocument()
  })

  it('strips raw <br /> tags when copying (Milkdown paste artifacts)', async () => {
    currentPage = {
      ...currentPage,
      content_md: 'Line 1<br />\nLine 2<br>Line 3',
    }
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })

    renderAt('hello')
    await openMenu()
    fireEvent.click((await screen.findAllByText('Copy Markdown'))[0])

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Line 1  \nLine 2  \nLine 3'),
    )
  })

  it('shows a fallback toast when clipboard write rejects', async () => {
    const writeText = vi.fn(async () => { throw new Error('not allowed') })
    Object.assign(navigator, { clipboard: { writeText } })

    renderAt('hello')
    await openMenu()

    fireEvent.click((await screen.findAllByText('Copy Markdown'))[0])

    expect(
      await screen.findByText(/Copy failed — clipboard requires HTTPS or localhost/),
    ).toBeInTheDocument()
  })

  it('triggers a Blob download named {slug}.md with the page markdown', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL

    // Capture the dynamically-created <a> so we can assert on its attributes
    // and confirm `.click()` was actually invoked.
    let createdAnchor = null
    const realCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        createdAnchor = el
        el.click = vi.fn()
      }
      return el
    })

    renderAt('hello')
    await openMenu()

    fireEvent.click((await screen.findAllByText('Download .md'))[0])

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    const blob = createObjectURL.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    // jsdom's Blob doesn't expose .text(); read via FileReader.
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    expect(text).toBe('# Hello\n\nworld')

    expect(createdAnchor).not.toBeNull()
    expect(createdAnchor.getAttribute('download')).toBe('hello.md')
    expect(createdAnchor.getAttribute('href')).toBe('blob:fake-url')
    expect(createdAnchor.click).toHaveBeenCalledTimes(1)
    // revoke is deferred via setTimeout(..., 0) to avoid cancelling the
    // download in browsers that start it asynchronously.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url'))

    createSpy.mockRestore()
  })

  it('preserves CJK slug in the download filename', async () => {
    currentPage = { ...currentPage, slug: '你好', content_md: 'CJK body' }

    URL.createObjectURL = vi.fn(() => 'blob:cjk')
    URL.revokeObjectURL = vi.fn()

    let createdAnchor = null
    const realCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag)
      if (tag === 'a') {
        createdAnchor = el
        el.click = vi.fn()
      }
      return el
    })

    renderAt('你好')
    await openMenu()
    fireEvent.click((await screen.findAllByText('Download .md'))[0])

    await waitFor(() => expect(createdAnchor?.getAttribute('download')).toBe('你好.md'))

    createSpy.mockRestore()
  })
})
