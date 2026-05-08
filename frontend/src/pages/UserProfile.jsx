import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/client'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'
import useAuth from '../store/useAuth'

// Mirrors BIO_MAX_LEN in backend/app/routers/auth_router.py.
const BIO_MAX_LEN = 1000

const ACTION_BADGE = {
  created: 'text-green-700 bg-green-50 border-green-200',
  updated: 'text-blue-700 bg-blue-50 border-blue-200',
  commented: 'text-purple-700 bg-purple-50 border-purple-200',
}

const ACTION_ICON = {
  created: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  updated: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  commented: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
}

// Initials for the avatar circle. Falls back to username when display_name
// is empty (invited users start with no display_name set). Picks the first
// glyph for CJK names, the first letters of two words for Latin names.
function initials(displayName, username) {
  const source = (displayName || username || '?').trim()
  if (!source) return '?'
  const parts = source.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  // Single word: take the first character. For CJK that's already meaningful;
  // for "alice" it's "A".
  return Array.from(source)[0].toUpperCase()
}

function relativeTime(iso, t) {
  if (!iso) return ''
  // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC, no timezone). Normalize to ISO.
  const ts = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, Date.now() - then) / 1000
  if (diff < 60) return t('userProfile.time.justNow')
  if (diff < 3600) return t('userProfile.time.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('userProfile.time.hoursAgo', { count: Math.floor(diff / 3600) })
  if (diff < 86400 * 30) return t('userProfile.time.daysAgo', { count: Math.floor(diff / 86400) })
  // Beyond ~a month, switch to absolute calendar date — relative gets fuzzy.
  return new Date(ts).toLocaleDateString()
}

// Bio block: read-only for visitors, owner gets an inline editor with
// save/cancel + char counter. Empty bio renders as a "click to add intro"
// affordance for the owner; visitors see nothing (the parent hides the slot).
function BioCard({ initialBio, isOwner, onSaved }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialBio || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const startEdit = () => {
    setDraft(initialBio || '')
    setError(null)
    setEditing(true)
  }
  const cancel = () => {
    setEditing(false)
    setError(null)
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await api.put('/auth/profile', { bio: draft })
      onSaved(res.data.bio || '')
      setEditing(false)
    } catch (err) {
      setError(err?.response?.data?.detail || t('userProfile.bio.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const hasBio = !!(initialBio && initialBio.trim())

  // Visitor on a profile with no bio: render nothing (parent already gates,
  // but be defensive in case BioCard is reused elsewhere).
  if (!hasBio && !isOwner) return null

  if (editing) {
    const tooLong = draft.length > BIO_MAX_LEN
    return (
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-lg font-semibold text-text">{t('userProfile.about')}</h2>
          <span className={`text-xs ${tooLong ? 'text-red-600' : 'text-text-secondary'}`}>
            {draft.length}/{BIO_MAX_LEN}
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          autoFocus
          placeholder={t('userProfile.bio.placeholder')}
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary resize-y"
        />
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-lg border border-border text-text hover:bg-surface-hover disabled:opacity-50"
          >
            {t('userProfile.bio.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || tooLong}
            className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-text hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t('userProfile.bio.saving') : t('userProfile.bio.save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text">{t('userProfile.about')}</h2>
        {isOwner && hasBio && (
          <button
            type="button"
            onClick={startEdit}
            className="text-xs text-primary hover:underline"
          >
            {t('userProfile.bio.edit')}
          </button>
        )}
      </div>
      {hasBio ? (
        <div className="prose prose-sm max-w-none text-text">
          <MarkdownViewer content={initialBio} />
        </div>
      ) : (
        // Owner-only empty-state nudge — the whole block is clickable so the
        // affordance is obvious without a separate "edit" button.
        <button
          type="button"
          onClick={startEdit}
          className="w-full text-left text-sm text-text-secondary italic hover:text-primary"
        >
          {t('userProfile.bio.addPrompt')}
        </button>
      )}
    </div>
  )
}

// Inner component is keyed on `username` by the parent so navigating between
// /u/alice → /u/bob remounts and the loading state resets cleanly without
// having to call setState synchronously inside an effect.
function UserProfileFor({ username }) {
  const { t } = useTranslation()
  const currentUser = useAuth((s) => s.user)
  const isOwner = !!currentUser && !currentUser.anonymous && currentUser.username === username
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/users/${encodeURIComponent(username)}/profile`)
      .then((res) => {
        if (!cancelled) setProfile(res.data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.response?.status === 404) {
          setError('not_found')
        } else {
          setError('load_failed')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  if (loading) {
    return <div className="text-center text-text-secondary mt-8">{t('common.loading')}</div>
  }

  if (error === 'not_found') {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <h1 className="text-xl font-semibold text-text mb-2">{t('userProfile.notFound.title')}</h1>
        <p className="text-text-secondary">{t('userProfile.notFound.body', { username })}</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center text-red-600">
        {t('userProfile.loadFailed')}
      </div>
    )
  }

  const joined = profile.created_at
    ? new Date(
        profile.created_at.includes('T')
          ? profile.created_at
          : profile.created_at.replace(' ', 'T') + 'Z'
      ).toLocaleDateString()
    : '—'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Identity card */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6 flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold flex-shrink-0">
          {initials(profile.display_name, profile.username)}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text truncate">
            {profile.display_name || profile.username}
          </h1>
          <div className="text-sm text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
            <span>@{profile.username}</span>
            <span aria-hidden>·</span>
            <span className="capitalize">{profile.role}</span>
            <span aria-hidden>·</span>
            <span>{t('userProfile.joinedOn', { date: joined })}</span>
          </div>
        </div>
      </div>

      {/* Bio: visitors see it only if non-empty; owner always sees the card
          (with a "click to add" prompt when empty) so they can write one. */}
      {(isOwner || (profile.bio && profile.bio.trim())) && (
        <BioCard
          initialBio={profile.bio}
          isOwner={isOwner}
          onSaved={(updated) => setProfile((p) => ({ ...p, bio: updated }))}
        />
      )}

      {/* Activity timeline */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">{t('userProfile.recentActivity')}</h2>
        {profile.recent_activity.length === 0 ? (
          <p className="text-text-secondary text-sm">{t('userProfile.noActivity')}</p>
        ) : (
          <ol className="space-y-3">
            {profile.recent_activity.map((entry) => {
              const badgeClass = ACTION_BADGE[entry.action] || 'text-gray-700 bg-gray-50 border-gray-200'
              const verbKey = `userProfile.actions.${entry.action}`
              const verb = t(verbKey, { defaultValue: entry.action })
              const target =
                entry.action === 'commented' && entry.comment_id
                  ? `/page/${entry.page_slug}#comment-${entry.comment_id}`
                  : `/page/${entry.page_slug}`
              return (
                <li key={entry.id} className="flex items-start gap-3">
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${badgeClass}`}
                  >
                    {ACTION_ICON[entry.action]}
                    {verb}
                  </span>
                  <div className="flex-1 min-w-0">
                    <Link
                      to={target}
                      className="text-sm text-text hover:text-primary hover:underline truncate inline-block max-w-full align-bottom"
                    >
                      {entry.page_title}
                    </Link>
                  </div>
                  <span className="text-xs text-text-secondary shrink-0 mt-0.5">
                    {relativeTime(entry.created_at, t)}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

export default function UserProfile() {
  const { username } = useParams()
  return <UserProfileFor key={username} username={username} />
}
