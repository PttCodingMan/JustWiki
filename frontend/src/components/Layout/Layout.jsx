import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuth from '../../store/useAuth'
import usePages from '../../store/usePages'
import useBookmarks from '../../store/useBookmarks'
import useTheme, { themes } from '../../store/useTheme'
import Sidebar from './Sidebar'
import KeyboardShortcuts from '../../hooks/useKeyboard'
import SearchModal from '../Search/SearchModal'

function applyThemePreview(themeId) {
  const t = themes[themeId] || themes.light
  document.documentElement.setAttribute('data-theme', themeId)
  document.documentElement.classList.toggle('dark', t.dark)
}

function ThemePicker({ theme, setTheme }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const savedTheme = useRef(theme)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        applyThemePreview(savedTheme.current)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    savedTheme.current = theme
    setOpen(!open)
  }

  const handleHover = (id) => {
    applyThemePreview(id)
  }

  const handleLeave = () => {
    applyThemePreview(savedTheme.current)
  }

  const handleSelect = (id) => {
    savedTheme.current = id
    setTheme(id)
    setOpen(false)
  }

  return (
    <div className="relative mr-2" ref={ref}>
      <button
        onClick={handleOpen}
        className="p-1.5 rounded hover:bg-surface-hover text-text-secondary flex items-center gap-1"
        title="Change theme"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M12 2c3 2.5 4.5 6 4.5 10s-1.5 7.5-4.5 10" />
          <path d="M12 2c-3 2.5-4.5 6-4.5 10s1.5 7.5 4.5 10" />
          <path d="M2 12h20" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 bg-surface border border-border rounded-xl shadow-lg p-2 z-50 w-44"
          onMouseLeave={handleLeave}
        >
          <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider px-2 py-1 mb-1">Theme</div>
          {Object.entries(themes).map(([id, t]) => (
            <button
              key={id}
              onMouseEnter={() => handleHover(id)}
              onClick={() => handleSelect(id)}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                theme === id
                  ? 'bg-surface-hover font-medium text-text'
                  : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              <span className="flex gap-0.5 shrink-0">
                {t.preview.map((c, i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full border border-border"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span>{t.name}</span>
              {theme === id && <span className="ml-auto text-primary text-xs">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const { fetchTree } = usePages()
  const { fetchBookmarks } = useBookmarks()
  const { theme, setTheme, init: initTheme, dark } = useTheme()
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
    <div className="h-screen flex flex-col bg-bg text-text">
      <KeyboardShortcuts onOpenSearch={() => setSearchOpen(true)} />
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Navbar */}
      <nav className="h-12 bg-surface border-b border-border flex items-center px-4 shrink-0">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-surface-hover mr-2 text-text-secondary"
          title="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <Link to="/" className="font-bold text-lg text-text mr-4">JustWiki</Link>
        <div className="flex-1" />

        {/* Search button */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-surface-hover text-text-secondary rounded-lg hover:brightness-95 mr-3"
          title="Search (Ctrl+K)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span className="hidden sm:inline">Search</span>
          <kbd className="text-xs text-text-secondary border border-border rounded px-1">⌘K</kbd>
        </button>

        <button
          onClick={() => navigate('/new')}
          className="text-sm px-3 py-1.5 bg-primary text-primary-text rounded-lg hover:bg-primary-hover mr-3"
          title="New page (Ctrl+N)"
        >
          + New
        </button>
        <ThemePicker theme={theme} setTheme={setTheme} />
        <Link
          to="/profile"
          className="text-sm text-text-secondary hover:text-text mr-3"
          title="Profile"
        >
          {user?.username}
        </Link>
        <button onClick={handleLogout} className="text-sm text-text-secondary hover:text-text">
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
        <main className="flex-1 overflow-auto bg-bg p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
