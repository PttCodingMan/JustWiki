import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { findAndReplace } from 'mdast-util-find-and-replace'

// Same regexes the production plugin uses. Duplicated here so this test
// stays parser-only (no Milkdown runtime).
const _NAME = '[A-Za-z0-9][A-Za-z0-9_-]*'
const GROUP_MENTION_RE = new RegExp(`(^|[^A-Za-z0-9_@/])@@(${_NAME})`, 'g')
const USER_MENTION_RE = new RegExp(`(^|[^A-Za-z0-9_@/])@(?!@)(${_NAME})`, 'g')

function remarkMentionPlugin() {
  const data = this.data()
  const toMarkdownExtensions =
    data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
  toMarkdownExtensions.push({
    handlers: {
      mention(node) {
        const sigil = node.group ? '@@' : '@'
        return `${sigil}${node.name || ''}`
      },
    },
    unsafe: [{ character: '@', inConstruct: ['phrasing'] }],
  })
  return (tree) => {
    findAndReplace(tree, [
      [
        GROUP_MENTION_RE,
        (_m, lead, name) => [
          { type: 'text', value: lead },
          { type: 'mention', name: name.trim(), group: true, data: { hName: 'span' } },
        ],
      ],
      [
        USER_MENTION_RE,
        (_m, lead, name) => [
          { type: 'text', value: lead },
          { type: 'mention', name: name.trim(), group: false, data: { hName: 'span' } },
        ],
      ],
    ])
  }
}

function parseTree(md) {
  const processor = unified().use(remarkParse).use(remarkMentionPlugin)
  return processor.runSync(processor.parse(md))
}

function roundtrip(md) {
  return unified()
    .use(remarkParse)
    .use(remarkMentionPlugin)
    .use(remarkStringify)
    .processSync(md)
    .toString()
    .trimEnd()
}

function findMentions(tree) {
  const out = []
  function walk(node) {
    if (node.type === 'mention') out.push(node)
    if (node.children) node.children.forEach(walk)
  }
  walk(tree)
  return out
}

describe('remarkMention', () => {
  it('parses @user as a user mention', () => {
    const mentions = findMentions(parseTree('hello @alice'))
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({ name: 'alice', group: false })
  })

  it('parses @@group as a group mention', () => {
    const mentions = findMentions(parseTree('cc @@team-x please'))
    expect(mentions).toHaveLength(1)
    expect(mentions[0]).toMatchObject({ name: 'team-x', group: true })
  })

  it('does not parse @ inside an email address', () => {
    const mentions = findMentions(parseTree('mail foo@bar.com'))
    expect(mentions).toHaveLength(0)
  })

  it('handles user and group on the same line', () => {
    const mentions = findMentions(parseTree('@alice and @@team'))
    const names = mentions.map((m) => `${m.group ? '@@' : '@'}${m.name}`)
    expect(names).toContain('@alice')
    expect(names).toContain('@@team')
  })

  it('does not parse @ after a URL slash', () => {
    const mentions = findMentions(parseTree('https://github.com/@octocat'))
    expect(mentions).toHaveLength(0)
  })

  it('rejects leading-hyphen names', () => {
    const mentions = findMentions(parseTree('hi @-bob there'))
    expect(mentions).toHaveLength(0)
  })

  it('skips @@@triple-at noise', () => {
    const mentions = findMentions(parseTree('foo @@@bob bar'))
    expect(mentions).toHaveLength(0)
  })

  it('round-trips @user without mangling', () => {
    expect(roundtrip('hello @alice today')).toBe('hello @alice today')
  })

  it('round-trips @@group without mangling', () => {
    expect(roundtrip('cc @@team-x review')).toBe('cc @@team-x review')
  })
})
