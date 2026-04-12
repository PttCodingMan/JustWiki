import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom'
import KeyboardShortcuts from './useKeyboard'

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn(),
    useLocation: vi.fn(),
  }
})

describe('KeyboardShortcuts Component', () => {
  const mockNavigate = vi.fn()
  const onOpenSearch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useNavigate.mockReturnValue(mockNavigate)
    useLocation.mockReturnValue({ pathname: '/page/test-page' })
  })

  it('navigates to /new on Ctrl+N', () => {
    render(
      <MemoryRouter>
        <KeyboardShortcuts onOpenSearch={onOpenSearch} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(mockNavigate).toHaveBeenCalledWith('/new')
  })

  it('calls onOpenSearch on Ctrl+K', () => {
    render(
      <MemoryRouter>
        <KeyboardShortcuts onOpenSearch={onOpenSearch} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(onOpenSearch).toHaveBeenCalled()
  })

  it('navigates to edit page on Ctrl+E from view page', () => {
    render(
      <MemoryRouter>
        <KeyboardShortcuts onOpenSearch={onOpenSearch} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(mockNavigate).toHaveBeenCalledWith('/page/test-page/edit')
  })

  it('navigates to view page on Ctrl+E from edit page', () => {
    useLocation.mockReturnValue({ pathname: '/page/test-page/edit' })
    
    render(
      <MemoryRouter>
        <KeyboardShortcuts onOpenSearch={onOpenSearch} />
      </MemoryRouter>
    )

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(mockNavigate).toHaveBeenCalledWith('/page/test-page')
  })
})
