import { useState, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import useAuth from '../store/useAuth'
import useGroups from '../store/useGroups'
import api from '../api/client'
import Editor from '../components/Editor/Editor'

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function BackupSection() {
  const [restoring, setRestoring] = useState(false)
  const [message, setMessage] = useState(null)
  const fileRef = useRef(null)

  const handleBackup = () => {
    window.open('/api/backup', '_blank')
  }

  const handleRestore = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    if (!confirm('This will replace all data. Are you sure?')) return

    setRestoring(true)
    setMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post('/backup/restore', formData)
      setMessage({ type: 'success', text: 'Backup restored successfully. Reloading...' })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.detail || 'Restore failed' })
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <h2 className="text-lg font-semibold text-text mb-4">Backup & Restore</h2>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-text mb-2">Download Backup</h3>
          <p className="text-sm text-text-secondary mb-3">Download a .zip file containing the database and all media files.</p>
          <button onClick={handleBackup} className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover">
            Download Backup
          </button>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-text mb-2">Restore from Backup</h3>
          <p className="text-sm text-text-secondary mb-3">Upload a .zip backup to restore data. This replaces all current data.</p>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".zip" className="text-sm" />
            <button onClick={handleRestore} disabled={restoring} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
              {restoring ? 'Restoring...' : 'Restore'}
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
  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <h2 className="text-lg font-semibold text-text mb-4">Site Export</h2>
      <p className="text-sm text-text-secondary mb-3">Export the entire wiki as a static HTML website.</p>
      <button
        onClick={() => window.open('/api/export/site?format=html', '_blank')}
        className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
      >
        Export Static Site (.zip)
      </button>
    </div>
  )
}

function UsersSection() {
  const [tab, setTab] = useState('active')
  const [users, setUsers] = useState([])
  const [deletedUsers, setDeletedUsers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'editor' })
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
      setError(err?.response?.data?.detail || 'Failed to create user')
    }
  }

  const handleDelete = async (u) => {
    const label = u.username
    if (!confirm(
      `Delete user "${label}"?\n\nThis is a soft-delete — the account is deactivated, ` +
      `the username "${label}" is freed for reuse, and pages they authored keep their ` +
      `authorship. You can restore the account from the Deleted tab.`
    )) return
    try {
      await api.delete(`/users/${u.id}`)
      loadUsers()
      // Keep the deleted list in sync even if it hasn't been opened yet,
      // so switching tabs later shows the fresh row without a flash.
      loadDeleted()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete user')
    }
  }

  const handleRoleChange = async (userId, newRole) => {
    try {
      await api.put(`/users/${userId}`, { role: newRole })
      loadUsers()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to update role')
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
        const suggestion = `${u.original_username || 'user'}-restored`
        const alternative = prompt(
          `Username "${u.original_username}" is already in use. ` +
          `Enter a different username to restore the account under:`,
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
          alert(inner?.response?.data?.detail || 'Restore failed')
        }
      } else {
        alert(err?.response?.data?.detail || 'Restore failed')
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
        <h2 className="text-lg font-semibold text-text">Users</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setTab('active')} className={tabClass('active')}>
            Active {users.length > 0 && <span className="text-xs opacity-70">({users.length})</span>}
          </button>
          <button type="button" onClick={() => setTab('deleted')} className={tabClass('deleted')}>
            Deleted {deletedUsers.length > 0 && <span className="text-xs opacity-70">({deletedUsers.length})</span>}
          </button>
          {tab === 'active' && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
            >
              + Add User
            </button>
          )}
        </div>
      </div>

      {tab === 'active' && showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="password"
              placeholder="Password"
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
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              Create
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
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Username</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Role</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Created</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
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
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 text-text-secondary">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                  <td className="py-2 px-3 text-right">
                    <button onClick={() => handleDelete(u)} className="text-red-500 hover:text-red-700 text-sm">
                      Delete
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
            No deleted users.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">Original username</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">Display name</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">Role</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-medium">Deleted</th>
                  <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deletedUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border">
                    <td className="py-2 px-3 text-text">{u.original_username || `user #${u.id}`}</td>
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
                        {busyId === u.id ? 'Restoring…' : 'Restore'}
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
      setError(err?.response?.data?.detail || 'Failed to create group')
    }
  }

  const handleDelete = async (group) => {
    if (!confirm(`Delete group "${group.name}"? Any page ACL entries referencing it will be removed.`)) return
    try {
      await deleteGroup(group.id)
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete group')
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
      alert(err?.response?.data?.detail || 'Failed to add member')
    }
  }

  const handleRemove = async (groupId, userId) => {
    try {
      await removeMember(groupId, userId)
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to remove member')
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">Groups</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
        >
          + New Group
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Group name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-text-secondary">No groups yet.</p>
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
                    <span className="text-text-secondary">· {g.member_count} {g.member_count === 1 ? 'member' : 'members'}</span>
                    {g.description && <span className="text-text-secondary italic">— {g.description}</span>}
                  </button>
                  <button
                    onClick={() => handleDelete(g)}
                    className="text-sm text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
                {isOpen && (
                  <div className="px-4 py-3 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Members</div>
                      {members.length === 0 ? (
                        <p className="text-sm text-text-secondary">No members yet.</p>
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
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Add member</div>
                      <input
                        type="text"
                        placeholder="Search users..."
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
                                  {alreadyMember ? 'Already a member' : 'Add'}
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
      setError(err?.response?.data?.detail || 'Failed to load media')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMedia()
  }, [])

  const handleDelete = async (item) => {
    if (item.reference_count > 0) return
    if (!confirm(`Delete "${item.original_name}"? This cannot be undone.`)) return
    try {
      await api.delete(`/media/${item.id}`)
      setItems((prev) => prev.filter((m) => m.id !== item.id))
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete media')
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
      alert(`Copy failed. Markdown:\n${snippet}`)
    }
  }

  const totalSize = items.reduce((sum, m) => sum + (m.size_bytes || 0), 0)
  const unused = items.filter((m) => m.reference_count === 0).length

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {items.length} files · {formatBytes(totalSize)} total · {unused} unused
        </p>
        <button
          onClick={loadMedia}
          className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-text-secondary">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-secondary">No uploaded media yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Preview</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">File</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Size</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Used by</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Uploaded</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
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
                            {item.mime_type || 'file'}
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
                            {item.reference_count} page{item.reference_count === 1 ? '' : 's'}
                          </button>
                        ) : (
                          <span className="text-text-secondary">unused</span>
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
                          title="Copy markdown snippet to paste elsewhere"
                        >
                          {copied === item.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={hasRefs}
                          className="text-red-500 hover:text-red-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          title={hasRefs ? 'Cannot delete — media is referenced by a live page' : 'Delete media'}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isExpanded && hasRefs && (
                      <tr className="border-b border-border bg-surface-hover">
                        <td colSpan={6} className="py-2 px-3">
                          <div className="text-xs text-text-secondary mb-1">Referenced by:</div>
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
      setError(err?.response?.data?.detail || 'Failed to load diagrams')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDiagrams()
  }, [])

  const handleDelete = async (item) => {
    if (item.reference_count > 0) return
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    try {
      await api.delete(`/diagrams/${item.id}`)
      setItems((prev) => prev.filter((d) => d.id !== item.id))
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete diagram')
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
      alert(`Copy failed. Directive:\n${snippet}`)
    }
  }

  const unusedCount = items.filter((d) => d.reference_count === 0).length
  const visible = unusedOnly ? items.filter((d) => d.reference_count === 0) : items

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">
          {items.length} diagrams · {unusedCount} unused
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={unusedOnly}
              onChange={(e) => setUnusedOnly(e.target.checked)}
            />
            Show unused only
          </label>
          <button
            onClick={loadDiagrams}
            className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-text-secondary">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-text-secondary">No diagrams yet.</p>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <p className="text-sm text-text-secondary">No diagrams match the current filter.</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Preview</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Name</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Used by</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Created</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
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
                          <span className="text-xs text-text-secondary">no preview</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text">
                        <div className="truncate max-w-[260px]" title={item.name}>{item.name}</div>
                        <div className="text-xs text-text-secondary">id #{item.id}</div>
                      </td>
                      <td className="py-2 px-3">
                        {hasRefs ? (
                          <button
                            onClick={() => toggleExpanded(item.id)}
                            className="text-primary hover:underline"
                          >
                            {item.reference_count} page{item.reference_count === 1 ? '' : 's'}
                          </button>
                        ) : (
                          <span className="text-text-secondary">unused</span>
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
                          title="Copy ::drawio[id] directive"
                        >
                          {copied === item.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={hasRefs}
                          className="text-red-500 hover:text-red-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          title={hasRefs ? 'Cannot delete — diagram is referenced by a page (live or in trash)' : 'Delete diagram'}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isExpanded && hasRefs && (
                      <tr className="border-b border-border bg-surface-hover">
                        <td colSpan={5} className="py-2 px-3">
                          <div className="text-xs text-text-secondary mb-1">Referenced by:</div>
                          <ul className="flex flex-wrap gap-2">
                            {item.referenced_pages.map((p) => (
                              <li key={p.id}>
                                <Link
                                  to={`/page/${p.slug}`}
                                  className={`text-sm hover:underline ${p.deleted ? 'text-text-secondary italic' : 'text-primary'}`}
                                  title={p.deleted ? 'This page is currently in the trash' : undefined}
                                >
                                  {p.title}{p.deleted ? ' (in trash)' : ''}
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
      setError('Content is required')
      return
    }
    try {
      await api.post('/templates', form)
      resetForm()
      setShowCreate(false)
      loadTemplates()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to create template')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this template?')) return
    try {
      await api.delete(`/templates/${id}`)
      loadTemplates()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Failed to delete template')
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
      setError('Content is required')
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
      setError(err?.response?.data?.detail || 'Failed to update template')
    }
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">Templates</h2>
        <button
          onClick={() => { setShowCreate(!showCreate); resetForm() }}
          className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
        >
          + Add Template
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-surface-hover rounded-lg border border-border space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Template name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder="Description (optional)"
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
              Create
            </button>
            <button type="button" onClick={() => { setShowCreate(false); resetForm() }} className="px-4 py-2 text-sm text-text-secondary hover:text-text">
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-text-secondary">No templates yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Name</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Description</th>
                <th className="text-left py-2 px-3 text-text-secondary font-medium">Created</th>
                <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border">
                  <td className="py-2 px-3 text-text">{t.name}</td>
                  <td className="py-2 px-3 text-text-secondary">{t.description || '-'}</td>
                  <td className="py-2 px-3 text-text-secondary">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(t)} className="text-primary hover:underline text-sm mr-3">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700 text-sm">
                      Delete
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
            <h3 className="text-lg font-semibold text-text">Edit Template</h3>
            <input
              type="text"
              placeholder="Template name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
            />
            <input
              type="text"
              placeholder="Description (optional)"
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
                Save
              </button>
              <button type="button" onClick={() => { setEditing(null); setError('') }} className="px-4 py-2 text-sm text-text-secondary hover:text-text">
                Cancel
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
        <h2 className="text-lg font-semibold text-text">Library</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('media')}
            className={tabClass('media')}
          >
            Images &amp; Files
          </button>
          <button
            type="button"
            onClick={() => setTab('diagrams')}
            className={tabClass('diagrams')}
          >
            Diagrams
          </button>
        </div>
      </div>

      {tab === 'media' ? <MediaLibraryPanel /> : <DiagramsLibraryPanel />}
    </div>
  )
}

export default function Admin() {
  const { user } = useAuth()

  if (user?.role !== 'admin') {
    return <div className="text-center text-text-secondary mt-8">Admin access required.</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-text">Admin</h1>
      <UsersSection />
      <GroupsSection />
      <TemplatesSection />
      <LibrarySection />
      <BackupSection />
      <ExportSection />
    </div>
  )
}
