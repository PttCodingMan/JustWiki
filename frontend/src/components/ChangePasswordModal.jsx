import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../api/client'

export default function ChangePasswordModal({ isOpen, onClose }) {
  const { t } = useTranslation()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const reset = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setSuccess(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 4) {
      setError(t('changePassword.tooShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.mismatch'))
      return
    }

    setLoading(true)
    try {
      await api.put('/auth/password', {
        old_password: oldPassword,
        new_password: newPassword,
      })
      setSuccess(true)
      setTimeout(handleClose, 1500)
    } catch (err) {
      setError(err?.response?.data?.detail || t('changePassword.failed'))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-surface rounded-xl shadow-xl w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text mb-4">{t('changePassword.title')}</h2>

        {success ? (
          <div className="p-3 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">
            {t('changePassword.success')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-text mb-1">{t('changePassword.current')}</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">{t('changePassword.new')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">{t('changePassword.confirm')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text focus:outline-none focus:border-primary"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text"
              >
                {t('changePassword.cancel')}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
              >
                {loading ? t('changePassword.saving') : t('changePassword.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
