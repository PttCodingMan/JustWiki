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
  const siteName = useSettings((s) => s.site_name)
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

  const inputClass =
    'w-full h-11 px-3.5 rounded-xl border border-border bg-surface text-text text-[15px] shadow-xs outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-text-tertiary hover:border-text-tertiary/50 focus:border-primary focus:ring-4 focus:ring-primary/15'

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] bg-bg">
      {/* Brand panel */}
      <section className="login-hero relative hidden lg:flex flex-col justify-between overflow-hidden p-12 xl:p-16 border-r border-hairline">
        <div className="login-aurora" aria-hidden="true">
          <span /><span /><span />
        </div>
        <div className="login-grid" aria-hidden="true" />

        <div className="relative flex items-center gap-2.5 animate-enter">
          <img src="/favicon.png" alt="" className="h-8 w-8" />
          <span className="font-display text-2xl text-text">{siteName}</span>
        </div>

        <div className="relative max-w-xl">
          <h1 className="font-display text-text text-[clamp(3.5rem,6.4vw,6.5rem)] leading-[0.95] tracking-[-0.03em] animate-enter [animation-delay:80ms] text-balance">
            {loginTitle}
          </h1>
          {loginSubtitle && (
            <p className="mt-6 text-lg text-text-secondary max-w-md leading-relaxed animate-enter [animation-delay:160ms]">
              {loginSubtitle}
            </p>
          )}
        </div>

        {/* Decorative floating page preview */}
        <div className="relative h-44 animate-enter [animation-delay:240ms]" aria-hidden="true">
          <div className="login-card login-card-back">
            <div className="h-2 w-24 rounded-full bg-text/10" />
            <div className="mt-4 space-y-2">
              <div className="h-1.5 w-full rounded-full bg-text/8" />
              <div className="h-1.5 w-4/5 rounded-full bg-text/8" />
            </div>
          </div>
          <div className="login-card login-card-front">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs font-semibold text-primary">#</span>
              <div className="h-2.5 w-32 rounded-full bg-text/20" />
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-1.5 w-full rounded-full bg-text/10" />
              <div className="h-1.5 w-11/12 rounded-full bg-text/10" />
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1/4 rounded-full bg-text/10" />
                <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-primary-soft text-sidebar-active-text">[[wikilink]]</span>
                <div className="h-1.5 flex-1 rounded-full bg-text/10" />
              </div>
              <div className="h-1.5 w-3/5 rounded-full bg-text/10" />
            </div>
          </div>
        </div>
      </section>

      {/* Form panel */}
      <section className="relative isolate overflow-hidden flex flex-col items-center justify-center px-6 py-12">
        <div className="login-aurora lg:hidden !opacity-35" aria-hidden="true">
          <span /><span /><span />
        </div>
        <div className="w-full max-w-[22rem] animate-enter">
          <div className="lg:hidden flex flex-col items-center text-center mb-10">
            <img src="/favicon.png" alt="" className="h-12 w-12 mb-4" />
            <h1 className="font-display text-5xl text-text leading-none tracking-tight">{loginTitle}</h1>
            {loginSubtitle && <p className="text-text-secondary mt-3 text-sm">{loginSubtitle}</p>}
          </div>

          <h2 className="hidden lg:block font-display text-[2.75rem] leading-none tracking-tight text-text mb-8">
            {t('common.logIn')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="flex items-start gap-2.5 bg-red-500/8 text-red-700 dark:text-red-300 ring-1 ring-inset ring-red-500/20 px-3.5 py-3 rounded-xl text-sm animate-pop">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
                {error}
              </div>
            )}
            <div>
              <label htmlFor="login-username" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('common.username')}</label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[13px] font-medium text-text-secondary mb-1.5">{t('common.password')}</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            <button type="submit" className="btn-primary group w-full !h-11 !text-[15px] !rounded-xl mt-2">
              {t('common.logIn')}
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>

          {providers.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-7">
                <div className="flex-1 h-px bg-border" />
                <span className="eyebrow">{t('common.or')}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2.5">
                {providers.map((p) => (
                  <a
                    key={p.id}
                    href={ssoHref(p.id)}
                    className="flex items-center justify-center gap-2 w-full h-11 border border-border bg-surface rounded-xl text-sm font-medium text-text shadow-xs hover:bg-surface-hover hover:border-text-tertiary/50 transition-colors"
                  >
                    {t('common.continueWith', { provider: p.name })}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
        <AppFooter className="absolute bottom-6 inset-x-0" />
      </section>
    </div>
  )
}
