import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

export default function Layout({ children }) {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const { fetchTree } = usePages()
  const { fetchBookmarks } = useBookmarks()
  const { fetchNotifications } = useNotifications()
  const siteName = useSettings((s) => s.site_name)
  const navigate = useNavigate()
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
      <nav className="h-12 bg-surface border-b border-border flex items-center px-4 shrink-0 no-print">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-surface-hover mr-2 text-text-secondary"
          title={t('nav.toggleSidebar')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <Link to="/" className="flex items-center gap-1.5 font-bold text-lg text-text mr-4">
          <img src="/favicon.png" alt="" className="h-7 w-7" />
          {siteName}
        </Link>
        <div className="flex-1" />

        {/* Search button */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-surface-hover text-text-secondary rounded-lg hover:brightness-95 mr-3"
          title={t('nav.search')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span className="hidden sm:inline">{t('common.search')}</span>
          <kbd className="text-xs text-text-secondary border border-border rounded px-1">⌘K</kbd>
        </button>

        {!isGuest && (
          <button
            onClick={() => navigate('/new')}
            className="text-sm px-3 py-1.5 bg-primary text-primary-text rounded-lg hover:bg-primary-hover mr-3"
            title={t('nav.newPage')}
          >
            {t('common.newPage')}
          </button>
        )}
        {!isGuest && <NotificationBell />}
        <div className="mr-2">
          <ThemeSwitcher />
        </div>
        <div className="mr-2">
          <LanguageSwitcher />
        </div>
        {!isGuest && (
          <Link
            to="/profile"
            className="text-sm text-text-secondary hover:text-text mr-3"
            title={t('common.profile')}
          >
            {user?.username}
          </Link>
        )}
        {isGuest ? (
          <button
            onClick={() => navigate('/login')}
            className="text-sm px-3 py-1.5 bg-primary text-primary-text rounded-lg hover:bg-primary-hover"
          >
            {t('common.signIn')}
          </button>
        ) : (
          <button onClick={handleLogout} className="text-sm text-text-secondary hover:text-text">
            {t('common.logout')}
          </button>
        )}
      </nav>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <div
          className={`shrink-0 overflow-hidden transition-all duration-200 ease-in-out z-40 no-print
            max-md:fixed max-md:top-12 max-md:bottom-0 max-md:left-0 max-md:shadow-lg`}
          style={{ width: sidebarOpen ? '240px' : '0px' }}
        >
          <Sidebar />
        </div>
        <main className="flex-1 overflow-auto bg-bg p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
