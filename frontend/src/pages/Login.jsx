import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuth from '../store/useAuth'

// Only same-origin paths are allowed as a post-login destination. Refuse
// protocol-relative ("//evil.com") or absolute URLs so a crafted link can't
// redirect the user off-site after login.
function safeRedirect(raw) {
  if (!raw || typeof raw !== 'string') return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

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
        </div>
      </div>
    </div>
  )
}
