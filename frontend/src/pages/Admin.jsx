import { useState, useEffect, useRef } from 'react'
import useAuth from '../store/useAuth'
import api from '../api/client'

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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Backup & Restore</h2>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Download Backup</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Download a .zip file containing the database and all media files.</p>
          <button onClick={handleBackup} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            Download Backup
          </button>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Restore from Backup</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Upload a .zip backup to restore data. This replaces all current data.</p>
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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Site Export</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Export the entire wiki as a static HTML website.</p>
      <button
        onClick={() => window.open('/api/export/site?format=html', '_blank')}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
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

  useEffect(() => { loadUsers() }, [])

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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Users</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          + Add User
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400"
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
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Username</th>
              <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Role</th>
              <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Created</th>
              <th className="text-right py-2 px-3 text-gray-500 dark:text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-100">
                <td className="py-2 px-3 text-gray-800 dark:text-gray-200">{u.username}</td>
                <td className="py-2 px-3">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="text-sm px-2 py-1 border border-gray-200 rounded"
                  >
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="py-2 px-3 text-gray-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
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

export default function Admin() {
  const { user } = useAuth()

  if (user?.role !== 'admin') {
    return <div className="text-center text-gray-500 mt-8">Admin access required.</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Admin</h1>
      <UsersSection />
      <BackupSection />
      <ExportSection />
    </div>
  )
}
