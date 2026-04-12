import { useEffect } from 'react'

/**
 * Minimal confirmation dialog.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={showConfirm}
 *     title="Make this page public?"
 *     description={<>"{page.title}"<br />You can switch it back to private later.</>}
 *     confirmLabel="Make public"
 *     onConfirm={async () => { ... }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'primary', // "primary" | "danger"
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const confirmCls =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-primary hover:bg-primary-hover text-primary-text'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface rounded-xl shadow-lg border border-border w-full max-w-sm">
        <div className="p-5">
          <h2 className="text-lg font-semibold text-text mb-2">{title}</h2>
          {description && (
            <div className="text-sm text-text-secondary">{description}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-sm text-text border border-border hover:bg-surface-hover"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-lg text-sm ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
