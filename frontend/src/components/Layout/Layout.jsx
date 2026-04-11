import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuth from '../../store/useAuth'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useTheme from '../../store/useTheme'
import Sidebar from './Sidebar'
import KeyboardShortcuts from '../../hooks/useKeyboard'
import SearchModal from '../Search/SearchModal'

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { fetchTree } = usePages()
  const { fetchBookmarks } = useBookmarks()
  const { dark, toggle: toggleTheme, init: initTheme } = useTheme()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    fetchTree()
    fetchBookmarks()
    initTheme()
  }, [])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <KeyboardShortcuts onOpenSearch={() => setSearchOpen(true)} />
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Navbar */}
      <nav className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 shrink-0">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-gray-100 mr-2 text-gray-500"
          title="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <Link to="/" className="font-bold text-lg text-gray-800 dark:text-gray-100 mr-4">JustWiki</Link>
        <div className="flex-1" />

        {/* Search button */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 mr-3"
          title="Search (Ctrl+K)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span className="hidden sm:inline">Search</span>
          <kbd className="text-xs text-gray-400 border border-gray-300 rounded px-1">⌘K</kbd>
        </button>

        <button
          onClick={() => navigate('/new')}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mr-3"
          title="New page (Ctrl+N)"
        >
          + New
        </button>
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 mr-2 text-gray-500 dark:text-gray-400"
          title={dark ? 'Light mode' : 'Dark mode'}
        >
          {dark ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
        <Link
          to="/profile"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mr-3"
          title="Profile"
        >
          {user?.username}
        </Link>
        <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          Logout
        </button>
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
          className={`shrink-0 overflow-hidden transition-all duration-200 ease-in-out z-40
            max-md:fixed max-md:top-12 max-md:bottom-0 max-md:left-0 max-md:shadow-lg`}
          style={{ width: sidebarOpen ? '240px' : '0px' }}
        >
          <Sidebar />
        </div>
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
