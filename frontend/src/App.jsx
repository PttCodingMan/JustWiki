import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import useAuth from './store/useAuth'
import useTheme from './store/useTheme'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Home from './pages/Home'
import PageView from './pages/PageView'
import PageEdit from './pages/PageEdit'
import NewPage from './pages/NewPage'
import SearchResults from './pages/SearchResults'
import Activity from './pages/Activity'
import PageVersions from './pages/PageVersions'
import GraphView from './pages/GraphView'
import Admin from './pages/Admin'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Trash from './pages/Trash'
import PublicPageView from './pages/PublicPageView'
import PageOrPublicView from './pages/PageOrPublicView'

/**
 * Layout-route element that gates every in-app route. The tree split:
 *   loading               → placeholder
 *   authenticated         → <Layout><Outlet /></Layout>  (Layout persists across child navigation)
 *   anonymous + /page/:slug → <Outlet /> (bare — PageOrPublicView renders its own chrome)
 *   anonymous, anything else → <Navigate to="/login?redirect=..."/>
 *
 * Keeping Layout inside the element (not inside each child) is what lets
 * logged-in users navigate between pages without the sidebar, tree, and
 * notification bell unmounting and refetching.
 */
function AuthGate() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>
  }

  if (user) {
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
  if (isPageRoute) {
    return <Outlet />
  }

  const back = location.pathname + location.search
  return <Navigate to={`/login?redirect=${encodeURIComponent(back)}`} replace />
}

export default function App() {
  const { checkAuth } = useAuth()
  const initTheme = useTheme((s) => s.init)

  useEffect(() => {
    checkAuth()
    initTheme()
  }, [checkAuth, initTheme])

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
        <Route path="/graph" element={<GraphView />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/page/:slug" element={<PageOrPublicView />} />
        <Route path="/page/:slug/edit" element={<PageEdit />} />
        <Route path="/page/:slug/versions" element={<PageVersions />} />
      </Route>
    </Routes>
  )
}
