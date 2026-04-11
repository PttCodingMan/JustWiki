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
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Recent Changes</h1>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-800">{stats.total_pages}</div>
            <div className="text-xs text-gray-400 mt-1">Total Pages</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-800">{stats.total_users}</div>
            <div className="text-xs text-gray-400 mt-1">Users</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-800">{total}</div>
            <div className="text-xs text-gray-400 mt-1">Total Activities</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold text-gray-800">
              {stats.top_viewed?.[0]?.view_count || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Most Views</div>
          </div>
        </div>
      )}

      {/* Popular pages */}
      {stats?.top_viewed?.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Popular Pages</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {stats.top_viewed.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                to={`/page/${p.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm text-gray-800">{p.title}</span>
                <span className="text-xs text-gray-400">{p.view_count} views</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity timeline */}
      <h2 className="text-lg font-semibold text-gray-700 mb-3">Timeline</h2>
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : activities.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No activity yet</p>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => {
            const label = ACTION_LABELS[a.action] || { text: a.action, color: 'text-gray-600 bg-gray-50' }
            const meta = a.metadata || {}
            return (
              <div key={a.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${label.color}`}>
                  {label.text}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-700">{a.display_name || a.username || 'system'}</span>
                  <span className="text-sm text-gray-500">
                    {' '}{label.text}{' '}
                    {meta.slug && a.action !== 'deleted' ? (
                      <Link to={`/page/${meta.slug}`} className="text-blue-600 hover:underline">
                        {meta.title || meta.slug}
                      </Link>
                    ) : (
                      <span className="text-gray-600">{meta.title || `${a.target_type} #${a.target_id}`}</span>
                    )}
                  </span>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
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
