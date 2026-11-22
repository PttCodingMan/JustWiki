import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PasswordInput from './PasswordInput'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}))

describe('PasswordInput', () => {
  it('starts masked and toggles visibility', () => {
    render(<PasswordInput aria-label="pw" defaultValue="secret" />)
    const input = screen.getByLabelText('pw')
    expect(input).toHaveAttribute('type', 'password')

    const toggle = screen.getByRole('button', { name: 'common.showPassword' })
    expect(toggle).toHaveAttribute('type', 'button')
    fireEvent.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'common.hidePassword' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.hidePassword' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('forwards props and keeps input styling', () => {
    render(<PasswordInput id="x" className="foo" wrapperClassName="flex-1" autoComplete="current-password" />)
    const input = document.getElementById('x')
    expect(input).toHaveClass('foo', 'pr-10')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
    expect(input.parentElement).toHaveClass('relative', 'flex-1')
  })

  it('does not submit the surrounding form when toggled', () => {
    const onSubmit = vi.fn((e) => e.preventDefault())
    render(<form onSubmit={onSubmit}><PasswordInput /></form>)
    fireEvent.click(screen.getByRole('button', { name: 'common.showPassword' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
