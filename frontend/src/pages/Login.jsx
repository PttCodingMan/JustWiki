import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuth from '../store/useAuth'
import api from '../api/client'

// Only same-origin paths are allowed as a post-login destination. Refuse
// protocol-relative ("//evil.com") or absolute URLs so a crafted link can't
// redirect the user off-site after login.
function safeRedirect(raw) {
  if (!raw || typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

const SSO_ERROR_MESSAGES = {
  not_invited: 'This wiki is invitation-only. Ask an admin to add your email.',
  domain_not_allowed: 'Your email domain is not allowed here.',
  email_not_allowed: 'Your email is not on the invite list.',
  group_not_allowed: 'Your account is missing a required group membership.',
  github_no_email: 'Your GitHub account has no verified primary email. Set one to public or verified first.',
  no_email: 'The identity provider did not return an email address.',
  oauth_failed: 'SSO sign-in failed. Please try again.',
  user_disabled: 'Account is disabled. Contact an administrator.',
  unknown_provider: 'SSO provider is not configured.',
  username_collision: 'Could not generate a username. Ask an admin to invite you.',
}

function ssoError(code, detail) {
  if (!code) return ''
  return SSO_ERROR_MESSAGES[code] || detail || 'Sign-in failed.'
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [searchParams] = useSearchParams()
  // Seed the error banner from ?error=<code> so the Login page can surface
  // OAuth callback failures. Lazy init (vs useEffect + setState) avoids the
  // cascading-render lint warning — the error only ever comes from this query
  // string on mount or from the submit handler afterwards.
  const [error, setError] = useState(() => {
    const code = searchParams.get('error')
    return code ? ssoError(code, searchParams.get('detail')) : ''
  })
  const [providers, setProviders] = useState([])
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    api.get('/auth/providers')
      .then((res) => { if (!cancelled) setProviders(Array.isArray(res.data) ? res.data : []) })
      .catch(() => { /* OIDC disabled; no-op */ })
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await login(username, password)
      navigate(safeRedirect(searchParams.get('redirect')))
    } catch {
      setError('Invalid username or password')
    }
  }

  const ssoHref = (providerId) => {
    const redirect = safeRedirect(searchParams.get('redirect'))
    const qs = new URLSearchParams({ redirect }).toString()
    return `/api/auth/oauth/${encodeURIComponent(providerId)}/login?${qs}`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm">
        <div className="bg-surface rounded-xl shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-1 text-text">JustWiki</h1>
          <p className="text-text-secondary text-center mb-6 text-sm">Just clone, run, and write.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{error}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-text mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-text"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-text"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-primary text-primary-text rounded-lg font-medium hover:bg-primary-hover transition-colors"
            >
              Log in
            </button>
          </form>

          {providers.length > 0 && (
            <>
              <div className="flex items-center gap-2 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-secondary">OR</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {providers.map((p) => (
                  <a
                    key={p.id}
                    href={ssoHref(p.id)}
                    className="flex items-center justify-center gap-2 w-full py-2 border border-border rounded-lg text-sm font-medium text-text hover:bg-surface-hover transition-colors"
                  >
                    Continue with {p.name}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
