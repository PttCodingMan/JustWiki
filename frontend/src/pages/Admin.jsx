import { useState, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useAuth from '../store/useAuth'
import useGroups from '../store/useGroups'
import useSettings from '../store/useSettings'
import api from '../api/client'
import Editor from '../components/Editor/Editor'

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SiteSettingsSection() {
  const { t } = useTranslation()
  const settings = useSettings()
  const updateSettings = useSettings((s) => s.update)
  const [form, setForm] = useState({
    site_name: '',
    login_title: '',
    login_subtitle: '',
    home_page_slug: '',
    footer_text: '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    setForm({
      site_name: settings.site_name,
      login_title: settings.login_title,
      login_subtitle: settings.login_subtitle,
      home_page_slug: settings.home_page_slug,
      footer_text: settings.footer_text,
    })
  }, [settings.site_name, settings.login_title, settings.login_subtitle, settings.home_page_slug, settings.footer_text])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await updateSettings(form)
      setMessage({ type: 'success', text: t('admin.site.saveSuccess') })
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || t('admin.site.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const field = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <h2 className="text-lg font-semibold text-text mb-1">{t('admin.site.title')}</h2>
      <p className="text-sm text-text-secondary mb-4">
        {t('admin.site.intro')}
      </p>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text mb-1">{t('admin.site.siteName')}</label>
          <input
            type="text"
            value={form.site_name}
            onChange={field('site_name')}
            placeholder={t('admin.site.siteNamePlaceholder')}
            maxLength={80}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
          />
          <p className="text-xs text-text-secondary mt-1">{t('admin.site.siteNameHint')}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">{t('admin.site.homeSlug')}</label>
          <input
            type="text"
            value={form.home_page_slug}
            onChange={field('home_page_slug')}
            placeholder={t('admin.site.homeSlugPlaceholder')}
            maxLength={200}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
          />
          <p className="text-xs text-text-secondary mt-1">{t('admin.site.homeSlugHintBefore')} <code>/</code> {t('admin.site.homeSlugHintAfter')}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('admin.site.loginTitle')}</label>
            <input
              type="text"
              value={form.login_title}
              onChange={field('login_title')}
              placeholder={t('admin.site.siteNamePlaceholder')}
              maxLength={80}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">{t('admin.site.loginSubtitle')}</label>
            <input
              type="text"
              value={form.login_subtitle}
              onChange={field('login_subtitle')}
              placeholder={t('admin.site.loginSubtitlePlaceholder')}
              maxLength={200}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">{t('admin.site.footer')}</label>
          <input
            type="text"
            value={form.footer_text}
            onChange={field('footer_text')}
            placeholder={t('admin.site.footerPlaceholder')}
            maxLength={200}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
          />
          <p className="text-xs text-text-secondary mt-1">{t('admin.site.footerHint')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t('admin.site.saving') : t('admin.site.save')}
          </button>
          {message && (
            <span className={message.type === 'success' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
              {message.text}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

function BackupSection() {
  const { t } = useTranslation()
  const [restoring, setRestoring] = useState(false)
  const [message, setMessage] = useState(null)
  const fileRef = useRef(null)

  const handleBackup = () => {
    window.open('/api/backup', '_blank')
  }

  const handleRestore = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    if (!confirm(t('admin.backup.confirmReplace'))) return

    setRestoring(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post('/backup/restore', formData)
      setMessage({ type: 'success', text: t('admin.backup.restoreSuccess') })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || t('admin.backup.restoreFailed') })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <h2 className="text-lg font-semibold text-text mb-4">{t('admin.backup.title')}</h2>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-text mb-2">{t('admin.backup.downloadTitle')}</h3>
          <p className="text-sm text-text-secondary mb-3">{t('admin.backup.downloadHint')}</p>
          <button onClick={handleBackup} className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover">
            {t('admin.backup.downloadBtn')}
          </button>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-text mb-2">{t('admin.backup.restoreTitle')}</h3>
          <p className="text-sm text-text-secondary mb-3">{t('admin.backup.restoreHint')}</p>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".zip" className="text-sm" />
            <button onClick={handleRestore} disabled={restoring} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
              {restoring ? t('admin.backup.restoring') : t('admin.backup.restoreBtn')}
            </button>
          </div>
        </div>
      </div>
      {message && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {message.text}
        </div>
      )}
    </div>
  )
}

function ExportSection() {
  const { t } = useTranslation()
  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <h2 className="text-lg font-semibold text-text mb-4">{t('admin.export.title')}</h2>
      <p className="text-sm text-text-secondary mb-3">{t('admin.export.intro')}</p>
      <button
        onClick={() => window.open('/api/export/site?format=html', '_blank')}
        className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
      >
        {t('admin.export.btn')}
      </button>
    </div>
  )
}

function UsersSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('active')
  const [users, setUsers] = useState([])
  const [deletedUsers, setDeletedUsers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'editor' })
  const [inviteForm, setInviteForm] = useState({ email: '', display_name: '', role: 'editor' })
  const [inviteError, setInviteError] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const loadUsers = async () => {
    try {
      const res = await api.get('/users')
      setUsers(res.data.users || [])
    } catch { /* ignore */ }
  }

  const loadDeleted = async () => {
    try {
      const res = await api.get('/users/deleted')
      setDeletedUsers(Array.isArray(res.data) ? res.data : [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let cancelled = false
    api.get('/users')
      .then((res) => { if (!cancelled) setUsers(res.data.users || []) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (tab === 'deleted') loadDeleted()
  }, [tab])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/users', form)
      setForm({ username: '', password: '', role: 'editor' })
      setShowCreate(false)
      loadUsers()
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.users.createFailed'))
    }
  }

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviteError('')
    try {
      await api.post('/users/invite', inviteForm)
      setInviteForm({ email: '', display_name: '', role: 'editor' })
      setShowInvite(false)
      loadUsers()
    } catch (err) {
      setInviteError(err?.response?.data?.detail || t('admin.users.inviteFailed'))
    }
  }

  const handleDelete = async (u) => {
    if (!confirm(t('admin.users.confirmDelete', { username: u.username }))) return
    try {
      await api.delete(`/users/${u.id}`)
      loadUsers()
      // Keep the deleted list in sync even if it hasn't been opened yet,
      // so switching tabs later shows the fresh row without a flash.
      loadDeleted()
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.users.deleteFailed'))
    }
  }

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.put(`/users/${userId}`, { role: newRole })
      loadUsers()
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.users.roleUpdateFailed'))
    }
  }

  // Try restoring to the original username; if that slot is now occupied,
  // backend replies 409 — we prompt the admin for a replacement and retry once.
  const handleRestore = async (u) => {
    setBusyId(u.id)
    try {
      await api.post(`/users/${u.id}/restore`, {})
      await Promise.all([loadUsers(), loadDeleted()])
    } catch (err) {
      if (err?.response?.status === 409) {
        const suggestion = t('admin.users.restoreSuggestion', { username: u.original_username || 'user' })
        const alternative = prompt(
          t('admin.users.restorePrompt', { username: u.original_username }),
          suggestion,
        )
        if (!alternative || !alternative.trim()) {
          setBusyId(null)
          return
        }
        try {
          await api.post(`/users/${u.id}/restore`, { username: alternative.trim() })
          await Promise.all([loadUsers(), loadDeleted()])
        } catch (inner) {
          alert(inner?.response?.data?.detail || t('admin.users.restoreFailed'))
        }
      } else {
        alert(err?.response?.data?.detail || t('admin.users.restoreFailed'))
      }
    } finally {
      setBusyId(null)
    }
  }

  const tabClass = (name) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${
      tab === name
        ? 'bg-primary text-primary-text'
        : 'bg-surface-hover border border-border text-text hover:bg-surface-active'
    }`

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-text">{t('admin.users.title')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setTab('active')} className={tabClass('active')}>
            {t('admin.users.tabActive')} {users.length > 0 && <span className="text-xs opacity-70">({users.length})</span>}
          </button>
          <button type="button" onClick={() => setTab('deleted')} className={tabClass('deleted')}>
            {t('admin.users.tabDeleted')} {deletedUsers.length > 0 && <span className="text-xs opacity-70">({deletedUsers.length})</span>}
          </button>
          {tab === 'active' && (
            <>
              <button
                onClick={() => { setShowInvite(!showInvite); setShowCreate(false) }}
                className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
                title={t('admin.users.inviteSsoTitle')}
              >
                {t('admin.users.inviteSso')}
              </button>
              <button
                onClick={() => { setShowCreate(!showCreate); setShowInvite(false) }}
                className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
              >
                {t('admin.users.addUser')}
              </button>
            </>
          )}
        </div>
      </div>

      {tab === 'active' && showInvite && (
        <form onSubmit={handleInvite} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border">
          <p className="text-xs text-text-secondary mb-2">
            {t('admin.users.inviteIntro')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder={t('admin.users.emailPlaceholder')}
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder={t('admin.users.displayNamePlaceholder')}
              value={inviteForm.display_name}
              onChange={(e) => setInviteForm({ ...inviteForm, display_name: e.target.value })}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            >
              <option value="editor">{t('admin.users.role.editor')}</option>
              <option value="viewer">{t('admin.users.role.viewer')}</option>
              <option value="admin">{t('admin.users.role.admin')}</option>
            </select>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              {t('admin.users.inviteBtn')}
            </button>
          </div>
          {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
        </form>
      )}

      {tab === 'active' && showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder={t('admin.users.usernamePlaceholder')}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="password"
              placeholder={t('admin.users.passwordPlaceholder')}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            >
              <option value="editor">{t('admin.users.role.editor')}</option>
              <option value="viewer">{t('admin.users.role.viewer')}</option>
              <option value="admin">{t('admin.users.role.admin')}</option>
            </select>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              {t('admin.users.create')}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      )}

      {tab === 'active' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.username')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.role')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.created')}</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border">
                  <td className="py-2 px-3 text-text">{u.username}</td>
                  <td className="py-2 px-3">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="text-sm px-2 py-1 border border-border rounded bg-surface text-text"
                    >
                      <option value="editor">{t('admin.users.role.editor')}</option>
                      <option value="viewer">{t('admin.users.role.viewer')}</option>
                      <option value="admin">{t('admin.users.role.admin')}</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                  <td className="py-2 px-3 text-right">
                    <button onClick={() => handleDelete(u)} className="text-red-500 hover:text-red-700 text-sm">
                      {t('admin.users.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deleted' && (
        deletedUsers.length === 0 ? (
          <div className="text-center py-8 text-text-secondary">
            {t('admin.users.emptyDeleted')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.originalUsername')}</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.displayName')}</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.role')}</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.deleted')}</th>
                  <th className="text-right py-2 px-3 text-text-secondary font-medium">{t('admin.users.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {deletedUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border">
                    <td className="py-2 px-3 text-text">{u.original_username || t('admin.users.userNumber', { id: u.id })}</td>
                    <td className="py-2 px-3 text-text-secondary">{u.display_name || '—'}</td>
                    <td className="py-2 px-3 text-text-secondary">{u.role}</td>
                    <td className="py-2 px-3 text-text-secondary">
                      {u.deleted_at ? new Date(u.deleted_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleRestore(u)}
                        disabled={busyId === u.id}
                        className="text-sm text-primary hover:underline disabled:opacity-50"
                      >
                        {busyId === u.id ? t('admin.users.restoring') : t('admin.users.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function GroupsSection() {
  const { t } = useTranslation()
  const { groups, fetchGroups, createGroup, deleteGroup, membersByGroup, fetchMembers, addMember, removeMember } = useGroups()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [userSearchTerm, setUserSearchTerm] = useState('')
  const [userResults, setUserResults] = useState([])
  const [activeGroupId, setActiveGroupId] = useState(null)

  useEffect(() => {
    fetchGroups()
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await createGroup(form.name.trim(), form.description.trim())
      setForm({ name: '', description: '' })
      setShowCreate(false)
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.groups.createFailed'))
    }
  }

  const handleDelete = async (group) => {
    if (!confirm(t('admin.groups.confirmDelete', { name: group.name }))) return
    try {
      await deleteGroup(group.id)
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.groups.deleteFailed'))
    }
  }

  const toggle = async (group) => {
    const next = new Set(expanded)
    if (next.has(group.id)) {
      next.delete(group.id)
    } else {
      next.add(group.id)
      await fetchMembers(group.id)
    }
    setExpanded(next)
    setActiveGroupId(group.id)
  }

  const runUserSearch = async (q) => {
    setUserSearchTerm(q)
    if (!q.trim()) {
      setUserResults([])
      return
    }
    try {
      const res = await api.get('/users/search', { params: { q: q.trim(), limit: 10 } })
      setUserResults(res.data || [])
    } catch {
      setUserResults([])
    }
  }

  const handleAdd = async (groupId, userId) => {
    try {
      await addMember(groupId, userId)
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.groups.addFailed'))
    }
  }

  const handleRemove = async (groupId, userId) => {
    try {
      await removeMember(groupId, userId)
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.groups.removeFailed'))
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">{t('admin.groups.title')}</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
        >
          {t('admin.groups.newGroup')}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder={t('admin.groups.namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder={t('admin.groups.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              {t('admin.groups.create')}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('admin.groups.empty')}</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded.has(g.id)
            const members = membersByGroup[g.id] || []
            return (
              <div key={g.id} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center px-4 py-2 bg-surface-hover">
                  <button
                    onClick={() => toggle(g)}
                    className="flex-1 text-left text-sm text-text flex items-center gap-2"
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="text-text-secondary">· {t('admin.groups.members', { count: g.member_count })}</span>
                    {g.description && <span className="text-text-secondary italic">— {g.description}</span>}
                  </button>
                  <button
                    onClick={() => handleDelete(g)}
                    className="text-sm text-red-500 hover:text-red-700"
                  >
                    {t('admin.groups.delete')}
                  </button>
                </div>
                {isOpen && (
                  <div className="px-4 py-3 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{t('admin.groups.membersHeading')}</div>
                      {members.length === 0 ? (
                        <p className="text-sm text-text-secondary">{t('admin.groups.noMembers')}</p>
                      ) : (
                        <ul className="space-y-1">
                          {members.map((m) => (
                            <li key={m.id} className="flex items-center justify-between text-sm">
                              <span className="text-text">
                                {m.display_name || m.username}
                                {m.display_name && <span className="text-text-secondary"> ({m.username})</span>}
                              </span>
                              <button
                                onClick={() => handleRemove(g.id, m.id)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                {t('admin.groups.remove')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{t('admin.groups.addMember')}</div>
                      <input
                        type="text"
                        placeholder={t('admin.groups.searchUsers')}
                        value={activeGroupId === g.id ? userSearchTerm : ''}
                        onFocus={() => { setActiveGroupId(g.id); setUserResults([]) }}
                        onChange={(e) => runUserSearch(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
                      />
                      {activeGroupId === g.id && userResults.length > 0 && (
                        <ul className="mt-2 border border-border rounded-lg divide-y divide-border">
                          {userResults.map((u) => {
                            const alreadyMember = members.some((m) => m.id === u.id)
                            return (
                              <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                <span className="text-text">
                                  {u.display_name || u.username}
                                  {u.display_name && <span className="text-text-secondary"> ({u.username})</span>}
                                  <span className="ml-2 text-xs text-text-secondary">[{u.role}]</span>
                                </span>
                                <button
                                  disabled={alreadyMember}
                                  onClick={() => handleAdd(g.id, u.id)}
                                  className="text-xs text-primary disabled:text-text-secondary"
                                >
                                  {alreadyMember ? t('admin.groups.alreadyMember') : t('admin.groups.add')}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


function MediaLibraryPanel() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [copied, setCopied] = useState(null)

  const loadMedia = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/media')
      setItems(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.media.failedLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMedia()
  }, [])

  const handleDelete = async (item) => {
    if (item.reference_count > 0) return
    if (!confirm(t('admin.media.confirmDelete', { name: item.original_name }))) return
    try {
      await api.delete(`/media/${item.id}`)
      setItems((prev) => prev.filter((m) => m.id !== item.id))
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.media.deleteFailed'))
    }
  }

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyMarkdown = async (item) => {
    const label = (item.original_name || '').replace(/[[\]()]/g, '')
    const snippet = item.mime_type?.startsWith('image/')
      ? `![${label}](${item.url})`
      : `[${label}](${item.url})`
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(item.id)
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1500)
    } catch {
      alert(t('admin.media.copyFailed', { snippet }))
    }
  }

  const totalSize = items.reduce((sum, m) => sum + (m.size_bytes || 0), 0)
  const unused = items.filter((m) => m.reference_count === 0).length

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {t('admin.media.summary', { count: items.length, size: formatBytes(totalSize), unused })}
        </p>
        <button
          onClick={loadMedia}
          className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
        >
          {t('admin.media.refresh')}
        </button>
      </div>

      {loading && <p className="text-sm text-text-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-secondary">{t('admin.media.empty')}</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.preview')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.file')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.size')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.usedBy')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.uploaded')}</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">{t('admin.media.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isImage = item.mime_type?.startsWith('image/')
                const isExpanded = expanded.has(item.id)
                const hasRefs = item.reference_count > 0
                return (
                  <Fragment key={item.id}>
                    <tr className="border-b border-border align-top">
                      <td className="py-2 px-3">
                        {isImage ? (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            <img src={item.url} alt={item.original_name} className="h-10 w-10 object-cover rounded border border-border" />
                          </a>
                        ) : (
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-text-secondary text-xs">
                            {item.mime_type || t('admin.media.fileFallback')}
                          </a>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text">
                        <div className="truncate max-w-[220px]" title={item.original_name}>{item.original_name}</div>
                        <div className="text-xs text-text-secondary truncate max-w-[220px]" title={item.filename}>{item.filename}</div>
                      </td>
                      <td className="py-2 px-3 text-text-secondary">{formatBytes(item.size_bytes)}</td>
                      <td className="py-2 px-3">
                        {hasRefs ? (
                          <button
                            onClick={() => toggleExpanded(item.id)}
                            className="text-primary hover:underline"
                          >
                            {t('admin.media.pages', { count: item.reference_count })}
                          </button>
                        ) : (
                          <span className="text-text-secondary">{t('admin.media.unused')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text-secondary">
                        <div>{item.uploaded_by_name || '-'}</div>
                        <div className="text-xs">{item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : ''}</div>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => copyMarkdown(item)}
                          className="text-text-secondary hover:text-text text-sm mr-3"
                          title={t('admin.media.copyTitle')}
                        >
                          {copied === item.id ? t('admin.media.copied') : t('admin.media.copy')}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={hasRefs}
                          className="text-red-500 hover:text-red-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          title={hasRefs ? t('admin.media.deleteRefsTip') : t('admin.media.deleteTip')}
                        >
                          {t('admin.media.delete')}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && hasRefs && (
                      <tr className="border-b border-border bg-surface-hover">
                        <td colSpan={6} className="py-2 px-3">
                          <div className="text-xs text-text-secondary mb-1">{t('admin.media.referencedBy')}</div>
                          <ul className="flex flex-wrap gap-2">
                            {item.referenced_pages.map((p) => (
                              <li key={p.id}>
                                <Link
                                  to={`/page/${p.slug}`}
                                  className="text-primary hover:underline text-sm"
                                >
                                  {p.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DiagramsLibraryPanel() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [copied, setCopied] = useState(null)
  const [unusedOnly, setUnusedOnly] = useState(false)

  const loadDiagrams = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/diagrams')
      setItems(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.diagrams.failedLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiagrams()
  }, [])

  const handleDelete = async (item) => {
    if (item.reference_count > 0) return
    if (!confirm(t('admin.diagrams.confirmDelete', { name: item.name }))) return
    try {
      await api.delete(`/diagrams/${item.id}`)
      setItems((prev) => prev.filter((d) => d.id !== item.id))
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.diagrams.deleteFailed'))
    }
  }

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const copyDirective = async (item) => {
    const snippet = `::drawio[${item.id}]`
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(item.id)
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1500)
    } catch {
      alert(t('admin.diagrams.copyFailed', { snippet }))
    }
  }

  const unusedCount = items.filter((d) => d.reference_count === 0).length
  const visible = unusedOnly ? items.filter((d) => d.reference_count === 0) : items

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {t('admin.diagrams.summary', { count: items.length, unused: unusedCount })}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={unusedOnly}
              onChange={(e) => setUnusedOnly(e.target.checked)}
            />
            {t('admin.diagrams.showUnusedOnly')}
          </label>
          <button
            onClick={loadDiagrams}
            className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
          >
            {t('admin.diagrams.refresh')}
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-text-secondary">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-secondary">{t('admin.diagrams.empty')}</p>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <p className="text-sm text-text-secondary">{t('admin.diagrams.emptyFiltered')}</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.diagrams.col.preview')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.diagrams.col.name')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.diagrams.col.usedBy')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.diagrams.col.created')}</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">{t('admin.diagrams.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const isExpanded = expanded.has(item.id)
                const hasRefs = item.reference_count > 0
                return (
                  <Fragment key={item.id}>
                    <tr className="border-b border-border align-top">
                      <td className="py-2 px-3">
                        {item.has_svg ? (
                          <img
                            src={`/api/diagrams/${item.id}/svg`}
                            alt={item.name}
                            className="h-10 w-10 object-contain rounded border border-border bg-white"
                          />
                        ) : (
                          <span className="text-xs text-text-secondary">{t('admin.diagrams.noPreview')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text">
                        <div className="truncate max-w-[260px]" title={item.name}>{item.name}</div>
                        <div className="text-xs text-text-secondary">{t('admin.diagrams.idLabel', { id: item.id })}</div>
                      </td>
                      <td className="py-2 px-3">
                        {hasRefs ? (
                          <button
                            onClick={() => toggleExpanded(item.id)}
                            className="text-primary hover:underline"
                          >
                            {t('admin.diagrams.pages', { count: item.reference_count })}
                          </button>
                        ) : (
                          <span className="text-text-secondary">{t('admin.diagrams.unused')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text-secondary">
                        <div>{item.created_by_name || '-'}</div>
                        <div className="text-xs">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}</div>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => copyDirective(item)}
                          className="text-text-secondary hover:text-text text-sm mr-3"
                          title={t('admin.diagrams.copyTitle')}
                        >
                          {copied === item.id ? t('admin.diagrams.copied') : t('admin.diagrams.copy')}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={hasRefs}
                          className="text-red-500 hover:text-red-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          title={hasRefs ? t('admin.diagrams.deleteRefsTip') : t('admin.diagrams.deleteTip')}
                        >
                          {t('admin.diagrams.delete')}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && hasRefs && (
                      <tr className="border-b border-border bg-surface-hover">
                        <td colSpan={5} className="py-2 px-3">
                          <div className="text-xs text-text-secondary mb-1">{t('admin.diagrams.referencedBy')}</div>
                          <ul className="flex flex-wrap gap-2">
                            {item.referenced_pages.map((p) => (
                              <li key={p.id}>
                                <Link
                                  to={`/page/${p.slug}`}
                                  className={`text-sm hover:underline ${p.deleted ? 'text-text-secondary italic' : 'text-primary'}`}
                                  title={p.deleted ? t('admin.diagrams.inTrashTitle') : undefined}
                                >
                                  {p.title}{p.deleted ? t('admin.diagrams.inTrash') : ''}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TemplatesSection() {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', content_md: '' })
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const loadTemplates = async () => {
    try {
      const res = await api.get('/templates')
      setTemplates(res.data || [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let cancelled = false
    api.get('/templates')
      .then((res) => { if (!cancelled) setTemplates(res.data || []) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  const resetForm = () => {
    setForm({ name: '', description: '', content_md: '' })
    setError('')
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.content_md.trim()) {
      setError(t('admin.templates.contentRequired'))
      return
    }
    try {
      await api.post('/templates', form)
      resetForm()
      setShowCreate(false)
      loadTemplates()
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.templates.createFailed'))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(t('admin.templates.confirmDelete'))) return
    try {
      await api.delete(`/templates/${id}`)
      loadTemplates()
    } catch (err) {
      alert(err?.response?.data?.detail || t('admin.templates.deleteFailed'))
    }
  }

  const startEdit = (tmpl) => {
    setEditing({ id: tmpl.id, name: tmpl.name, description: tmpl.description, content_md: tmpl.content_md })
    setError('')
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    setError('')
    if (!editing.content_md.trim()) {
      setError(t('admin.templates.contentRequired'))
      return
    }
    try {
      await api.put(`/templates/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        content_md: editing.content_md,
      })
      setEditing(null)
      loadTemplates()
    } catch (err) {
      setError(err?.response?.data?.detail || t('admin.templates.saveFailed'))
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">{t('admin.templates.title')}</h2>
        <button
          onClick={() => { setShowCreate(!showCreate); resetForm() }}
          className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
        >
          {t('admin.templates.addTemplate')}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder={t('admin.templates.namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder={t('admin.templates.descriptionPlaceholder')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
          </div>
          <div className="border border-border rounded-lg overflow-hidden min-h-[200px] max-h-[400px] overflow-y-auto bg-surface">
            <Editor
              defaultValue={form.content_md}
              onChange={(md) => setForm((prev) => ({ ...prev, content_md: md }))}
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              {t('admin.templates.create')}
            </button>
            <button type="button" onClick={() => { setShowCreate(false); resetForm() }} className="px-4 py-2 text-sm text-text-secondary hover:text-text">
              {t('admin.templates.cancel')}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('admin.templates.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.templates.col.name')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.templates.col.description')}</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">{t('admin.templates.col.created')}</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">{t('admin.templates.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tmpl) => (
                <tr key={tmpl.id} className="border-b border-border">
                  <td className="py-2 px-3 text-text">{tmpl.name}</td>
                  <td className="py-2 px-3 text-text-secondary">{tmpl.description || '-'}</td>
                  <td className="py-2 px-3 text-text-secondary">{tmpl.created_at ? new Date(tmpl.created_at).toLocaleDateString() : '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(tmpl)} className="text-primary hover:underline text-sm mr-3">
                      {t('admin.templates.edit')}
                    </button>
                    <button onClick={() => handleDelete(tmpl.id)} className="text-red-500 hover:text-red-700 text-sm">
                      {t('admin.templates.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form onSubmit={handleUpdate} className="bg-surface rounded-xl shadow-lg border border-border p-6 w-full max-w-3xl mx-4 space-y-3">
            <h3 className="text-lg font-semibold text-text">{t('admin.templates.editTitle')}</h3>
            <input
              type="text"
              placeholder={t('admin.templates.namePlaceholder')}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder={t('admin.templates.descriptionPlaceholder')}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <div className="border border-border rounded-lg overflow-hidden min-h-[250px] max-h-[400px] overflow-y-auto bg-surface">
              <Editor
                key={editing.id}
                defaultValue={editing.content_md}
                onChange={(md) => setEditing((prev) => prev ? { ...prev, content_md: md } : prev)}
              />
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover">
                {t('admin.templates.save')}
              </button>
              <button type="button" onClick={() => { setEditing(null); setError('') }} className="px-4 py-2 text-sm text-text-secondary hover:text-text">
                {t('admin.templates.cancel')}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        </div>
      )}
    </div>
  )
}

function LibrarySection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('media')

  const tabClass = (name) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${
      tab === name
        ? 'bg-primary text-primary-text'
        : 'bg-surface-hover border border-border text-text hover:bg-surface-active'
    }`

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">{t('admin.library.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('media')}
            className={tabClass('media')}
          >
            {t('admin.library.tabMedia')}
          </button>
          <button
            type="button"
            onClick={() => setTab('diagrams')}
            className={tabClass('diagrams')}
          >
            {t('admin.library.tabDiagrams')}
          </button>
        </div>
      </div>

      {tab === 'media' ? <MediaLibraryPanel /> : <DiagramsLibraryPanel />}
    </div>
  )
}

export default function Admin() {
  const { t } = useTranslation()
  const { user } = useAuth()

  if (user?.role !== 'admin') {
    return <div className="text-center text-text-secondary mt-8">{t('admin.adminRequired')}</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-text">{t('admin.title')}</h1>
      <SiteSettingsSection />
      <UsersSection />
      <GroupsSection />
      <TemplatesSection />
      <LibrarySection />
      <BackupSection />
      <ExportSection />
    </div>
  )
}
