import { useState, useEffect } from 'react'
import useAuth from '../store/useAuth'
import api from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Profile() {
  const { checkAuth } = useAuth()
  const [profile, setProfile] = useState(null)
  const [form, setForm] = useState({ display_name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  // Password change
  const [pwForm, setPwForm] = useState({ old_password: '', new_password: '', confirm_password: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState(null)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const res = await api.get('/auth/profile')
      setProfile(res.data)
      setForm({
        display_name: res.data.display_name || '',
        email: res.data.email || '',
      })
    } catch {
      /* ignore */
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await api.put('/auth/profile', form)
      setProfile(res.data)
      setMessage({ type: 'success', text: 'Profile updated successfully.' })
      checkAuth()
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || 'Failed to update profile' })
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPwMessage(null)

    if (pwForm.new_password.length < 4) {
      setPwMessage({ type: 'error', text: 'New password must be at least 4 characters' })
      return
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }

    setPwSaving(true)
    try {
      await api.put('/auth/password', {
        old_password: pwForm.old_password,
        new_password: pwForm.new_password,
      })
      setPwMessage({ type: 'success', text: 'Password changed successfully.' })
      setPwForm({ old_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      setPwMessage({ type: 'error', text: err?.response?.data?.detail || 'Failed to change password' })
    } finally {
      setPwSaving(false)
    }
  }

  if (!profile) {
    return <div className="text-center text-gray-500 mt-8">Loading...</div>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-text">Profile</h1>

      {/* Account Info */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">Account Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-text-secondary">Username</span>
            <p className="font-medium text-text">{profile.username}</p>
          </div>
          <div>
            <span className="text-text-secondary">Role</span>
            <p className="font-medium text-text capitalize">{profile.role}</p>
          </div>
          <div>
            <span className="text-text-secondary">Created</span>
            <p className="font-medium text-text">
              {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Edit Profile */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">Edit Profile</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Display Name</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Your display name"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="your@email.com"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
              {message.text}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* API Tokens */}
      <ApiTokensCard role={profile.role} />

      {/* Change Password */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">Change Password</h2>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Current Password</label>
            <input
              type="password"
              value={pwForm.old_password}
              onChange={(e) => setPwForm({ ...pwForm, old_password: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">New Password</label>
            <input
              type="password"
              value={pwForm.new_password}
              onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Confirm New Password</label>
            <input
              type="password"
              value={pwForm.confirm_password}
              onChange={(e) => setPwForm({ ...pwForm, confirm_password: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          {pwMessage && (
            <div className={`p-3 rounded-lg text-sm ${pwMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
              {pwMessage.text}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pwSaving}
              className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
            >
              {pwSaving ? 'Saving...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ApiTokensCard({ role }) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newExpiry, setNewExpiry] = useState(30)
  // The one-shot plaintext token we just minted; cleared when the user
  // dismisses the banner. Never stored — refreshing the page forgets it.
  const [justCreated, setJustCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [toRevoke, setToRevoke] = useState(null)

  const isViewer = role === 'viewer'

  const load = async () => {
    try {
      const res = await api.get('/auth/tokens')
      setTokens(res.data)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to load tokens')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setErr(null)
    try {
      const res = await api.post('/auth/tokens', {
        name: newName.trim(),
        expires_in_days: Number(newExpiry),
      })
      setJustCreated(res.data)
      setNewName('')
      setNewExpiry(30)
      await load()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async () => {
    if (!justCreated?.token) return
    try {
      await navigator.clipboard.writeText(justCreated.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const confirmRevoke = async () => {
    if (!toRevoke) return
    try {
      await api.delete(`/auth/tokens/${toRevoke.id}`)
      await load()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to revoke token')
    } finally {
      setToRevoke(null)
    }
  }

  const fmt = (ts) => (ts ? new Date(ts.replace(' ', 'T') + 'Z').toLocaleString() : '—')

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-lg font-semibold text-text">API Tokens</h2>
      </div>
      <p className="text-sm text-text-secondary mb-4">
        Personal tokens for scripts and AI agents. Present as{' '}
        <code className="text-xs bg-surface-hover px-1 py-0.5 rounded">Authorization: Bearer &lt;token&gt;</code>.
        Tokens inherit your role and access; anyone holding one can act as you.
      </p>

      {justCreated && (
        <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
          <div className="font-medium text-sm mb-1">
            Copy your token now — it will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs break-all bg-white/70 p-2 rounded border border-amber-200">
              {justCreated.token}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-amber-300 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!isViewer && (
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-text mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. ci-bot, laptop-script"
              maxLength={100}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="w-40">
            <label className="block text-sm font-medium text-text mb-1">Expires</label>
            <select
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
              <option value={0}>Never</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'New Token'}
          </button>
        </form>
      )}
      {isViewer && (
        <div className="mb-4 text-sm text-text-secondary">
          Your account is read-only, so creating tokens is disabled.
        </div>
      )}

      {err && (
        <div className="mb-3 p-3 rounded-lg text-sm bg-red-50 text-red-600 border border-red-200">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-text-secondary">Loading…</div>
      ) : tokens.length === 0 ? (
        <div className="text-sm text-text-secondary">No tokens yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Prefix</th>
                <th className="py-2 pr-2">Last used</th>
                <th className="py-2 pr-2">Expires</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const revoked = !!t.revoked_at
                const expired =
                  !revoked && t.expires_at && new Date(t.expires_at.replace(' ', 'T') + 'Z') <= new Date()
                const status = revoked ? 'Revoked' : expired ? 'Expired' : 'Active'
                const statusCls = revoked || expired
                  ? 'text-text-secondary'
                  : 'text-green-700'
                return (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="py-2 pr-2 font-medium text-text">{t.name}</td>
                    <td className="py-2 pr-2 font-mono text-xs text-text-secondary">
                      {t.prefix || '—'}
                    </td>
                    <td className="py-2 pr-2 text-text-secondary">{fmt(t.last_used)}</td>
                    <td className="py-2 pr-2 text-text-secondary">
                      {t.expires_at ? fmt(t.expires_at) : 'Never'}
                    </td>
                    <td className={`py-2 pr-2 ${statusCls}`}>{status}</td>
                    <td className="py-2 text-right">
                      {!revoked && (
                        <button
                          onClick={() => setToRevoke(t)}
                          className="px-2 py-1 text-xs rounded-lg border border-border text-red-600 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!toRevoke}
        title="Revoke this token?"
        description={
          toRevoke && (
            <>
              The token "<span className="font-medium">{toRevoke.name}</span>" will stop
              working immediately. This cannot be undone.
            </>
          )
        }
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={confirmRevoke}
        onCancel={() => setToRevoke(null)}
      />
    </div>
  )
}
