/**
 * Mention remark plugin — single source of truth for `@user` and
 * `@@group` parsing.
 *
 * Used both by the Milkdown editor (wrapped via `$remark`) and by the
 * v2 viewer renderer (passed directly to unified). Keeping the regex
 * and tree-replace logic in one place prevents the editor and the
 * viewer from drifting on boundary handling — e.g. how `foo@bar` (an
 * email) or `github.com/@octo` (a URL path) are rejected.
 *
 * mdast node shape produced:
 *   { type: 'mention', name, group, data: { hName: 'span' } }
 *
 * `group: true` corresponds to `@@group`, `false` to `@user`.
 */
import { findAndReplace } from 'mdast-util-find-and-replace'

// Group must be tested before user — `@@bob` is a group, never a user.
// Boundary class excludes alphanumeric/underscore/@/`/` so emails
// (`foo@bar`), URL paths (`github.com/@octo`), and `@@@bob` triple-at
// noise don't false-positive. Name must start with alphanumeric.
const _NAME = '[A-Za-z0-9][A-Za-z0-9_-]*'
export const GROUP_MENTION_RE = new RegExp(
  `(^|[^A-Za-z0-9_@/])@@(${_NAME})`,
  'g',
)
export const USER_MENTION_RE = new RegExp(
  `(^|[^A-Za-z0-9_@/])@(?!@)(${_NAME})`,
  'g',
)

export function remarkMentionPlugin() {
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
