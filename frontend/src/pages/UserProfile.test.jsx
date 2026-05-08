import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Each test sets `currentProfile` (returned by GET /users/{username}/profile)
// and `currentUser` (the logged-in viewer in the auth store).
let currentProfile = null
let currentUser = null

vi.mock('../store/useAuth', () => ({
  // Match the real zustand selector signature: useAuth((s) => s.user).
  default: (selector) => (selector ? selector({ user: currentUser }) : { user: currentUser }),
}))

// Stub MarkdownViewer to a div carrying the raw bio so assertions don't need
// to traverse the markdown pipeline (which is exercised in markdown.test.js).
vi.mock('../components/Viewer/MarkdownViewer', () => ({
  default: ({ content }) => React.createElement('div', { 'data-testid': 'bio-viewer' }, content),
}))

// i18n hook returns the key verbatim — the suite asserts on logical labels,
// not on translated strings, which keeps these tests locale-agnostic.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) return opts.defaultValue
      return key
    },
  }),
}))

// vi.mock factories are hoisted above all top-level statements, so the mock
// itself can't close over a top-level `apiMock` variable. Instead we declare
// the spies inside the factory and re-import the module to grab them.
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

import api from '../api/client'
const apiMock = api
import UserProfile from './UserProfile'

function renderAt(username) {
  return render(
    <MemoryRouter initialEntries={[`/u/${username}`]}>
      <Routes>
        <Route path="/u/:username" element={<UserProfile />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.put.mockReset()
  apiMock.get.mockImplementation(async () => ({ data: currentProfile }))
  apiMock.put.mockImplementation(async (_url, body) => ({
    data: { ...currentProfile, bio: body.bio },
  }))
  currentProfile = null
  currentUser = null
})

describe('UserProfile — inline bio edit', () => {
  it('owner with empty bio sees an add-intro prompt and can save a new bio', async () => {
    currentUser = { username: 'alice', anonymous: false }
    currentProfile = {
      username: 'alice',
      display_name: 'Alice',
      role: 'editor',
      bio: '',
      created_at: '2026-01-01 00:00:00',
      recent_activity: [],
    }

    renderAt('alice')

    // Empty-bio prompt is the click target — both visible and clickable.
    const prompt = await screen.findByText('userProfile.bio.addPrompt')
    fireEvent.click(prompt)

    const textarea = await screen.findByPlaceholderText('userProfile.bio.placeholder')
    fireEvent.change(textarea, { target: { value: 'Hi I am new here.' } })

    fireEvent.click(screen.getByText('userProfile.bio.save'))

    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/auth/profile', { bio: 'Hi I am new here.' }),
    )
    // Rendered bio (via the stubbed MarkdownViewer) reflects the saved value
    // and the editor exited.
    const viewer = await screen.findByTestId('bio-viewer')
    expect(viewer).toHaveTextContent('Hi I am new here.')
    expect(screen.queryByPlaceholderText('userProfile.bio.placeholder')).toBeNull()
  })

  it('owner with existing bio sees an Edit button and cancel reverts', async () => {
    currentUser = { username: 'alice', anonymous: false }
    currentProfile = {
      username: 'alice',
      display_name: 'Alice',
      role: 'editor',
      bio: 'original',
      created_at: '2026-01-01 00:00:00',
      recent_activity: [],
    }

    renderAt('alice')

    const editBtn = await screen.findByText('userProfile.bio.edit')
    fireEvent.click(editBtn)

    const textarea = await screen.findByPlaceholderText('userProfile.bio.placeholder')
    fireEvent.change(textarea, { target: { value: 'changed' } })

    fireEvent.click(screen.getByText('userProfile.bio.cancel'))

    // No PUT fired and the rendered bio is back to the original.
    expect(apiMock.put).not.toHaveBeenCalled()
    const viewer = await screen.findByTestId('bio-viewer')
    expect(viewer).toHaveTextContent('original')
  })

  it('visitor sees the bio but no edit affordance', async () => {
    currentUser = { username: 'bob', anonymous: false }
    currentProfile = {
      username: 'alice',
      display_name: 'Alice',
      role: 'editor',
      bio: 'Alice intro',
      created_at: '2026-01-01 00:00:00',
      recent_activity: [],
    }

    renderAt('alice')

    const viewer = await screen.findByTestId('bio-viewer')
    expect(viewer).toHaveTextContent('Alice intro')
    expect(screen.queryByText('userProfile.bio.edit')).toBeNull()
    expect(screen.queryByText('userProfile.bio.addPrompt')).toBeNull()
  })

  it('visitor on a user with empty bio sees no bio card at all', async () => {
    currentUser = { username: 'bob', anonymous: false }
    currentProfile = {
      username: 'alice',
      display_name: 'Alice',
      role: 'editor',
      bio: '',
      created_at: '2026-01-01 00:00:00',
      recent_activity: [],
    }

    renderAt('alice')

    // Wait for the page to settle, then assert neither the heading nor an
    // empty-state prompt is in the DOM.
    await screen.findByText('Alice')
    expect(screen.queryByText('userProfile.about')).toBeNull()
    expect(screen.queryByText('userProfile.bio.addPrompt')).toBeNull()
  })

  it('anonymous viewer on their own username does not get the editor', async () => {
    // Guards against a guest being treated as the owner of "guest".
    currentUser = { username: 'alice', anonymous: true }
    currentProfile = {
      username: 'alice',
      display_name: 'Alice',
      role: 'editor',
      bio: 'public bio',
      created_at: '2026-01-01 00:00:00',
      recent_activity: [],
    }

    renderAt('alice')

    await screen.findByTestId('bio-viewer')
    expect(screen.queryByText('userProfile.bio.edit')).toBeNull()
  })
})
