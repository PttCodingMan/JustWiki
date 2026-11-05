import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import useUnsavedWarning, { confirmLeave, useGuardedNavigate } from './useUnsavedWarning'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: vi.fn() }
})

function DirtyEditor({ dirty }) {
  useUnsavedWarning(dirty, 'discard?')
  return null
}

function NewPageButton() {
  const navigate = useGuardedNavigate()
  return <button onClick={() => navigate('/new')}>new</button>
}

describe('unsaved-changes guard for programmatic navigation', () => {
  const mockNavigate = vi.fn()

  beforeEach(() => {
    useNavigate.mockReturnValue(mockNavigate)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockNavigate.mockReset()
  })

  it('confirmLeave passes without prompting when nothing is dirty', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { unmount } = render(<DirtyEditor dirty={false} />)
    expect(confirmLeave()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
    unmount()
  })

  it('asks before navigating while an editor is dirty, and stays on cancel', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { getByText, unmount } = render(
      <MemoryRouter>
        <DirtyEditor dirty />
        <NewPageButton />
      </MemoryRouter>
    )
    fireEvent.click(getByText('new'))
    expect(confirmSpy).toHaveBeenCalledWith('discard?')
    expect(mockNavigate).not.toHaveBeenCalled()
    unmount()
  })

  it('navigates when the user accepts the prompt', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { getByText, unmount } = render(
      <MemoryRouter>
        <DirtyEditor dirty />
        <NewPageButton />
      </MemoryRouter>
    )
    fireEvent.click(getByText('new'))
    expect(mockNavigate).toHaveBeenCalledWith('/new')
    unmount()
  })

  it('releases the guard when the editor unmounts', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { unmount } = render(<DirtyEditor dirty />)
    unmount()
    expect(confirmLeave()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
