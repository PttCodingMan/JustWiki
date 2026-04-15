import React, { useState, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useAuth from '../../store/useAuth'

function TreeNode({ node, depth = 0, parentId = null, index = 0 }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { movePage } = usePages()
  const { user } = useAuth()
  const canAuthor = user?.role !== 'viewer'
  const isActive = location.pathname === `/page/${node.slug}`
  const hasChildren = node.children?.length > 0
  const [expanded, setExpanded] = useState(
    () => isActive || depth < 1 || (hasChildren && isChildActive(node, location.pathname))
  )
  const [trackedPath, setTrackedPath] = useState(location.pathname)
  const [dropPosition, setDropPosition] = useState(null) // 'before' | 'inside' | 'after'
  const rowRef = useRef(null)

  // Auto-expand when navigation lands on a descendant (adjusting state during render).
  if (trackedPath !== location.pathname) {
    setTrackedPath(location.pathname)
    if (hasChildren && isChildActive(node, location.pathname)) {
      setExpanded(true)
    }
  }

  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      slug: node.slug,
      id: node.id,
      parentId,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = rowRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = y / rect.height

    if (ratio < 0.25) setDropPosition('before')
    else if (ratio > 0.75) setDropPosition('after')
    else setDropPosition('inside')
  }

  const handleDragLeave = () => {
    setDropPosition(null)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setDropPosition(null)

    let data
    try {
      data = JSON.parse(e.dataTransfer.getData('application/json'))
    } catch { return }

    if (data.id === node.id) return // can't drop on self

    try {
      if (dropPosition === 'inside') {
        // Move as child of this node
        await movePage(data.slug, node.id, 0)
      } else if (dropPosition === 'before') {
        // Move as sibling before this node (same parent)
        await movePage(data.slug, parentId, Math.max(0, index))
      } else {
        // Move as sibling after this node
        await movePage(data.slug, parentId, index + 1)
      }
    } catch (err) {
      console.error('Move failed:', err)
    }
  }

  const dropIndicatorClass =
    dropPosition === 'before' ? 'border-t-2 border-blue-400' :
    dropPosition === 'after' ? 'border-b-2 border-blue-400' :
    dropPosition === 'inside' ? 'bg-blue-50 ring-1 ring-blue-300' : ''

  return (
    <div>
      <div
        ref={rowRef}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center group rounded-lg transition-colors cursor-grab active:cursor-grabbing ${dropIndicatorClass} ${
          isActive
            ? 'text-text font-medium'
            : 'text-text-secondary hover:bg-surface-hover'
        }`}
        style={{
          paddingLeft: `${8 + depth * 16}px`,
          ...(isActive ? { backgroundColor: 'var(--color-sidebar-active)', color: 'var(--color-sidebar-active-text)' } : {}),
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="w-5 h-5 flex items-center justify-center shrink-0 text-text-secondary hover:text-text"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6 4l8 6-8 6V4z" />
            </svg>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <Link
          to={`/page/${node.slug}`}
          className={`flex-1 py-1.5 pr-2 text-sm truncate ${isActive ? 'font-medium' : ''}`}
          title={node.title}
          draggable={false}
        >
          {node.title}
        </Link>
        {canAuthor && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              navigate(`/new?parent=${node.id}`)
            }}
            draggable={false}
            aria-label={`New subpage under ${node.title}`}
            title="New subpage"
            className="w-6 h-6 mr-1 flex items-center justify-center shrink-0 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-secondary hover:text-text hover:bg-surface-hover"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child, i) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} parentId={node.id} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function isChildActive(node, pathname) {
  if (pathname === `/page/${node.slug}`) return true
  return node.children?.some((c) => isChildActive(c, pathname)) || false
}

export default function Sidebar() {
  const { tree } = usePages()
  const { bookmarks } = useBookmarks()
  const { user } = useAuth()

  return (
    <aside className="w-60 min-w-60 bg-sidebar dark:bg-sidebar-dark border-r border-border overflow-y-auto">
      <div className="p-3">
        {/* Quick links */}
        <div className="mb-4">
          <Link
            to="/activity"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Recent Changes
          </Link>
          <Link
            to="/graph"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M8.5 8.5l7 7M8.5 6h7" />
            </svg>
            Graph View
          </Link>
          <Link
            to="/trash"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
            </svg>
            Trash
          </Link>
          {user?.role === 'admin' && (
            <>
              <Link
                to="/dashboard"
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="7" height="9" rx="1" />
                  <rect x="14" y="3" width="7" height="5" rx="1" />
                  <rect x="14" y="12" width="7" height="9" rx="1" />
                  <rect x="3" y="16" width="7" height="5" rx="1" />
                </svg>
                Dashboard
              </Link>
              <Link
                to="/admin"
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Admin
              </Link>
            </>
          )}
        </div>

        {/* Bookmarks */}
        {bookmarks.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 px-3">
              Bookmarks
            </div>
            {bookmarks.map((b) => (
              <Link
                key={`bm-${b.id}`}
                to={`/page/${b.slug}`}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover rounded-lg truncate"
                title={b.title}
              >
                <span className="text-yellow-500 shrink-0">&#9733;</span>
                {b.title}
              </Link>
            ))}
          </div>
        )}

        {/* Pages tree */}
        <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 px-3">
          Pages
        </div>
        {tree.length === 0 && (
          <p className="text-sm text-text-secondary px-3">No pages yet</p>
        )}
        {tree.map((node, i) => (
          <TreeNode key={node.id} node={node} parentId={null} index={i} />
        ))}
      </div>
    </aside>
  )
}
