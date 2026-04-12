import { Navigate, useParams } from 'react-router-dom'
import useAuth from '../store/useAuth'
import PageView from './PageView'
import PublicPageView from './PublicPageView'

/**
 * Dispatches /page/:slug to the full authenticated PageView when the
 * visitor is logged in, or to the anonymous read-only PublicPageView
 * when they aren't. If the anonymous fetch 404s (page is private or
 * doesn't exist), we bounce them to /login with the original path in
 * the `redirect` query so they can come back after signing in.
 */
export default function PageOrPublicView() {
  const { user } = useAuth()
  const { slug } = useParams()

  if (user) return <PageView />

  const loginHref = `/login?redirect=${encodeURIComponent(`/page/${slug}`)}`
  return <PublicPageView notFound={<Navigate to={loginHref} replace />} />
}
