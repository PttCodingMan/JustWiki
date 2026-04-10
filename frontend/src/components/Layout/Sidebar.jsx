import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useActivity from '../../store/useActivity'

function TreeNode({ node, depth = 0 }) {
  const location = useLocation()
  const isActive = location.pathname === `/page/${node.slug}`

  return (
    <div>
      <Link
        to={`/page/${node.slug}`}
        className={`block px-3 py-1.5 text-sm rounded-lg truncate transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        title={node.title}
      >
        {node.children?.length > 0 && (
          <span className="mr-1 text-gray-400">&#9656;</span>
        )}
        {node.title}
      </Link>
      {node.children?.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function Sidebar() {
  const { tree } = usePages()
  const { bookmarks } = useBookmarks()
  const { stats, fetchStats } = useActivity()

  useEffect(() => {
    fetchStats()
  }, [])

  return (
    <aside className="w-60 min-w-60 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-3">
        {/* Quick links */}
        <div className="mb-4">
          <Link
            to="/activity"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Recent Changes
          </Link>
        </div>

        {/* Bookmarks */}
        {bookmarks.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
              Bookmarks
            </div>
            {bookmarks.map((b) => (
              <Link
                key={`bm-${b.id}`}
                to={`/page/${b.slug}`}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg truncate"
                title={b.title}
              >
                <span className="text-yellow-500 shrink-0">&#9733;</span>
                {b.title}
              </Link>
            ))}
          </div>
        )}

        {/* Recently updated */}
        {stats?.recently_updated?.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
              Recently Updated
            </div>
            {stats.recently_updated.slice(0, 5).map((p) => (
              <Link
                key={`recent-${p.id}`}
                to={`/page/${p.slug}`}
                className="block px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg truncate"
                title={p.title}
              >
                {p.title}
              </Link>
            ))}
          </div>
        )}

        {/* Popular pages */}
        {stats?.top_viewed?.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
              Popular
            </div>
            {stats.top_viewed.slice(0, 5).map((p) => (
              <Link
                key={`pop-${p.id}`}
                to={`/page/${p.slug}`}
                className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                title={p.title}
              >
                <span className="truncate">{p.title}</span>
                <span className="text-xs text-gray-400 shrink-0 ml-1">{p.view_count}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Pages tree */}
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
          Pages
        </div>
        {tree.length === 0 && (
          <p className="text-sm text-gray-400 px-3">No pages yet</p>
        )}
        {tree.map((node) => (
          <TreeNode key={node.id} node={node} />
        ))}
      </div>
    </aside>
  )
}
