import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAuth from './store/useAuth'
import useTheme from './store/useTheme'
import useSettings from './store/useSettings'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import PageView from './pages/PageView'
import PageEdit from './pages/PageEdit'
import NewPage from './pages/NewPage'
import SearchResults from './pages/SearchResults'
import Activity from './pages/Activity'
import PageVersions from './pages/PageVersions'
// GraphView pulls in react-force-graph + three.js (~600 KB min / ~150 KB
// gzip). Lazy-load it so the bundle only downloads when /graph is visited.
const GraphView = lazy(() => import('./pages/GraphView'))
// Admin.jsx is large (~50 KB) and only usable by admins; lazy-load so viewers
// and editors never pull it down.
const Admin = lazy(() => import('./pages/Admin'))
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Trash from './pages/Trash'
import Chat from './pages/Chat'
import PublicPageView from './pages/PublicPageView'
import PageOrPublicView from './pages/PageOrPublicView'

// Routes a guest (ANONYMOUS_READ visitor without a real session) is not
// allowed on. The matchers cover the path prefixes in the route table that
// imply a write/admin/personal action; everything else (page view, search,
// graph, activity) is open to guests.
const GUEST_BLOCKED_ROUTES = [
  /^\/new$/,
  /^\/admin/,
  /^\/dashboard$/,
  /^\/trash$/,
  /^\/profile$/,
  /^\/chat$/,
  /^\/page\/[^/]+\/(edit|versions)$/,
]

/**
 * Layout-route element that gates every in-app route. The tree split:
 *   loading               → placeholder
 *   authenticated user    → <Layout><Outlet /></Layout>  (Layout persists across child navigation)
 *   guest user (ANONYMOUS_READ on)
 *     ↳ on a write/admin route → redirect to /login
 *     ↳ otherwise              → <Layout><Outlet /></Layout> with guest-mode UI
 *   anonymous + /page/:slug → <Outlet /> (bare — PageOrPublicView renders its own chrome)
 *   anonymous, anything else → <Navigate to="/login?redirect=..."/>
 *
 * Keeping Layout inside the element (not inside each child) is what lets
 * logged-in users navigate between pages without the sidebar, tree, and
 * notification bell unmounting and refetching.
 */
function AuthGate() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  const location = useLocation()
  const homeSlug = useSettings((s) => s.home_page_slug)
  const settingsLoaded = useSettings((s) => s.loaded)

  if (loading || !settingsLoaded) {
    return <div className="flex items-center justify-center h-screen">{t('common.loading')}</div>
  }

  if (user) {
    if (user.anonymous && GUEST_BLOCKED_ROUTES.some((re) => re.test(location.pathname))) {
      const back = location.pathname + location.search
      return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />
    }
    return (
      <Layout>
        <Outlet />
      </Layout>
    )
  }

  // Anonymous visitors are only allowed on the unified page view itself,
  // not on /edit or /versions. PageOrPublicView handles the public fetch
  // and a login-redirect fallback when the page isn't public.
  const isPageRoute = /^\/page\/[^/]+$/.test(location.pathname)
  // When the admin has pinned a homepage slug, allow `/` through anonymously
  // so the Home component can <Navigate> to /page/{slug}; that route renders
  // PublicPageView for public pages and falls back to /login otherwise.
  const isRootWithHome = location.pathname === '/' && homeSlug
  if (isPageRoute || isRootWithHome) {
    return <Outlet />
  }

  const back = location.pathname + location.search
  return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />
}

/**
 * Role-gated route. Rendered inside <AuthGate> so the user is guaranteed
 * to be authenticated; this layer additionally checks role before the
 * child renders. Guarding at the route boundary (instead of in the page
 * component) means the lazy chunk for the gated page doesn't even
 * download for users who can't use it, and any top-of-file fetch added
 * later can't fire a 401 before the role check.
 */
function RoleRoute({ role }) {
  const { user } = useAuth()
  if (!user || user.role !== role) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

export default function App() {
  const { t } = useTranslation()
  const { checkAuth } = useAuth()
  const initTheme = useTheme((s) => s.init)
  const fetchSettings = useSettings((s) => s.fetch)
  const siteName = useSettings((s) => s.site_name)

  useEffect(() => {
    checkAuth()
    initTheme()
    fetchSettings()
  }, [checkAuth, initTheme, fetchSettings])

  // Drive the browser tab title from settings so per-page useEffects can
  // append "- {site_name}" without re-reading state from individual pages.
  useEffect(() => {
    document.title = siteName
  }, [siteName])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Legacy alias — existing copied links still work. */}
      <Route path="/public/page/:slug" element={<PublicPageView />} />

      <Route element={<AuthGate />}>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewPage />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/activity" element={<Activity />} />
        <Route
          path="/graph"
          element={
            <Suspense fallback={<div className="text-text-secondary">{t('common.loadingGraph')}</div>}>
              <GraphView />
            </Suspense>
          }
        />
        <Route element={<RoleRoute role="admin" />}>
          <Route
            path="/admin"
            element={
              <Suspense fallback={<div className="text-text-secondary">{t('common.loadingAdmin')}</div>}>
                <Admin />
              </Suspense>
            }
          />
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
        <Route path="/profile" element={<Profile />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/page/:slug" element={<PageOrPublicView />} />
        <Route path="/page/:slug/edit" element={<PageEdit />} />
        <Route path="/page/:slug/versions" element={<PageVersions />} />
      </Route>
    </Routes>
  )
}
