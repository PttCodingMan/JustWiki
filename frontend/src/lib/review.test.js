import { describe, it, expect } from 'vitest'
import i18n from '../i18n'
import { parseUtc, reviewDueText } from './review'

const t = i18n.getFixedT('en')

describe('review helpers', () => {
  it('parses SQLite timestamps as UTC', () => {
    expect(parseUtc('2026-01-02 03:04:05').toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect(parseUtc(null)).toBeNull()
    expect(parseUtc('garbage')).toBeNull()
  })

  it('describes due / overdue state', () => {
    expect(reviewDueText(t, { status: 'ok', days_left: 30 })).toBe('review due in 30 days')
    expect(reviewDueText(t, { status: 'due_soon', days_left: 1 })).toBe('review due in 1 day')
    expect(reviewDueText(t, { status: 'overdue', days_left: -4 })).toBe('review overdue by 4 days')
    // Defensive: never show "overdue by 0 days".
    expect(reviewDueText(t, { status: 'overdue', days_left: 0 })).toBe('review overdue by 1 day')
  })
})
