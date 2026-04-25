import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAuth from '../store/useAuth'
import api from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Profile() {
  const { t } = useTranslation()
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
      setMessage({ type: 'success', text: t('profile.edit.success') })
      checkAuth()
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || t('profile.edit.failed') })
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPwMessage(null)

    if (pwForm.new_password.length < 4) {
      setPwMessage({ type: 'error', text: t('profile.password.tooShort') })
      return
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwMessage({ type: 'error', text: t('profile.password.mismatch') })
      return
    }

    setPwSaving(true)
    try {
      await api.put('/auth/password', {
        old_password: pwForm.old_password,
        new_password: pwForm.new_password,
      })
      setPwMessage({ type: 'success', text: t('profile.password.success') })
      setPwForm({ old_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      setPwMessage({ type: 'error', text: err?.response?.data?.detail || t('profile.password.failed') })
    } finally {
      setPwSaving(false)
    }
  }

  if (!profile) {
    return <div className="text-center text-gray-500 mt-8">{t('common.loading')}</div>
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-text">{t('profile.title')}</h1>

      {/* Account Info */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">{t('profile.account.title')}</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-text-secondary">{t('profile.account.username')}</span>
            <p className="font-medium text-text">{profile.username}</p>
          </div>
          <div>
            <span className="text-text-secondary">{t('profile.account.role')}</span>
            <p className="font-medium text-text capitalize">{profile.role}</p>
          </div>
          <div>
            <span className="text-text-secondary">{t('profile.account.created')}</span>
            <p className="font-medium text-text">
              {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Edit Profile */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">{t('profile.edit.title')}</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('profile.edit.displayName')}</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder={t('profile.edit.displayNamePlaceholder')}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('profile.edit.email')}</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={t('profile.edit.emailPlaceholder')}
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
              {saving ? t('profile.edit.saving') : t('profile.edit.save')}
            </button>
          </div>
        </form>
      </div>

      {/* API Tokens */}
      <ApiTokensCard role={profile.role} />

      {/* Change Password */}
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-text mb-4">{t('profile.password.title')}</h2>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('profile.password.current')}</label>
            <input
              type="password"
              value={pwForm.old_password}
              onChange={(e) => setPwForm({ ...pwForm, old_password: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('profile.password.new')}</label>
            <input
              type="password"
              value={pwForm.new_password}
              onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('profile.password.confirm')}</label>
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
              {pwSaving ? t('profile.password.saving') : t('profile.password.change')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ApiTokensCard({ role }) {
  const { t } = useTranslation()
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
      setErr(e?.response?.data?.detail || t('tokens.failedLoad'))
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
      setErr(e?.response?.data?.detail || t('tokens.failedCreate'))
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
      setErr(e?.response?.data?.detail || t('tokens.failedRevoke'))
    } finally {
      setToRevoke(null)
    }
  }

  const fmt = (ts) => (ts ? new Date(ts.replace(' ', 'T') + 'Z').toLocaleString() : '—')

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-lg font-semibold text-text">{t('tokens.title')}</h2>
      </div>
      <p className="text-sm text-text-secondary mb-4">
        {t('tokens.intro1')}{' '}
        <code className="text-xs bg-surface-hover px-1 py-0.5 rounded">Authorization: Bearer &lt;token&gt;</code>.{' '}
        {t('tokens.intro2')}
      </p>

      {justCreated && (
        <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
          <div className="font-medium text-sm mb-1">
            {t('tokens.copyNow')}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs break-all bg-white/70 p-2 rounded border border-amber-200">
              {justCreated.token}
            </code>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
            >
              {copied ? t('tokens.copied') : t('tokens.copy')}
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="px-3 py-1.5 text-sm rounded-lg border border-amber-300 hover:bg-amber-100"
            >
              {t('tokens.dismiss')}
            </button>
          </div>
        </div>
      )}

      {!isViewer && (
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-text mb-1">{t('tokens.name')}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('tokens.namePlaceholder')}
              maxLength={100}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="w-40">
            <label className="block text-sm font-medium text-text mb-1">{t('tokens.expires')}</label>
            <select
              value={newExpiry}
              onChange={(e) => setNewExpiry(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
            >
              <option value={30}>{t('tokens.expiresDays', { count: 30 })}</option>
              <option value={90}>{t('tokens.expiresDays', { count: 90 })}</option>
              <option value={365}>{t('tokens.expiresDays', { count: 365 })}</option>
              <option value={0}>{t('tokens.expiresNever')}</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            {creating ? t('tokens.creating') : t('tokens.newToken')}
          </button>
        </form>
      )}
      {isViewer && (
        <div className="mb-4 text-sm text-text-secondary">
          {t('tokens.viewerNotice')}
        </div>
      )}

      {err && (
        <div className="mb-3 p-3 rounded-lg text-sm bg-red-50 text-red-600 border border-red-200">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-text-secondary">{t('common.loading')}</div>
      ) : tokens.length === 0 ? (
        <div className="text-sm text-text-secondary">{t('tokens.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border">
                <th className="py-2 pr-2">{t('tokens.col.name')}</th>
                <th className="py-2 pr-2">{t('tokens.col.prefix')}</th>
                <th className="py-2 pr-2">{t('tokens.col.lastUsed')}</th>
                <th className="py-2 pr-2">{t('tokens.col.expires')}</th>
                <th className="py-2 pr-2">{t('tokens.col.status')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((tok) => {
                const revoked = !!tok.revoked_at
                const expired =
                  !revoked && tok.expires_at && new Date(tok.expires_at.replace(' ', 'T') + 'Z') <= new Date()
                const status = revoked
                  ? t('tokens.status.revoked')
                  : expired
                    ? t('tokens.status.expired')
                    : t('tokens.status.active')
                const statusCls = revoked || expired
                  ? 'text-text-secondary'
                  : 'text-green-700'
                return (
                  <tr key={tok.id} className="border-b border-border/60">
                    <td className="py-2 pr-2 font-medium text-text">{tok.name}</td>
                    <td className="py-2 pr-2 font-mono text-xs text-text-secondary">
                      {tok.prefix || '—'}
                    </td>
                    <td className="py-2 pr-2 text-text-secondary">{fmt(tok.last_used)}</td>
                    <td className="py-2 pr-2 text-text-secondary">
                      {tok.expires_at ? fmt(tok.expires_at) : t('tokens.expiresNever')}
                    </td>
                    <td className={`py-2 pr-2 ${statusCls}`}>{status}</td>
                    <td className="py-2 text-right">
                      {!revoked && (
                        <button
                          onClick={() => setToRevoke(tok)}
                          className="px-2 py-1 text-xs rounded-lg border border-border text-red-600 hover:bg-red-50"
                        >
                          {t('tokens.revoke')}
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
        title={t('tokens.confirmTitle')}
        description={toRevoke && t('tokens.confirmBody', { name: toRevoke.name })}
        confirmLabel={t('tokens.revoke')}
        variant="danger"
        onConfirm={confirmRevoke}
        onCancel={() => setToRevoke(null)}
      />
    </div>
  )
}
