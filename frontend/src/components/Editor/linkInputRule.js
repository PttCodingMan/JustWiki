import { $inputRule } from '@milkdown/kit/utils'
import { InputRule } from '@milkdown/prose/inputrules'
import { linkSchema } from '@milkdown/kit/preset/commonmark'

// The commonmark preset ships a link mark but no input rule for it, so typing
// `[text](url)` in the WYSIWYG editor stayed literal text (serialized back as
// `\[text\](url)`). This turns it into a real link on the closing paren.
// ponytail: input rule only — no link tooltip/toolbar until someone asks.
export const LINK_INPUT_RULE_RE = /\[([^[\]\n]+)\]\(([^()\s]+)(?:\s+"([^"]*)")?\)$/

export const linkInputRule = $inputRule((ctx) =>
  new InputRule(
    LINK_INPUT_RULE_RE,
    (state, match, start, end) => {
      // `![alt](src)` is an image; leave it to the image rule/serializer.
      if (start > 0 && state.doc.textBetween(start - 1, start) === '!') return null
      const [, text, href, title] = match
      const mark = linkSchema.type(ctx).create({ href, title: title || '' })
      return state.tr
        .replaceWith(start, end, state.schema.text(text, [mark]))
        .removeStoredMark(mark.type)
    },
  ),
)
