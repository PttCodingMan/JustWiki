import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Redirect to login on 401 (auth is handled via httpOnly cookies).
// Exceptions:
// - /public/* routes are anonymous by design (legacy public viewer path).
// - /auth/me is the boot-time auth probe — useAuth handles the 401 itself;
//   redirecting here would break anonymous access to publicly-shared pages
//   that now live under the unified /page/:slug route.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname
      const isAuthMe = err.config?.url === '/auth/me'
      if (path !== '/login' && !path.startsWith('/public/') && !isAuthMe) {
        // Preserve the current URL so login can bounce the user back.
        // Without this, a session that expires mid-read silently drops
        // the user on the home page after signing in again.
        const back = window.location.pathname + window.location.search
        window.location.href = `/login?redirect=${encodeURIComponent(back)}`
      }
    }
    return Promise.reject(err)
  }
)

export default api
