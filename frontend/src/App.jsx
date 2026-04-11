import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import useAuth from './store/useAuth'
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

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>
  return user ? children : <Navigate to="/login" />
}

export default function App() {
  const { checkAuth } = useAuth()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/new" element={<NewPage />} />
                <Route path="/search" element={<SearchResults />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/graph" element={<GraphView />} />
                <Route path="/page/:slug" element={<PageView />} />
                <Route path="/page/:slug/edit" element={<PageEdit />} />
                <Route path="/page/:slug/versions" element={<PageVersions />} />
              </Routes>
            </Layout>
          </PrivateRoute>
        }
      />
    </Routes>
  )
}
