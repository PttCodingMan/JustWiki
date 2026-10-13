import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useActivity from '../store/useActivity'

const ACTION_COLORS = {
  created: 'text-emerald-700 bg-emerald-500/12 dark:text-emerald-300',
  updated: 'text-sky-700 bg-sky-500/12 dark:text-sky-300',
  deleted: 'text-red-700 bg-red-500/12 dark:text-red-300',
}

export default function Activity() {
  const { t } = useTranslation()
  const { activities, stats, total, loading, fetchActivity, fetchStats } = useActivity()

  useEffect(() => {
    fetchActivity()
    fetchStats(true)
  }, [])

  const actionLabel = (action) => {
    const key = `activity.actions.${action}`
    const translated = t(key)
    return translated === key ? action : translated
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="page-title mb-10">{t('activity.title')}</h1>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-14">
          <div className="bg-surface rounded-2xl border border-hairline shadow-xs p-5">
            <div className="font-display text-[2.5rem] leading-none text-text tabular-nums">{stats.total_pages}</div>
            <div className="eyebrow mt-3">{t('activity.totalPages')}</div>
          </div>
          <div className="bg-surface rounded-2xl border border-hairline shadow-xs p-5">
            <div className="font-display text-[2.5rem] leading-none text-text tabular-nums">{stats.total_users}</div>
            <div className="eyebrow mt-3">{t('activity.users')}</div>
          </div>
          <div className="bg-surface rounded-2xl border border-hairline shadow-xs p-5">
            <div className="font-display text-[2.5rem] leading-none text-text tabular-nums">{total}</div>
            <div className="eyebrow mt-3">{t('activity.totalActivities')}</div>
          </div>
          <div className="bg-surface rounded-2xl border border-hairline shadow-xs p-5">
            <div className="font-display text-[2.5rem] leading-none text-text tabular-nums">
              {stats.top_viewed?.[0]?.view_count || 0}
            </div>
            <div className="eyebrow mt-3">{t('activity.mostViews')}</div>
          </div>
        </div>
      )}

      {/* Popular pages */}
      {stats?.top_viewed?.length > 0 && (
        <div className="mb-8">
          <h2 className="section-title mb-4">{t('activity.popularPages')}</h2>
          <div className="bg-surface rounded-2xl border border-hairline shadow-xs divide-y divide-hairline overflow-hidden">
            {stats.top_viewed.slice(0, 5).map((p, i) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className="group flex items-center gap-4 px-5 py-3.5 hover:bg-surface-hover transition-colors"
              >
                <span className="font-display text-xl w-6 text-text-tertiary group-hover:text-primary transition-colors tabular-nums">{i + 1}</span>
                <span className="flex-1 text-sm font-medium text-text truncate">{p.title}</span>
                <span className="text-xs text-text-tertiary tabular-nums">{t('common.views', { count: p.view_count })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity timeline */}
      <h2 className="section-title mt-14 mb-6">{t('activity.timeline')}</h2>
      {loading ? (
        <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : activities.length === 0 ? (
        <p className="text-text-secondary text-center py-8">{t('activity.noActivity')}</p>
      ) : (
        <ol className="relative ml-1.5 border-l border-border">
          {activities.map((a) => {
            const color = ACTION_COLORS[a.action] || 'text-text-secondary bg-surface-hover'
            const text = actionLabel(a.action)
            const meta = a.metadata || {}
            return (
              <li key={a.id} className="relative pl-7 pb-6 last:pb-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="absolute -left-[5px] top-[0.45rem] w-[9px] h-[9px] rounded-full bg-bg ring-2 ring-primary/60" aria-hidden="true" />
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-[0.06em] ${color}`}>
                  {text}
                </span>
                <div className="flex-1 min-w-0 basis-60">
                  {a.username ? (
                    <Link
                      to={`/u/${encodeURIComponent(a.username)}`}
                      className="text-sm font-medium text-text hover:underline"
                    >
                      {a.display_name || a.username}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-text">{t('activity.system')}</span>
                  )}
                  <span className="text-sm text-text-secondary">
                    {' '}{text}{' '}
                    {meta.slug && a.action !== 'deleted' ? (
                      <Link to={`/page/${meta.slug}`} className="text-primary hover:underline">
                        {meta.title || meta.slug}
                      </Link>
                    ) : (
                      <span className="text-text-secondary">{meta.title || `${a.target_type} #${a.target_id}`}</span>
                    )}
                  </span>
                </div>
                <time dateTime={a.created_at} className="text-xs text-text-tertiary shrink-0 tabular-nums">
                  {new Date(a.created_at).toLocaleString()}
                </time>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
