import { $nodeSchema, $remark, $view } from '@milkdown/kit/utils'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import remarkMath from 'remark-math'

const MATH_BLOCK_ID = 'math_block'
const MATH_INLINE_ID = 'math_inline'

const renderInto = (dom, value, displayMode) => {
  try {
    katex.render(value, dom, { throwOnError: false, displayMode })
  } catch {
    dom.textContent = value || ''
  }
}

export const remarkMathPlugin = $remark('remarkMath', () => remarkMath)

export const mathBlockSchema = $nodeSchema(MATH_BLOCK_ID, () => ({
  group: 'block',
  atom: true,
  defining: true,
  draggable: false,
  selectable: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [
    {
      tag: `div[data-type="${MATH_BLOCK_ID}"]`,
      getAttrs: (dom) => ({ value: dom.dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement('div')
    dom.dataset.type = MATH_BLOCK_ID
    dom.dataset.value = node.attrs.value ?? ''
    dom.className = 'math-block-node'
    renderInto(dom, node.attrs.value ?? '', true)
    return dom
  },
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value ?? '' })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_BLOCK_ID,
    runner: (state, node) => {
      state.addNode('math', undefined, node.attrs.value ?? '')
    },
  },
}))

export const mathInlineSchema = $nodeSchema(MATH_INLINE_ID, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  draggable: false,
  selectable: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [
    {
      tag: `span[data-type="${MATH_INLINE_ID}"]`,
      getAttrs: (dom) => ({ value: dom.dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement('span')
    dom.dataset.type = MATH_INLINE_ID
    dom.dataset.value = node.attrs.value ?? ''
    dom.className = 'math-inline-node'
    renderInto(dom, node.attrs.value ?? '', false)
    return dom
  },
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value ?? '' })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_INLINE_ID,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.attrs.value ?? '')
    },
  },
}))

// Shared editable node view factory. `displayMode` controls KaTeX display mode.
function createMathNodeView(displayMode, tag) {
  return () => (node, view, getPos) => {
    const dom = document.createElement(tag)
    dom.className = displayMode ? 'math-block-node' : 'math-inline-node'
    dom.dataset.type = displayMode ? MATH_BLOCK_ID : MATH_INLINE_ID
    dom.contentEditable = 'false'

    let currentValue = node.attrs.value ?? ''
    let editing = false
    let editor = null

    const paintMath = () => {
      dom.innerHTML = ''
      const inner = document.createElement(displayMode ? 'div' : 'span')
      inner.className = 'math-render'
      renderInto(inner, currentValue, displayMode)
      if (!currentValue) {
        inner.textContent = displayMode ? '(empty math block — click to edit)' : '(empty math)'
        inner.classList.add('math-empty')
      }
      dom.appendChild(inner)
      dom.dataset.value = currentValue
    }

    const commit = (next) => {
      editing = false
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos != null && next !== currentValue) {
        const tr = view.state.tr.setNodeMarkup(pos, undefined, { value: next })
        view.dispatch(tr)
      } else {
        currentValue = next
        paintMath()
      }
    }

    const cancelEdit = () => {
      editing = false
      paintMath()
      view.focus()
    }

    const startEdit = () => {
      if (editing) return
      editing = true
      dom.innerHTML = ''
      editor = document.createElement('textarea')
      editor.className = displayMode ? 'math-block-editor' : 'math-inline-editor'
      editor.value = currentValue
      editor.spellcheck = false
      editor.autocapitalize = 'off'
      editor.autocorrect = 'off'
      if (displayMode) {
        editor.rows = Math.max(2, (currentValue.match(/\n/g)?.length ?? 0) + 1)
      }
      editor.addEventListener('input', () => {
        if (displayMode) {
          editor.rows = Math.max(2, (editor.value.match(/\n/g)?.length ?? 0) + 1)
        }
      })
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelEdit()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit(editor.value)
          view.focus()
        } else if (!displayMode && e.key === 'Enter') {
          // Inline math: Enter commits (no newlines in inline math).
          e.preventDefault()
          commit(editor.value)
          view.focus()
        }
      })
      editor.addEventListener('blur', () => {
        if (editing) commit(editor.value)
      })
      dom.appendChild(editor)
      requestAnimationFrame(() => {
        editor.focus()
        editor.select()
      })
    }

    dom.addEventListener('mousedown', (e) => {
      if (editing) return
      e.preventDefault()
      startEdit()
    })

    paintMath()

    return {
      dom,
      update(updated) {
        const expected = displayMode ? MATH_BLOCK_ID : MATH_INLINE_ID
        if (updated.type.name !== expected) return false
        const nextValue = updated.attrs.value ?? ''
        if (nextValue !== currentValue) {
          currentValue = nextValue
          if (!editing) paintMath()
          else if (editor) editor.value = nextValue
        }
        return true
      },
      stopEvent: () => editing,
      ignoreMutations: () => true,
      destroy() {
        editor = null
      },
    }
  }
}

export const mathBlockView = $view(mathBlockSchema, createMathNodeView(true, 'div'))
export const mathInlineView = $view(mathInlineSchema, createMathNodeView(false, 'span'))

export const math = [
  remarkMathPlugin,
  mathBlockSchema,
  mathInlineSchema,
  mathBlockView,
  mathInlineView,
].flat()
