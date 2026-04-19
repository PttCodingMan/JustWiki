import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { findAndReplace } from 'mdast-util-find-and-replace'

const WIKILINK_RE = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g

function remarkWikilinkPlugin() {
  const data = this.data()
  const toMarkdownExtensions =
    data.toMarkdownExtensions || (data.toMarkdownExtensions = [])

  toMarkdownExtensions.push({
    handlers: {
      wikilink(node) {
        const slug = node.slug || ''
        const display = node.display ? `|${node.display}` : ''
        const prefix = node.transclusion ? '!' : ''
        return `${prefix}[[${slug}${display}]]`
      },
    },
    unsafe: [{ character: '[', inConstruct: ['phrasing'] }],
  })

  return (tree) => {
    findAndReplace(tree, [
      [
        WIKILINK_RE,
        (_match, bang, slug, display) => ({
          type: 'wikilink',
          slug: slug.trim(),
          display: (display || '').trim(),
          transclusion: bang === '!',
          data: { hName: 'span' },
        }),
      ],
    ])
  }
}

function roundtrip(md) {
  return unified()
    .use(remarkParse)
    .use(remarkWikilinkPlugin)
    .use(remarkStringify)
    .processSync(md)
    .toString()
    .trimEnd()
}

function parseTree(md) {
  const processor = unified().use(remarkParse).use(remarkWikilinkPlugin)
  return processor.runSync(processor.parse(md))
}

describe('remarkWikilink', () => {
  it('parses [[slug]] into a wikilink node', () => {
    const tree = parseTree('see [[welcome]].')
    const para = tree.children[0]
    const wikilink = para.children.find((c) => c.type === 'wikilink')
    expect(wikilink).toBeDefined()
    expect(wikilink.slug).toBe('welcome')
    expect(wikilink.display).toBe('')
    expect(wikilink.transclusion).toBe(false)
  })

  it('parses [[slug|display]] with display text', () => {
    const tree = parseTree('[[welcome|Hello]]')
    const wikilink = tree.children[0].children[0]
    expect(wikilink.slug).toBe('welcome')
    expect(wikilink.display).toBe('Hello')
    expect(wikilink.transclusion).toBe(false)
  })

  it('parses ![[slug]] as transclusion', () => {
    const tree = parseTree('![[embed-me]]')
    const wikilink = tree.children[0].children[0]
    expect(wikilink.slug).toBe('embed-me')
    expect(wikilink.transclusion).toBe(true)
  })

  it('preserves CJK slugs', () => {
    const tree = parseTree('[[早餐清單]]')
    const wikilink = tree.children[0].children[0]
    expect(wikilink.slug).toBe('早餐清單')
  })

  it('trims whitespace inside brackets', () => {
    const tree = parseTree('[[ welcome-zh | 歡迎 ]]')
    const wikilink = tree.children[0].children[0]
    expect(wikilink.slug).toBe('welcome-zh')
    expect(wikilink.display).toBe('歡迎')
  })

  it('round-trips [[slug]] without escaping', () => {
    expect(roundtrip('see [[welcome]] please')).toBe(
      'see [[welcome]] please',
    )
  })

  it('round-trips [[slug|display]] without escaping', () => {
    expect(roundtrip('[[welcome|Hi]]')).toBe('[[welcome|Hi]]')
  })

  it('round-trips ![[slug]] transclusion', () => {
    expect(roundtrip('![[embed]]')).toBe('![[embed]]')
  })

  it('round-trips CJK slugs', () => {
    expect(roundtrip('前往 [[早餐清單|菜單]]')).toBe('前往 [[早餐清單|菜單]]')
  })

  it('leaves non-wikilink brackets alone', () => {
    const tree = parseTree('single [bracket] text')
    const wikilinks = tree.children[0].children.filter(
      (c) => c.type === 'wikilink',
    )
    expect(wikilinks).toHaveLength(0)
  })

  it('does not match across newlines', () => {
    const tree = parseTree('[[open\nclose]]')
    const wikilinks = []
    function walk(node) {
      if (node.type === 'wikilink') wikilinks.push(node)
      if (node.children) node.children.forEach(walk)
    }
    walk(tree)
    expect(wikilinks).toHaveLength(0)
  })

  it('handles multiple wikilinks in one paragraph', () => {
    expect(roundtrip('a [[one]] and [[two]] done')).toBe(
      'a [[one]] and [[two]] done',
    )
  })
})
