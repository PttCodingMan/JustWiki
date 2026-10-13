import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useAuth from '../../store/useAuth'

// Mock the stores
vi.mock('../../store/usePages', () => ({
  default: vi.fn(),
}))
vi.mock('../../store/useBookmarks', () => ({
  default: vi.fn(),
}))
vi.mock('../../store/useAuth', () => ({
  default: vi.fn(),
}))

// The components read stores through selectors (`useX((s) => s.field)`),
// so the mocks must apply the selector to the fake state.
const mockStore = (hook, state) => hook.mockImplementation((sel) => (sel ? sel(state) : state))

describe('Sidebar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Default mock implementation
    mockStore(usePages, {
      tree: [
        { id: 1, title: 'Root Page', slug: 'root', children: [] },
        { id: 2, title: 'Parent Page', slug: 'parent', children: [
          { id: 3, title: 'Child Page', slug: 'child', children: [] }
        ]}
      ],
      movePage: vi.fn(),
      deletePage: vi.fn(),
      fetchTree: vi.fn(),
    })
    
    mockStore(useBookmarks, {
      bookmarks: [
        { id: 1, title: 'Bookmarked Page', slug: 'bookmarked' }
      ],
    })
    
    mockStore(useAuth, {
      user: { role: 'admin' },
    })
  })

  it('renders quick links', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    
    expect(screen.getByText('Recent Changes')).toBeDefined()
    expect(screen.getByText('Graph View')).toBeDefined()
    expect(screen.getByText('Admin')).toBeDefined()
  })

  it('does not render admin link for non-admin user', () => {
    mockStore(useAuth, {
      user: { role: 'editor' },
    })
    
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    
    expect(screen.queryByText('Admin')).toBeNull()
  })

  it('renders bookmarks', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    
    expect(screen.getByText('Bookmarks')).toBeDefined()
    expect(screen.getByText('Bookmarked Page')).toBeDefined()
  })

  it('renders page tree', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    
    expect(screen.getByText('Pages')).toBeDefined()
    expect(screen.getByText('Root Page')).toBeDefined()
    expect(screen.getByText('Parent Page')).toBeDefined()
  })

  it('shows child pages when parent is expanded', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    // Parent Page should be visible
    const parentNode = screen.getByText('Parent Page')
    expect(parentNode).toBeDefined()

    // Child Page should be visible because depth < 1 or isActive is true
    // In TreeNode: const [expanded, setExpanded] = useState(isActive || depth < 1)
    // For Parent Page, depth is 0, so it's expanded by default.
    expect(screen.getByText('Child Page')).toBeDefined()
  })

  it('hides page action menus for viewers', () => {
    mockStore(useAuth, { user: { role: 'viewer' } })

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    // Editor/admin renders a "Page actions for <title>" button per tree
    // node. Viewers must not see any of them.
    expect(screen.queryAllByRole('button', { name: /Page actions for/i })).toHaveLength(0)
  })

  it('shows a page action menu with new/edit/delete for editors', () => {
    mockStore(useAuth, { user: { role: 'editor' } })

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    const menuButtons = screen.queryAllByRole('button', { name: /Page actions for/i })
    expect(menuButtons.length).toBeGreaterThan(0)

    fireEvent.click(menuButtons[0])
    expect(screen.getByRole('menuitem', { name: 'New subpage' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDefined()
  })

  it('expands the ancestors of a deeply nested active page', () => {
    mockStore(usePages, {
      tree: [
        { id: 10, title: 'Top', slug: 'top', children: [
          { id: 11, title: 'Middle', slug: 'middle', children: [
            { id: 12, title: 'Deep', slug: 'deep', children: [] },
          ] },
        ] },
        { id: 20, title: 'Other', slug: 'other', children: [
          { id: 21, title: 'Other Child', slug: 'other-child', children: [
            { id: 22, title: 'Hidden Grandchild', slug: 'hidden', children: [] },
          ] },
        ] },
      ],
      movePage: vi.fn(),
      deletePage: vi.fn(),
      fetchTree: vi.fn(),
    })

    render(
      <MemoryRouter initialEntries={['/page/deep']}>
        <Sidebar />
      </MemoryRouter>
    )

    // Middle (depth 1) is only expanded because it's on the active path.
    expect(screen.getByText('Deep')).toBeDefined()
    // Off-path depth-1 rows stay collapsed.
    expect(screen.getByText('Other Child')).toBeDefined()
    expect(screen.queryByText('Hidden Grandchild')).toBeNull()
  })

  it('closes the page action menu on an outside click', () => {
    mockStore(useAuth, { user: { role: 'editor' } })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    fireEvent.click(screen.getAllByRole('button', { name: /Page actions for/i })[0])
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDefined()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
  })

  it('opens the delete confirmation from the page action menu', () => {
    mockStore(useAuth, { user: { role: 'editor' } })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Page actions for/i })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByText('"Root Page"')).toBeDefined()
  })

  it('navigates on a plain click of a tree link, but leaves modified clicks to the browser', () => {
    const LocationProbe = () => <div data-testid="loc">{useLocation().pathname}</div>
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
        <LocationProbe />
      </MemoryRouter>
    )
    const link = screen.getByText('Child Page').closest('a')
    expect(link.getAttribute('href')).toBe('/page/child')

    // Ctrl/Cmd-click: not intercepted (browser opens a new tab).
    const ctrlClick = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(ctrlClick)
    expect(ctrlClick.defaultPrevented).toBe(false)
    expect(screen.getByTestId('loc').textContent).toBe('/')

    fireEvent.click(link)
    expect(screen.getByTestId('loc').textContent).toBe('/page/child')
  })
})
