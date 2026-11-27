// Unsaved-edit drafts, kept in localStorage so a closed tab, crash or
// expired session doesn't lose work. Per user + page, so two accounts on one
// browser never see each other's drafts. Storage can be unavailable (private
// mode, blocked site data, quota), so every access is best-effort.

const PREFIX = 'justwiki:draft:'
// Drafts nobody came back to (e.g. for a page since deleted) are dropped.
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function key(userId, slug) {
  return `${PREFIX}${userId}:${slug}`
}

function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** @returns {{title, content, mindmapLayout, baseVersion, savedAt} | null} */
export function loadDraft(userId, slug) {
  const s = storage()
  if (!s || userId == null || !slug) return null
  try {
    const raw = s.getItem(key(userId, slug))
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (typeof draft?.content !== 'string' || typeof draft?.title !== 'string') return null
    return draft
  } catch {
    return null
  }
}

export function saveDraft(userId, slug, { title, content, mindmapLayout, baseVersion }) {
  const s = storage()
  if (!s || userId == null || !slug) return
  const value = JSON.stringify({ title, content, mindmapLayout, baseVersion, savedAt: Date.now() })
  try {
    s.setItem(key(userId, slug), value)
  } catch {
    // Most likely quota: make room by dropping stale drafts, then retry once.
    pruneDrafts()
    try {
      s.setItem(key(userId, slug), value)
    } catch {
      // Give up quietly; the unsaved-changes prompt still guards navigation.
    }
  }
}

export function clearDraft(userId, slug) {
  const s = storage()
  if (!s || userId == null || !slug) return
  try {
    s.removeItem(key(userId, slug))
  } catch {
    // ignore
  }
}

/** Remove drafts older than `maxAgeMs` (any user). */
export function pruneDrafts(maxAgeMs = DRAFT_MAX_AGE_MS, now = Date.now()) {
  const s = storage()
  if (!s) return
  try {
    const stale = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k?.startsWith(PREFIX)) continue
      let savedAt = 0
      try {
        savedAt = JSON.parse(s.getItem(k))?.savedAt || 0
      } catch {
        // unreadable → stale
      }
      if (now - savedAt >= maxAgeMs) stale.push(k)
    }
    stale.forEach((k) => s.removeItem(k))
  } catch {
    // ignore
  }
}
