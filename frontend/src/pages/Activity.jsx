import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import useActivity from '../store/useActivity'

const ACTION_LABELS = {
  created: { text: 'created', color: 'text-green-600 bg-green-50' },
  updated: { text: 'updated', color: 'text-blue-600 bg-blue-50' },
  deleted: { text: 'deleted', color: 'text-red-600 bg-red-50' },
}

export default function Activity() {
  const { activities, stats, total, loading, fetchActivity, fetchStats } = useActivity()

  useEffect(() => {
    fetchActivity()
    fetchStats()
  }, [])

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text mb-6">Recent Changes</h1>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{stats.total_pages}</div>
            <div className="text-xs text-text-secondary mt-1">Total Pages</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{stats.total_users}</div>
            <div className="text-xs text-text-secondary mt-1">Users</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">{total}</div>
            <div className="text-xs text-text-secondary mt-1">Total Activities</div>
          </div>
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="text-2xl font-bold text-text">
              {stats.top_viewed?.[0]?.view_count || 0}
            </div>
            <div className="text-xs text-text-secondary mt-1">Most Views</div>
          </div>
        </div>
      )}

      {/* Popular pages */}
      {stats?.top_viewed?.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-text mb-3">Popular Pages</h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {stats.top_viewed.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
              >
                <span className="text-sm text-text">{p.title}</span>
                <span className="text-xs text-text-secondary">{p.view_count} views</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity timeline */}
      <h2 className="text-lg font-semibold text-text mb-3">Timeline</h2>
      {loading ? (
        <p className="text-text-secondary">Loading...</p>
      ) : activities.length === 0 ? (
        <p className="text-text-secondary text-center py-8">No activity yet</p>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => {
            const label = ACTION_LABELS[a.action] || { text: a.action, color: 'text-gray-600 bg-gray-50' }
            const meta = a.metadata || {}
            return (
              <div key={a.id} className="bg-surface rounded-lg border border-border px-4 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${label.color}`}>
                  {label.text}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text">{a.display_name || a.username || 'system'}</span>
                  <span className="text-sm text-text-secondary">
                    {' '}{label.text}{' '}
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
