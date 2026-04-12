import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

describe('Sidebar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Default mock implementation
    usePages.mockReturnValue({
      tree: [
        { id: 1, title: 'Root Page', slug: 'root', children: [] },
        { id: 2, title: 'Parent Page', slug: 'parent', children: [
          { id: 3, title: 'Child Page', slug: 'child', children: [] }
        ]}
      ],
      movePage: vi.fn(),
    })
    
    useBookmarks.mockReturnValue({
      bookmarks: [
        { id: 1, title: 'Bookmarked Page', slug: 'bookmarked' }
      ],
    })
    
    useAuth.mockReturnValue({
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
    useAuth.mockReturnValue({
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
})
