import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useNotifications from '../../store/useNotifications'

export default function NotificationBell() {
  const { t } = useTranslation()
  const { items, unreadCount, fetchNotifications, markAllRead, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = async () => {
    if (!open) await fetchNotifications()
    setOpen(!open)
  }

  const handleClickItem = async (n) => {
    if (!n.read_at) await markRead(n.id)
    setOpen(false)
    if (n.page_slug) navigate(`/page/${n.page_slug}`)
  }

  const label = (n) => {
    const title = n.page_title ? `“${n.page_title}”` : ''
    const actor = n.actor_name || t('notifications.someone')
    if (n.event === 'page.updated') return t('notifications.pageUpdated', { actor, title })
    if (n.event === 'page.created') return t('notifications.pageCreated', { actor, title })
    if (n.event === 'page.deleted') return t('notifications.pageDeleted', { actor, title })
    return t('notifications.fallback', { event: n.event, title })
  }

  return (
    <div className="relative mr-2" ref={ref}>
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded hover:bg-surface-hover text-text-secondary"
        title={t('nav.notifications')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-lg z-50 w-80 max-h-96 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="text-sm font-semibold text-text">{t('notifications.title')}</div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="text-xs text-primary hover:underline"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-text-secondary">
                {t('notifications.empty')}
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClickItem(n)}
                  className={`w-full text-left px-3 py-2 border-b border-border last:border-0 hover:bg-surface-hover ${
                    !n.read_at ? 'bg-primary-soft/30' : ''
                  }`}
                >
                  <div className="text-sm text-text">{label(n)}</div>
                  <div className="text-xs text-text-secondary">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
