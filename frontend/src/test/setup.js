import '@testing-library/jest-dom'
import { vi } from 'vitest'
// Initialize i18n with English so components using useTranslation render
// real strings under test instead of returning translation keys.
import i18n from '../i18n'
i18n.changeLanguage('en')

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString()
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    length: 0,
    key: vi.fn((i) => Object.keys(store)[i] || null),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// jsdom ships without a canvas implementation — calling `getContext('2d')`
// prints a noisy "Not implemented" warning even though our code handles the
// null return. Stub it so the mindmap layout's measureText falls back to the
// char-count estimator cleanly.
HTMLCanvasElement.prototype.getContext = () => null

// Mock any global browser APIs if needed
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
