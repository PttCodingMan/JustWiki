import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuth from '../../store/useAuth'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useNotifications from '../../store/useNotifications'
import useSettings from '../../store/useSettings'
import Sidebar from './Sidebar'
import KeyboardShortcuts from '../../hooks/useKeyboard'
import SearchModal from '../Search/SearchModal'
import NotificationBell from './NotificationBell'
import ThemeSwitcher from '../ThemeSwitcher'
import LanguageSwitcher from '../LanguageSwitcher'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

function UserMenu({ user, onLogout }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const name = user?.display_name || user?.username || ''
  const initial = (name.trim()[0] || '?').toUpperCase()

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.username}
        className="ml-1 w-9 h-9 rounded-full flex items-center justify-center transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold text-primary-text shadow-sm ring-2 ring-surface"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), color-mix(in oklab, var(--color-primary) 55%, var(--color-accent)))' }}
          aria-hidden="true"
        >
          {initial}
        </span>
      </button>
      {open && (
        <div role="menu" className="menu-surface absolute right-0 top-full mt-2 z-50 w-56">
          <div className="px-3 pt-2 pb-2.5">
            <div className="text-sm font-semibold text-text truncate">{name}</div>
            {user?.username && name !== user.username && (
              <div className="text-xs text-text-secondary truncate">@{user.username}</div>
            )}
            {user?.role && (
              <div className="mt-1.5 inline-flex text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-md bg-primary-soft text-sidebar-active-text">
                {user.role}
              </div>
            )}
          </div>
          <div className="menu-sep" />
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="menu-item">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            {t('common.profile')}
          </Link>
          <button role="menuitem" onClick={() => { setOpen(false); onLogout() }} className="menu-item">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
              <path d="M10 17l5-5-5-5M15 12H3" />
            </svg>
            {t('common.logout')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { fetchTree } = usePages()
  const { fetchBookmarks } = useBookmarks()
  const { fetchNotifications } = useNotifications()
  const siteName = useSettings((s) => s.site_name)
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
  const [searchOpen, setSearchOpen] = useState(false)

  const isGuest = !!user?.anonymous

  useEffect(() => {
    fetchTree()
    if (isGuest) {
      // Bookmarks / notifications are personal endpoints that 401 for the
      // synthetic guest. Skip them entirely so we don't paint a transient
      // error and don't pay for the wasted round-trips.
      return undefined
    }
    fetchBookmarks()
    fetchNotifications()
    // Poll for new notifications every 60s — cheap, and simple.
    const id = setInterval(() => fetchNotifications(), 60000)
    return () => clearInterval(id)
  }, [isGuest])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <KeyboardShortcuts onOpenSearch={() => setSearchOpen(true)} />
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Navbar */}
      <nav className="app-nav h-14 flex items-center gap-1 px-2 sm:px-3 shrink-0 relative z-40 no-print">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="icon-btn"
          title={t('nav.toggleSidebar')}
          aria-label={t('nav.toggleSidebar')}
          aria-expanded={sidebarOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <Link to="/" className="group flex items-center gap-2 pl-1 pr-2 min-w-0">
          <img
            src="/favicon.png"
            alt=""
            className="h-7 w-7 shrink-0 transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110"
            style={{ transitionTimingFunction: 'var(--ease-spring)' }}
          />
          <span className="hidden sm:block font-display text-[1.45rem] leading-none text-text truncate translate-y-[1px]">
            {siteName}
          </span>
        </Link>

        <div className="flex-1 flex justify-center px-2">
          {/* Command-bar style search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="group hidden md:flex items-center gap-2.5 w-full max-w-md h-9 pl-3 pr-1.5 rounded-xl text-sm text-text-tertiary bg-surface/70 border border-border hover:border-text-tertiary/40 hover:text-text-secondary shadow-xs transition-all duration-200"
            title={t('nav.search')}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="flex-1 text-left truncate">{t('searchModal.placeholder')}</span>
            <kbd className="flex items-center gap-0.5 text-[11px] font-medium text-text-secondary bg-bg border border-border rounded-md px-1.5 h-6">
              {isMac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>
        </div>

        <button
          onClick={() => setSearchOpen(true)}
          className="icon-btn md:hidden"
          title={t('nav.search')}
          aria-label={t('common.search')}
        >
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>

        {!isGuest && (
          <button
            onClick={() => navigate('/new')}
            className="btn-primary max-sm:w-9 max-sm:px-0 mx-1"
            title={t('nav.newPage')}
            aria-label={t('nav.newPage')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="hidden sm:inline">{t('common.newPage').replace(/^\+\s*/, '')}</span>
          </button>
        )}
        {!isGuest && <NotificationBell />}
        <ThemeSwitcher />
        <LanguageSwitcher />
        {isGuest ? (
          <button onClick={() => navigate('/login')} className="btn-primary ml-1">
            {t('common.signIn')}
          </button>
        ) : (
          <UserMenu user={user} onLogout={handleLogout} />
        )}
      </nav>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-30 md:hidden animate-fade"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-300 z-40 no-print
            max-md:fixed max-md:top-14 max-md:bottom-0 max-md:left-0 max-md:shadow-2xl`}
          style={{ width: sidebarOpen ? 'var(--sidebar-width)' : '0px', transitionTimingFunction: 'var(--ease-out-expo)' }}
        >
          <Sidebar />
        </div>
        <main className="flex-1 overflow-auto bg-bg px-4 py-6 sm:px-8 sm:py-10">
          {/* Opacity-only route transition: a transform here would turn this
              wrapper into the containing block for position:fixed children
              (FABs, floating bars) while the animation runs. */}
          <div key={location.pathname} className="animate-fade [animation-duration:0.4s]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
