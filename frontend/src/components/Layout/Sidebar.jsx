import React, { useEffect, useState, useRef } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useAuth from '../../store/useAuth'
import useChat from '../../store/useChat'
import AppFooter from '../AppFooter'
import ConfirmDialog from '../ConfirmDialog'

function TreeNode({ node, depth = 0, parentId = null, index = 0 }) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { movePage, deletePage, fetchTree } = usePages()
  const { user } = useAuth()
  // viewer covers both real viewers and the synthetic guest, since both
  // resolve to permission='read' and can't reorder pages.
  const canAuthor = user?.role !== 'viewer' && !user?.anonymous
  const isActive = location.pathname === `/page/${node.slug}`
  const hasChildren = node.children?.length > 0
  const [expanded, setExpanded] = useState(
    () => isActive || depth < 1 || (hasChildren && isChildActive(node, location.pathname))
  )
  const [trackedPath, setTrackedPath] = useState(location.pathname)
  const [dropPosition, setDropPosition] = useState(null) // 'before' | 'inside' | 'after'
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const rowRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

  const handleDelete = async () => {
    setDeleteConfirmOpen(false)
    setMenuOpen(false)
    try {
      await deletePage(node.slug)
      await fetchTree()
      // Viewing the page (or a descendant) we just trashed -> bounce home.
      if (isChildActive(node, location.pathname)) navigate('/')
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const dropIndicatorClass =
    dropPosition === 'before' ? 'shadow-[inset_0_2px_0_var(--color-primary)]' :
    dropPosition === 'after' ? 'shadow-[inset_0_-2px_0_var(--color-primary)]' :
    dropPosition === 'inside' ? 'bg-primary-soft ring-1 ring-primary/50' : ''

  return (
    <div>
      <div
        ref={rowRef}
        draggable={canAuthor}
        onDragStart={canAuthor ? handleDragStart : undefined}
        onDragOver={canAuthor ? handleDragOver : undefined}
        onDragLeave={canAuthor ? handleDragLeave : undefined}
        onDrop={canAuthor ? handleDrop : undefined}
        className={`relative flex items-center group rounded-[9px] transition-colors duration-150 cursor-grab active:cursor-grabbing ${dropIndicatorClass} ${
          isActive
            ? 'font-medium'
            : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
        }`}
        style={{
          paddingLeft: `${4 + depth * 14}px`,
          ...(isActive ? { backgroundColor: 'var(--color-sidebar-active)', color: 'var(--color-sidebar-active-text)' } : {}),
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            aria-label={node.title}
            aria-expanded={expanded}
            className="w-5 h-5 flex items-center justify-center shrink-0 rounded-md text-text-tertiary hover:text-text hover:bg-surface-hover"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-300 ${expanded ? 'rotate-90' : ''}`}
              style={{ transitionTimingFunction: 'var(--ease-out-expo)' }}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="w-5 h-5 shrink-0 flex items-center justify-center" aria-hidden="true">
            <span className={`w-1 h-1 rounded-full ${isActive ? 'bg-current' : 'bg-text-tertiary/60'}`} />
          </span>
        )}
        <Link
          to={`/page/${node.slug}`}
          className="flex-1 py-[5px] pl-1 pr-2 text-[13.5px] leading-6 truncate"
          title={node.title}
          draggable={false}
        >
          {node.title}
        </Link>
        {canAuthor && (
          <div className="relative shrink-0 mr-1" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              draggable={false}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('sidebar.pageActionsFor', { title: node.title })}
              title={t('sidebar.pageActions')}
              className={`w-6 h-6 flex items-center justify-center rounded-md group-hover:opacity-100 focus:opacity-100 text-text-secondary hover:text-text hover:bg-surface-hover transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0'}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="4" cy="10" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="16" cy="10" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div role="menu" className="menu-surface absolute right-0 top-full mt-1 z-50 w-44">
                <MenuItem onClick={() => { setMenuOpen(false); navigate(`/new?parent=${node.id}`) }}>
                  {t('sidebar.newSubpage')}
                </MenuItem>
                <MenuItem onClick={() => { setMenuOpen(false); navigate(`/page/${node.slug}/edit`) }}>
                  {t('pageView.edit')}
                </MenuItem>
                <MenuItem danger onClick={() => { setMenuOpen(false); setDeleteConfirmOpen(true) }}>
                  {t('pageView.delete')}
                </MenuItem>
              </div>
            )}
          </div>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="relative animate-[enter_0.35s_var(--ease-out-expo)_backwards]">
          <span
            aria-hidden="true"
            className="absolute top-0.5 bottom-0.5 w-px bg-border"
            style={{ left: `${4 + depth * 14 + 10}px` }}
          />
          {node.children.map((child, i) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} parentId={node.id} index={i} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t('pageView.confirm.deleteTitle')}
        description={
          <>
            <div className="font-medium text-text mb-1">&quot;{node.title}&quot;</div>
            <div>{t('pageView.confirm.deleteBody')}</div>
          </>
        }
        confirmLabel={t('pageView.confirm.deleteLabel')}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  )
}

function MenuItem({ onClick, danger = false, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      draggable={false}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={`menu-item ${danger ? 'menu-item-danger' : ''}`}
    >
      {children}
    </button>
  )
}

function isChildActive(node, pathname) {
  if (pathname === `/page/${node.slug}`) return true
  return node.children?.some((c) => isChildActive(c, pathname)) || false
}

function NavItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `group flex items-center gap-2.5 px-2.5 h-8 text-[13.5px] rounded-[9px] transition-colors duration-150 ${
          isActive
            ? 'bg-sidebar-active text-sidebar-active-text font-medium'
            : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
        }`
      }
    >
      <svg
        className="w-[17px] h-[17px] shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {icon}
      </svg>
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

function SectionLabel({ children }) {
  return <div className="eyebrow px-2.5 mb-1.5">{children}</div>
}

export default function Sidebar() {
  const { t } = useTranslation()
  const { tree } = usePages()
  const { bookmarks } = useBookmarks()
  const { user } = useAuth()
  const { aiStatus, checkStatus: checkAiStatus } = useChat()

  useEffect(() => {
    if (aiStatus === null) checkAiStatus()
  }, [aiStatus, checkAiStatus])

  return (
    <aside className="w-[var(--sidebar-width)] min-w-[var(--sidebar-width)] h-full bg-sidebar dark:bg-sidebar-dark border-r border-hairline flex flex-col">
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-3">
        {/* Quick links */}
        <nav className="mb-6 space-y-px">
          <NavItem to="/activity" icon={<path d="M3 12h4l3-8 4 16 3-8h4" />}>
            {t('sidebar.recentChanges')}
          </NavItem>
          <NavItem
            to="/graph"
            icon={<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="10" cy="18" r="2.5" /><path d="M8.2 7.1l7.4.6M7 8.3l2.3 7.3M16.6 10l-4.8 6.2" /></>}
          >
            {t('sidebar.graphView')}
          </NavItem>
          {aiStatus?.enabled && (
            <NavItem
              to="/chat"
              icon={<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>}
            >
              {t('sidebar.aiChat')}
            </NavItem>
          )}
          {!user?.anonymous && (
            <NavItem
              to="/trash"
              icon={<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>}
            >
              {t('sidebar.trash')}
            </NavItem>
          )}
          {user?.role === 'admin' && (
            <>
              <NavItem
                to="/dashboard"
                icon={<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>}
              >
                {t('sidebar.dashboard')}
              </NavItem>
              <NavItem
                to="/admin"
                icon={<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>}
              >
                {t('sidebar.admin')}
              </NavItem>
            </>
          )}
        </nav>

        {/* Bookmarks */}
        {bookmarks.length > 0 && (
          <div className="mb-6">
            <SectionLabel>{t('sidebar.bookmarks')}</SectionLabel>
            <div className="space-y-px">
              {bookmarks.map((b) => (
                <NavLink
                  key={`bm-${b.id}`}
                  to={`/page/${b.slug}`}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 h-8 text-[13.5px] rounded-[9px] transition-colors ${
                      isActive
                        ? 'bg-sidebar-active text-sidebar-active-text font-medium'
                        : 'text-text-secondary hover:bg-sidebar-hover hover:text-text'
                    }`
                  }
                  title={b.title}
                >
                  <svg className="w-[15px] h-[15px] shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" />
                  </svg>
                  <span className="truncate">{b.title}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        {/* Pages tree */}
        <SectionLabel>{t('sidebar.pages')}</SectionLabel>
        {tree.length === 0 && (
          <p className="text-sm text-text-tertiary px-2.5">{t('sidebar.noPages')}</p>
        )}
        <div className="space-y-px">
          {tree.map((node, i) => (
            <TreeNode key={node.id} node={node} parentId={null} index={i} />
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-hairline px-3 py-2.5">
        <AppFooter />
      </div>
    </aside>
  )
}
