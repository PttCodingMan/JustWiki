import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

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
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'primary', // "primary" | "danger"
}) {
  const { t } = useTranslation()
  const finalConfirmLabel = confirmLabel ?? t('confirm.confirm')
  const finalCancelLabel = cancelLabel ?? t('confirm.cancel')
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
      ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
      : 'btn-primary'

  return (
    <div
      className="fixed inset-0 bg-[color-mix(in_oklab,var(--color-text)_25%,transparent)] backdrop-blur-[3px] z-[100] flex items-center justify-center p-4 animate-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel?.()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface rounded-2xl shadow-2xl ring-1 ring-hairline w-full max-w-sm overflow-hidden animate-pop">
        <div className="p-6">
          <h2 className="text-[17px] font-semibold tracking-tight text-text mb-2">{title}</h2>
          {description && (
            <div className="text-sm text-text-secondary">{description}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 bg-bg/60 border-t border-hairline">
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-[10px] text-[13px] font-medium text-text bg-surface border border-border shadow-xs hover:bg-surface-hover transition-colors"
          >
            {finalCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`h-9 px-4 rounded-[10px] text-[13px] font-medium transition-colors ${confirmCls}`}
          >
            {finalConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
