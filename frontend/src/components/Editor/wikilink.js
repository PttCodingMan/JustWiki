import { $nodeSchema, $inputRule, $remark } from '@milkdown/kit/utils'
import { InputRule } from '@milkdown/prose/inputrules'
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

export const remarkWikilink = $remark('wikilink', () => remarkWikilinkPlugin)

export const wikilinkSchema = $nodeSchema('wikilink', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,
  attrs: {
    slug: { default: '', validate: 'string' },
    display: { default: '', validate: 'string' },
    transclusion: { default: false, validate: 'boolean' },
  },
  parseDOM: [
    {
      // Higher priority than the default link mark (a[href]) so a paste
      // roundtrip doesn't demote the wikilink node into a plain link mark.
      tag: 'a[data-wikilink]',
      priority: 60,
      getAttrs: (dom) => ({
        slug: dom.getAttribute('data-slug') || '',
        display: dom.getAttribute('data-display') || '',
        transclusion: dom.getAttribute('data-transclusion') === 'true',
      }),
    },
  ],
  toDOM: (node) => {
    const { slug, display, transclusion } = node.attrs
    const label = display || slug
    const text = transclusion ? `\u{1F4C4} ${label}` : label
    return [
      'a',
      {
        class:
          'wikilink-node' + (transclusion ? ' wikilink-transclusion' : ''),
        'data-wikilink': 'true',
        'data-slug': slug,
        'data-display': display,
        'data-transclusion': String(transclusion),
        href: `/page/${encodeURIComponent(slug)}`,
        contenteditable: 'false',
      },
      text,
    ]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'wikilink',
    runner: (state, node, type) => {
      state.addNode(type, {
        slug: node.slug || '',
        display: node.display || '',
        transclusion: !!node.transclusion,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'wikilink',
    runner: (state, node) => {
      state.addNode('wikilink', undefined, undefined, {
        slug: node.attrs.slug,
        display: node.attrs.display,
        transclusion: node.attrs.transclusion,
      })
    },
  },
}))

export const wikilinkInputRule = $inputRule(
  (ctx) =>
    new InputRule(
      /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]$/,
      (state, match, start, end) => {
        const [, bang, slug, display] = match
        const node = wikilinkSchema.type(ctx).create({
          slug: slug.trim(),
          display: (display || '').trim(),
          transclusion: bang === '!',
        })
        return state.tr.replaceWith(start, end, node)
      },
    ),
)

export const wikilink = [
  ...remarkWikilink,
  wikilinkSchema,
  wikilinkInputRule,
].flat()
