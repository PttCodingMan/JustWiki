import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../api/client'

/**
 * Wraps a controlled `<textarea>` and shows a dropdown when the user
 * types `@<query>` or `@@<query>` at the caret. Used by Comments where
 * the input is a plain textarea (no Milkdown) and we still want the
 * same `@username` and `@@groupname` autocomplete behaviour as the page
 * editor.
 *
 * Props mirror `<textarea>` so the parent keeps full control over the
 * controlled value. Selection navigation lives inside this component to
 * avoid leaking dropdown state up to the parent.
 */
export default function MentionAutocomplete({
  value,
  onChange,
  onSubmit,
  pageSlug,
  placeholder,
  rows = 3,
  className = '',
  disabled = false,
  textareaRef: externalRef,
}) {
  const { t } = useTranslation()
  const internalRef = useRef(null)
  const textareaRef = externalRef || internalRef

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(0)
  const [trigger, setTrigger] = useState(null)  // { start, query, isGroup }
  const fetchSeqRef = useRef(0)

  const fetchCandidates = useCallback(async (query, isGroup) => {
    const seq = ++fetchSeqRef.current
    try {
      const res = await api.get('/users/mentionable', {
        params: { page_slug: pageSlug, q: query },
      })
      if (seq !== fetchSeqRef.current) return  // stale response
      const users = (res.data.users || []).map((u) => ({
        kind: 'user',
        name: u.username,
        sub: u.display_name || '',
      }))
      const groups = (res.data.groups || []).map((g) => ({
        kind: 'group',
        name: g.name,
        sub: g.description || '',
      }))
      setItems(isGroup ? groups : users)
      setSelected(0)
    } catch {
      // best-effort
    }
  }, [pageSlug])

  // Derive the active trigger from a (text, caret) pair. Returns the new
  // trigger object or `null` when no mention is in progress.
  //
  // We do this synchronously inside event handlers (onChange / onSelect)
  // rather than in a `useEffect`, because the inputs are already known at
  // event time — running it in an effect would cause the linter-flagged
  // cascading-render pattern (setState inside effect body).
  const computeTrigger = useCallback((text, caret) => {
    if (!pageSlug) return null
    if (caret == null) return null
    const before = text.slice(0, caret)
    let i = before.length - 1
    while (i >= 0 && /[A-Za-z0-9_-]/.test(before[i])) i--
    if (i < 0 || before[i] !== '@') return null
    // Name must start with alphanum (parity with the renderer regex).
    const firstNameChar = before[i + 1]
    if (firstNameChar !== undefined && !/[A-Za-z0-9]/.test(firstNameChar)) {
      return null
    }
    let triggerStart = i
    let isGroup = false
    if (i > 0 && before[i - 1] === '@') {
      triggerStart = i - 1
      isGroup = true
    }
    if (triggerStart > 0 && /[A-Za-z0-9_@/]/.test(before[triggerStart - 1])) {
      return null
    }
    const query = before.slice(i + 1)
    return { start: triggerStart, end: caret, query, isGroup }
  }, [pageSlug])

  const applyTrigger = useCallback((next) => {
    if (!next) {
      setOpen(false)
      setTrigger(null)
      return
    }
    setTrigger(next)
    setOpen(true)
    fetchCandidates(next.query, next.isGroup)
  }, [fetchCandidates])

  const insertMention = (item) => {
    if (!trigger) return
    const sigil = item.kind === 'group' ? '@@' : '@'
    const insertText = `${sigil}${item.name} `
    const next =
      value.slice(0, trigger.start) +
      insertText +
      value.slice(trigger.end)
    onChange(next)
    setOpen(false)
    // Restore caret position after the inserted mention.
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const newCaret = trigger.start + insertText.length
      ta.focus()
      ta.setSelectionRange(newCaret, newCaret)
    })
  }

  const handleKeyDown = (e) => {
    if (open && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, items.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // Tab and Enter inside the menu should always commit, even though
        // Enter would otherwise insert a newline. The caller can still
        // submit the form via Cmd/Ctrl+Enter.
        e.preventDefault()
        insertMention(items[selected])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        return
      }
    }
    // Cmd/Ctrl+Enter submits the comment when no menu is open.
    if (!open && (e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  const handleChange = (e) => {
    const next = e.target.value
    onChange(next)
    applyTrigger(computeTrigger(next, e.target.selectionStart))
  }

  const handleSelect = (e) => {
    applyTrigger(computeTrigger(e.target.value, e.target.selectionStart))
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onBlur={() => {
          // Delay so a click on the dropdown can register before close.
          setTimeout(() => setOpen(false), 150)
        }}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={className}
      />
      {open && (
        <div className="wikilink-menu mention-menu absolute left-0 top-full mt-1 z-50">
          {items.length === 0 ? (
            <div className="wikilink-menu-empty">
              {t('mention.empty', 'No matches')}
            </div>
          ) : (
            items.map((item, i) => (
              <div
                key={`${item.kind}-${item.name}`}
                className={'wikilink-menu-item' + (i === selected ? ' active' : '')}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(item)
                }}
              >
                <span className="wikilink-menu-title">
                  {item.kind === 'group' ? '@@' : '@'}
                  {item.name}
                </span>
                <span className="wikilink-menu-slug">{item.sub}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
