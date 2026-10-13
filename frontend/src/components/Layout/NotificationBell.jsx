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
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        className="icon-btn relative"
        title={t('nav.notifications')}
        aria-label={t('nav.notifications')}
        aria-expanded={open}
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center ring-2 ring-surface animate-pop">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="menu-surface absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1.5rem)] max-h-[28rem] overflow-hidden flex flex-col !p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
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
              <div className="px-4 py-10 text-center text-sm text-text-tertiary">
                {t('notifications.empty')}
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClickItem(n)}
                  className={`relative w-full text-left pl-7 pr-4 py-2.5 border-b border-hairline last:border-0 hover:bg-surface-hover transition-colors ${
                    !n.read_at ? 'bg-primary-soft/40' : ''
                  }`}
                >
                  {!n.read_at && <span className="absolute left-3 top-[1.05rem] w-1.5 h-1.5 rounded-full bg-primary" />}
                  <div className="text-[13px] leading-snug text-text">{label(n)}</div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">
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
