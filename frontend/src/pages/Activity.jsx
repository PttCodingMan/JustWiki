import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useActivity from '../store/useActivity'

const ACTION_COLORS = {
  created: 'text-green-600 bg-green-50',
  updated: 'text-blue-600 bg-blue-50',
  deleted: 'text-red-600 bg-red-50',
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
      <h1 className="text-2xl font-bold text-text mb-6">{t('activity.title')}</h1>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{stats.total_pages}</div>
            <div className="text-xs text-text-secondary mt-1">{t('activity.totalPages')}</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{stats.total_users}</div>
            <div className="text-xs text-text-secondary mt-1">{t('activity.users')}</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{total}</div>
            <div className="text-xs text-text-secondary mt-1">{t('activity.totalActivities')}</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">
              {stats.top_viewed?.[0]?.view_count || 0}
            </div>
            <div className="text-xs text-text-secondary mt-1">{t('activity.mostViews')}</div>
          </div>
        </div>
      )}

      {/* Popular pages */}
      {stats?.top_viewed?.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-text mb-3">{t('activity.popularPages')}</h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {stats.top_viewed.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
              >
                <span className="text-sm text-text">{p.title}</span>
                <span className="text-xs text-text-secondary">{t('common.views', { count: p.view_count })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity timeline */}
      <h2 className="text-lg font-semibold text-text mb-3">{t('activity.timeline')}</h2>
      {loading ? (
        <p className="text-text-secondary">{t('common.loading')}</p>
      ) : activities.length === 0 ? (
        <p className="text-text-secondary text-center py-8">{t('activity.noActivity')}</p>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => {
            const color = ACTION_COLORS[a.action] || 'text-gray-600 bg-gray-50'
            const text = actionLabel(a.action)
            const meta = a.metadata || {}
            return (
              <div key={a.id} className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>
                  {text}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text">{a.display_name || a.username || t('activity.system')}</span>
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
                <span className="text-xs text-text-secondary shrink-0">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
