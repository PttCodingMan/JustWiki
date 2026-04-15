import { useEffect, useState } from 'react'
import api from '../api/client'
import useGroups from '../store/useGroups'

/**
 * AclManager — modal that edits a page's explicit ACL.
 *
 * Shows explicit rows on the page and inherited rows from ancestors
 * (purely informational; edits only affect the current page). Users can
 * add/remove grants against individual users or groups and flip each
 * grant between read and write. Saving PUTs the whole set atomically.
 */
export default function AclManager({ slug, open, onClose }) {
  const { groups, fetchGroups } = useGroups()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([]) // working copy; same shape as AclRowInput
  const [inherited, setInherited] = useState([])
  const [tab, setTab] = useState('users') // 'users' | 'groups'
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState([])
  const [principalNames, setPrincipalNames] = useState({}) // key: `${type}:${id}` → display name

  useEffect(() => {
    if (!open || !slug) return
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      api.get(`/pages/${slug}/acl`),
      fetchGroups(),
    ])
      .then(([aclRes]) => {
        if (cancelled) return
        const data = aclRes.data
        setRows(data.explicit.map((r) => ({
          principal_type: r.principal_type,
          principal_id: r.principal_id,
          permission: r.permission,
        })))
        setInherited(data.inherited || [])
        const names = {}
        for (const r of data.explicit) {
          names[`${r.principal_type}:${r.principal_id}`] = r.principal_name
        }
        for (const r of data.inherited || []) {
          names[`${r.principal_type}:${r.principal_id}`] = r.principal_name
        }
        setPrincipalNames(names)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.detail || 'Failed to load ACL')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, slug])

  const runUserSearch = async (q) => {
    setUserSearch(q)
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

  const addRow = (type, id, name) => {
    if (rows.some((r) => r.principal_type === type && r.principal_id === id)) return
    setRows([...rows, { principal_type: type, principal_id: id, permission: 'read' }])
    setPrincipalNames({ ...principalNames, [`${type}:${id}`]: name })
  }

  const removeRow = (type, id) => {
    setRows(rows.filter((r) => !(r.principal_type === type && r.principal_id === id)))
  }

  const setRowPermission = (type, id, perm) => {
    setRows(rows.map((r) =>
      r.principal_type === type && r.principal_id === id ? { ...r, permission: perm } : r
    ))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await api.put(`/pages/${slug}/acl`, { rows })
      onClose?.()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save ACL')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!confirm('Remove all explicit permissions? The page will fall back to inheritance.')) return
    setSaving(true)
    try {
      await api.delete(`/pages/${slug}/acl`)
      onClose?.()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to clear ACL')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface rounded-xl shadow-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Manage permissions</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <p className="text-text-secondary">Loading…</p>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                Leave empty to keep the page open to everyone (inherits from parent).
                Add users or groups below to restrict access. Most-permissive rule applies
                when the same user is granted through multiple rows.
              </p>

              <div>
                <h3 className="text-sm font-semibold text-text mb-2">Explicit grants</h3>
                {rows.length === 0 ? (
                  <p className="text-sm text-text-secondary italic">No explicit rows — page uses inherited permissions.</p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((r) => {
                      const key = `${r.principal_type}:${r.principal_id}`
                      const name = principalNames[key] || `${r.principal_type} ${r.principal_id}`
                      return (
                        <li key={key} className="flex items-center gap-3 p-2 border border-border rounded-lg">
                          <span className="flex-1 text-sm text-text">
                            <span className="text-text-secondary">[{r.principal_type}]</span> {name}
                          </span>
                          <select
                            value={r.permission}
                            onChange={(e) => setRowPermission(r.principal_type, r.principal_id, e.target.value)}
                            className="px-2 py-1 border border-border rounded text-sm bg-surface text-text"
                          >
                            <option value="read">Read</option>
                            <option value="write">Write</option>
                          </select>
                          <button
                            onClick={() => removeRow(r.principal_type, r.principal_id)}
                            className="text-sm text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-text mb-2">Add</h3>
                <div className="flex gap-2 mb-3 text-sm">
                  <button
                    onClick={() => setTab('users')}
                    className={`px-3 py-1 rounded ${tab === 'users' ? 'bg-primary text-primary-text' : 'bg-surface-hover text-text'}`}
                  >
                    Users
                  </button>
                  <button
                    onClick={() => setTab('groups')}
                    className={`px-3 py-1 rounded ${tab === 'groups' ? 'bg-primary text-primary-text' : 'bg-surface-hover text-text'}`}
                  >
                    Groups
                  </button>
                </div>

                {tab === 'users' ? (
                  <div>
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={userSearch}
                      onChange={(e) => runUserSearch(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary bg-surface text-text"
                    />
                    {userResults.length > 0 && (
                      <ul className="mt-2 border border-border rounded-lg divide-y divide-border">
                        {userResults.map((u) => {
                          const already = rows.some(
                            (r) => r.principal_type === 'user' && r.principal_id === u.id
                          )
                          return (
                            <li key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                              <span className="text-text">
                                {u.display_name || u.username}
                                {u.display_name && <span className="text-text-secondary"> ({u.username})</span>}
                                <span className="ml-2 text-xs text-text-secondary">[{u.role}]</span>
                              </span>
                              <button
                                disabled={already}
                                onClick={() => addRow('user', u.id, u.display_name || u.username)}
                                className="text-xs text-primary disabled:text-text-secondary"
                              >
                                {already ? 'Added' : 'Add'}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div>
                    {groups.length === 0 ? (
                      <p className="text-sm text-text-secondary">No groups yet. Create one in Admin → Groups.</p>
                    ) : (
                      <ul className="border border-border rounded-lg divide-y divide-border">
                        {groups.map((g) => {
                          const already = rows.some(
                            (r) => r.principal_type === 'group' && r.principal_id === g.id
                          )
                          return (
                            <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                              <span className="text-text">
                                {g.name}
                                <span className="ml-2 text-xs text-text-secondary">· {g.member_count} members</span>
                              </span>
                              <button
                                disabled={already}
                                onClick={() => addRow('group', g.id, g.name)}
                                className="text-xs text-primary disabled:text-text-secondary"
                              >
                                {already ? 'Added' : 'Add'}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {inherited.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-text mb-2">Inherited from ancestors</h3>
                  <ul className="space-y-1">
                    {inherited.map((r, i) => (
                      <li key={i} className="text-sm text-text-secondary">
                        <span className="text-text">
                          [{r.principal_type}] {r.principal_name || `${r.principal_type} ${r.principal_id}`}
                        </span>
                        {' '}· {r.permission}
                        {' '}· from <code className="text-xs">{r.source_page_title}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface-hover">
          <button
            onClick={handleClear}
            disabled={loading || saving || rows.length === 0}
            className="text-sm text-red-500 hover:text-red-700 disabled:text-text-secondary"
          >
            Clear all (revert to inheritance)
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-text border border-border rounded-lg hover:bg-surface"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving}
              className="px-4 py-2 text-sm bg-primary text-primary-text rounded-lg hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
