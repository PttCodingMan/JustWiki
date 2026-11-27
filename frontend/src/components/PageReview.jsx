import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/client'
import { REVIEW_INTERVALS, parseUtc, reviewDueText } from '../lib/review'

const TONE = {
  ok: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 ring-emerald-500/25',
  due_soon: 'bg-amber-500/10 text-amber-900 dark:text-amber-200 ring-amber-500/30',
  overdue: 'bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30',
}

export function ReviewStatusChip({ status }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold ring-1 ring-inset ${TONE[status] || TONE.ok}`}>
      {t(`review.status.${status}`)}
    </span>
  )
}

/** Review status strip shown under the page meta line. */
export function ReviewBanner({ review, writable, onVerify }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  if (!review) return null

  const verifiedAt = parseUtc(review.reviewed_at)
  const verifiedDate = verifiedAt
    ? verifiedAt.toLocaleDateString(i18n.resolvedLanguage || undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : ''

  const handleVerify = async () => {
    setBusy(true)
    try {
      await onVerify()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 rounded-lg text-[13px] ring-1 ring-inset ${TONE[review.status] || TONE.ok}`}>
      <span className="font-medium">
        {review.status === 'ok' ? '✓ ' : '⚠ '}
        {t('review.verifiedOn', { date: verifiedDate })}
        {review.reviewed_by_name && <> · {review.reviewed_by_name}</>}
      </span>
      <span>· {reviewDueText(t, review)}</span>
      <span>
        ·{' '}
        {review.owner_username ? (
          <>
            {t('review.owner')}{' '}
            <Link to={`/u/${encodeURIComponent(review.owner_username)}`} className="font-medium hover:underline">
              {review.owner_name || review.owner_username}
            </Link>
          </>
        ) : (
          t('review.noOwner')
        )}
      </span>
      {writable && (
        <button
          type="button"
          onClick={handleVerify}
          disabled={busy}
          className={`ml-auto h-7 px-3 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
            review.status === 'ok'
              ? 'bg-surface/70 hover:bg-surface border border-current/20'
              : 'btn-primary'
          }`}
        >
          {t('review.verify')}
        </button>
      )}
    </div>
  )
}

/** Modal to turn review on/off and pick its interval and owner. */
export function ReviewSettingsDialog({ open, slug, review, onClose, onSaved }) {
  const { t } = useTranslation()
  const [intervalDays, setIntervalDays] = useState(90)
  const [owner, setOwner] = useState(null) // { id, name } | null
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setIntervalDays(review?.interval_days || 90)
    setOwner(
      review?.owner_id
        ? { id: review.owner_id, name: review.owner_name || review.owner_username || `#${review.owner_id}` }
        : null
    )
    setQuery('')
    setResults([])
    setError('')
  }, [open, review])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    const q = query.trim()
    if (!open || !q) {
      setResults([])
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      api.get('/users/search', { params: { q, limit: 8 } })
        .then((res) => { if (!cancelled) setResults(res.data || []) })
        .catch(() => { if (!cancelled) setResults([]) })
    }, 200)
    return () => { cancelled = true; clearTimeout(id) }
  }, [open, query])

  if (!open) return null

  const intervals = REVIEW_INTERVALS.includes(intervalDays)
    ? REVIEW_INTERVALS
    : [...REVIEW_INTERVALS, intervalDays].sort((a, b) => a - b)

  const run = async (fn) => {
    setSaving(true)
    setError('')
    try {
      const res = await fn()
      onSaved?.(res)
      onClose?.()
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('review.dialog.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => run(async () => {
    const res = await api.put(`/pages/${slug}/review`, {
      owner_id: owner?.id ?? null,
      interval_days: intervalDays,
    })
    return res.data
  })

  const handleTurnOff = () => run(async () => {
    await api.delete(`/pages/${slug}/review`)
    return null
  })

  return (
    <div
      className="fixed inset-0 bg-[color-mix(in_oklab,var(--color-text)_25%,transparent)] backdrop-blur-[3px] z-[100] flex items-center justify-center p-4 animate-fade"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-dialog-title"
    >
      <div className="bg-surface rounded-2xl shadow-2xl ring-1 ring-hairline w-full max-w-md overflow-hidden animate-pop">
        <div className="p-6 space-y-5">
          <div>
            <h2 id="review-dialog-title" className="text-[17px] font-semibold tracking-tight text-text mb-1">
              {t('review.dialog.title')}
            </h2>
            <p className="text-sm text-text-secondary">{t('review.dialog.description')}</p>
          </div>

          <label className="block">
            <span className="block text-sm font-medium text-text mb-1.5">{t('review.dialog.interval')}</span>
            <select
              value={intervalDays}
              onChange={(e) => setIntervalDays(Number(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            >
              {intervals.map((d) => (
                <option key={d} value={d}>{t('review.dialog.everyDays', { count: d })}</option>
              ))}
            </select>
          </label>

          <div>
            <span className="block text-sm font-medium text-text mb-1.5">{t('review.dialog.owner')}</span>
            {owner ? (
              <div className="flex items-center justify-between px-3 py-2 border border-border rounded-lg text-sm">
                <span className="text-text">{owner.name}</span>
                <button type="button" onClick={() => setOwner(null)} className="text-xs text-text-secondary hover:text-text">
                  {t('review.dialog.clearOwner')}
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('review.dialog.ownerPlaceholder')}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
                />
                {results.length > 0 && (
                  <ul className="mt-2 border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                    {results.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOwner({ id: u.id, name: u.display_name || u.username })
                            setQuery('')
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-hover"
                        >
                          {u.display_name || u.username}
                          {u.display_name && <span className="text-text-tertiary"> @{u.username}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-xs text-text-tertiary">{t('review.dialog.ownerHint')}</p>
              </>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-500/10 text-red-600 text-sm rounded-lg border border-red-500/25">{error}</div>
          )}
        </div>
        <div className="flex items-center gap-2 px-6 py-4 bg-bg/60 border-t border-hairline">
          {review && (
            <button
              type="button"
              onClick={handleTurnOff}
              disabled={saving}
              className="h-9 px-3 rounded-[10px] text-[13px] font-medium text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {t('review.dialog.turnOff')}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[10px] text-[13px] font-medium text-text bg-surface border border-border shadow-xs hover:bg-surface-hover transition-colors"
            >
              {t('review.dialog.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-[10px] text-[13px] font-medium transition-colors btn-primary"
            >
              {review ? t('review.dialog.save') : t('review.dialog.enable')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
