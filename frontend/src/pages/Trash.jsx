import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import useAuth from '../store/useAuth'
import usePages from '../store/usePages'

export default function Trash() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busySlug, setBusySlug] = useState(null)
  const { user } = useAuth()
  const { fetchTree } = usePages()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/trash')
      setItems(res.data.items || [])
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load trash')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRestore = async (slug) => {
    setBusySlug(slug)
    try {
      await api.post(`/trash/${slug}/restore`)
      await fetchTree()
      await load()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Restore failed')
    } finally {
      setBusySlug(null)
    }
  }

  const handlePurge = async (slug, title) => {
    if (!confirm(`Permanently delete "${title}"? This cannot be undone.`)) return
    setBusySlug(slug)
    try {
      await api.delete(`/trash/${slug}`)
      await load()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Purge failed')
    } finally {
      setBusySlug(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text">Trash</h1>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-text-secondary hover:text-text"
        >
          ← Back
        </button>
      </div>

      <p className="text-sm text-text-secondary mb-6">
        Deleted pages are kept here so you can restore them if needed.
        {user?.role === 'admin'
          ? ' As an admin you can permanently purge any trashed page.'
          : ' Only the original creator (or an admin) can restore a trashed page.'}
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-text-secondary">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-text-secondary bg-surface rounded-xl border border-border">
          <div className="text-4xl mb-2">🗑</div>
          <div>Trash is empty</div>
        </div>
      ) : (
        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-border bg-surface-hover">
              <tr className="text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Deleted</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id} className="text-sm">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text">{item.title}</div>
                    <div className="text-xs text-text-secondary">/{item.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {item.author_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRestore(item.slug)}
                      disabled={busySlug === item.slug}
                      className="text-sm text-primary hover:underline mr-3 disabled:opacity-50"
                    >
                      Restore
                    </button>
                    {user?.role === 'admin' && (
                      <button
                        onClick={() => handlePurge(item.slug, item.title)}
                        disabled={busySlug === item.slug}
                        className="text-sm text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete forever
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
