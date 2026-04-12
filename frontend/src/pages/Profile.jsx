import { useState, useEffect } from 'react'
import useAuth from '../store/useAuth'
import api from '../api/client'

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
