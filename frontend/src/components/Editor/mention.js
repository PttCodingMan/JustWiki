import { $nodeSchema, $remark } from '@milkdown/kit/utils'
import { remarkMentionPlugin } from '../../lib/markdown/plugins/mention'

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
