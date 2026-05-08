import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import { findAndReplace } from 'mdast-util-find-and-replace'

// Group must be tested before user — `@@bob` is a group, never a user.
// Boundary class excludes alphanumeric/underscore/@/`/` so emails
// (`foo@bar`), URL paths (`github.com/@octo`), and `@@@bob` triple-at
// noise don't false-positive. Name must start with alphanumeric.
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
    // `@` is not a markdown construct, but listing it here keeps adjacent
    // text from accidentally smashing into the mention serialization.
    unsafe: [{ character: '@', inConstruct: ['phrasing'] }],
  })

  return (tree) => {
    // Order matters: group first so `@@x` doesn't get half-eaten by the
    // user pattern. `findAndReplace` keeps the leading boundary character
    // — we re-emit it as a plain text replacement that carries it back.
    findAndReplace(tree, [
      [
        GROUP_MENTION_RE,
        (_match, lead, name) => [
          { type: 'text', value: lead },
          {
            type: 'mention',
            name: name.trim(),
            group: true,
            data: { hName: 'span' },
          },
        ],
      ],
      [
        USER_MENTION_RE,
        (_match, lead, name) => [
          { type: 'text', value: lead },
          {
            type: 'mention',
            name: name.trim(),
            group: false,
            data: { hName: 'span' },
          },
        ],
      ],
    ])
  }
}

export const remarkMention = $remark('mention', () => remarkMentionPlugin)

export const mentionSchema = $nodeSchema('mention', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,
  attrs: {
    name: { default: '', validate: 'string' },
    group: { default: false, validate: 'boolean' },
  },
  parseDOM: [
    {
      tag: 'span[data-mention]',
      priority: 60,
      getAttrs: (dom) => ({
        name: dom.getAttribute('data-name') || '',
        group: dom.getAttribute('data-group-mention') === 'true',
      }),
    },
  ],
  toDOM: (node) => {
    const { name, group } = node.attrs
    const sigil = group ? '@@' : '@'
    const cls = 'mention ' + (group ? 'mention-group' : 'mention-user')
    return [
      'span',
      {
        class: cls,
        'data-mention': 'true',
        'data-name': name,
        'data-group-mention': String(group),
        contenteditable: 'false',
      },
      `${sigil}${name}`,
    ]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'mention',
    runner: (state, node, type) => {
      state.addNode(type, {
        name: node.name || '',
        group: !!node.group,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mention',
    runner: (state, node) => {
      state.addNode('mention', undefined, undefined, {
        name: node.attrs.name,
        group: node.attrs.group,
      })
    },
  },
}))

export const mention = [...remarkMention, mentionSchema].flat()
