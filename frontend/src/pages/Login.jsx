import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuth from '../store/useAuth'
import useSettings from '../store/useSettings'
import api from '../api/client'
import AppFooter from '../components/AppFooter'

// Only same-origin paths are allowed as a post-login destination. Refuse
// protocol-relative ("//evil.com") or absolute URLs so a crafted link can't
// redirect the user off-site after login.
function safeRedirect(raw) {
  if (!raw || typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

const SSO_ERROR_CODES = new Set([
  'not_invited',
  'domain_not_allowed',
  'email_not_allowed',
  'group_not_allowed',
  'github_no_email',
  'no_email',
  'oauth_failed',
  'user_disabled',
  'unknown_provider',
  'username_collision',
])

export default function Login() {
  const { t } = useTranslation()

  const ssoError = (code, detail) => {
    if (!code) return ''
    if (SSO_ERROR_CODES.has(code)) return t(`login.ssoErrors.${code}`)
    return detail || t('login.ssoErrors.default')
  }

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
  const loginTitle = useSettings((s) => s.login_title)
  const loginSubtitle = useSettings((s) => s.login_subtitle)
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
      setError(t('common.invalidCredentials'))
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
          <h1 className={`text-2xl font-bold text-center text-text ${loginSubtitle ? 'mb-1' : 'mb-6'}`}>{loginTitle}</h1>
          {loginSubtitle && (
            <p className="text-text-secondary text-center mb-6 text-sm">{loginSubtitle}</p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">{error}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-text mb-1">{t('common.username')}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-surface text-text"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">{t('common.password')}</label>
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
              {t('common.logIn')}
            </button>
          </form>

          {providers.length > 0 && (
            <>
              <div className="flex items-center gap-2 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-secondary">{t('common.or')}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {providers.map((p) => (
                  <a
                    key={p.id}
                    href={ssoHref(p.id)}
                    className="flex items-center justify-center gap-2 w-full py-2 border border-border rounded-lg text-sm font-medium text-text hover:bg-surface-hover transition-colors"
                  >
                    {t('common.continueWith', { provider: p.name })}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
        <AppFooter className="mt-6" />
      </div>
    </div>
  )
}
