import { useState, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import useAuth from '../store/useAuth'
import api from '../api/client'

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
  const [users, setUsers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: 'editor' })
  const [error, setError] = useState('')

  const loadUsers = async () => {
    try {
      const res = await api.get('/users')
      setUsers(res.data.users || [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let cancelled = false
    api.get('/users')
      .then((res) => { if (!cancelled) setUsers(res.data.users || []) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

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

  const handleDelete = async (userId) => {
    if (!confirm('Delete this user?')) return
    try {
      await api.delete(`/users/${userId}`)
      loadUsers()
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

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">Users</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover"
        >
          + Add User
        </button>
      </div>

      {showCreate && (
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
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              Create
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </form>
      )}

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
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="py-2 px-3 text-text-secondary">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                <td className="py-2 px-3 text-right">
                  <button onClick={() => handleDelete(u.id)} className="text-red-500 hover:text-red-700 text-sm">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MediaLibrarySection() {
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
    const snippet = item.mime_type?.startsWith('image/')
      ? `![${item.original_name}](${item.url})`
      : `[${item.original_name}](${item.url})`
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
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">Media Library</h2>
        <button
          onClick={loadMedia}
          className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active"
        >
          Refresh
        </button>
      </div>

      <p className="text-sm text-text-secondary mb-4">
        {items.length} files · {formatBytes(totalSize)} total · {unused} unused
      </p>

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
      <MediaLibrarySection />
      <BackupSection />
      <ExportSection />
    </div>
  )
}
