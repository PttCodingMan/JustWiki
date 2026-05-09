/**
 * Wikilink remark plugin — single source of truth for `[[slug]]`,
 * `[[slug|display]]`, and `![[slug]]` (transclusion) parsing.
 *
 * Used both by the Milkdown editor (wrapped via `$remark` so it
 * participates in the editor's parse/serialize pipeline) and by the
 * v2 viewer renderer (used directly as a unified processor plugin).
 * Extracting the bare regex + plugin keeps the two paths from
 * diverging on edge cases the way the previous hand-rolled regex
 * parser did before the markdown-it migration.
 *
 * mdast node shape produced:
 *   { type: 'wikilink', slug, display, transclusion, data: { hName: 'span' } }
 */
import { findAndReplace } from 'mdast-util-find-and-replace'

export const WIKILINK_RE = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g

/**
 * Plain unified plugin function. Pass directly to `unified().use(...)`,
 * or wrap with Milkdown's `$remark(name, () => remarkWikilinkPlugin)` for
 * editor use.
 */
export function remarkWikilinkPlugin() {
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
