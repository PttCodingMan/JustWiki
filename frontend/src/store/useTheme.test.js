import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useTheme from './useTheme'

describe('useTheme Store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    
    // Reset document element
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-font')
    document.documentElement.classList.remove('dark')
  })

  it('should initialize with sand theme by default', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('sand')
  })

  it('should initialize with saved theme from localStorage', () => {
    localStorage.setItem('theme', 'dark')
    const { result } = renderHook(() => useTheme())
    // We need to call init because the store might have been created already in another test
    act(() => {
      result.current.init()
    })
    expect(result.current.theme).toBe('dark')
    expect(result.current.dark).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('should set theme and update localStorage and DOM', () => {
    const { result } = renderHook(() => useTheme())
    
    act(() => {
      result.current.setTheme('forest')
    })

    expect(result.current.theme).toBe('forest')
    expect(result.current.dark).toBe(true)
    expect(localStorage.getItem('theme')).toBe('forest')
    expect(document.documentElement.getAttribute('data-theme')).toBe('forest')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('should handle non-dark themes correctly', () => {
    const { result } = renderHook(() => useTheme())
    
    act(() => {
      result.current.setTheme('lavender')
    })

    expect(result.current.theme).toBe('lavender')
    expect(result.current.dark).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('lavender')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('should fallback to sand theme on init if saved theme is invalid', () => {
    localStorage.setItem('theme', 'invalid-theme')
    const { result } = renderHook(() => useTheme())
    
    act(() => {
      result.current.init()
    })

    expect(result.current.theme).toBe('sand')
    expect(document.documentElement.getAttribute('data-theme')).toBe('sand')
  })

  it('should default to the sans font on init', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.init()
    })
    expect(result.current.font).toBe('sans')
    expect(document.documentElement.getAttribute('data-font')).toBe('sans')
  })

  it('should set font and update localStorage and DOM', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setFont('jetbrains')
    })
    expect(result.current.font).toBe('jetbrains')
    expect(localStorage.getItem('font')).toBe('jetbrains')
    expect(document.documentElement.getAttribute('data-font')).toBe('jetbrains')
  })

  it('should ignore unknown fonts and fall back to sans on init', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setFont('plex')
      result.current.setFont('comic-sans')
    })
    expect(result.current.font).toBe('plex')

    localStorage.setItem('font', 'comic-sans')
    act(() => {
      result.current.init()
    })
    expect(result.current.font).toBe('sans')
    expect(document.documentElement.getAttribute('data-font')).toBe('sans')
  })
})
