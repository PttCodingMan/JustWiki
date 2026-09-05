import { describe, it, expect } from 'vitest'
import { LINK_INPUT_RULE_RE } from './linkInputRule'

const match = (s) => s.match(LINK_INPUT_RULE_RE)

describe('link input rule pattern', () => {
  it('captures text and href', () => {
    const m = match('see [連結](https://example.com/a?b=1)')
    expect(m[1]).toBe('連結')
    expect(m[2]).toBe('https://example.com/a?b=1')
  })

  it('captures an optional title', () => {
    const m = match('[x](https://a.b "hi")')
    expect(m[2]).toBe('https://a.b')
    expect(m[3]).toBe('hi')
  })

  it('does not fire mid-typing before the closing paren', () => {
    expect(match('[連結](https://a.b')).toBeNull()
  })

  it('leaves wikilinks alone', () => {
    expect(match('[[some-page]]')).toBeNull()
  })
})
