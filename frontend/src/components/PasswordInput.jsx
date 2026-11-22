import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Password field with a show/hide toggle.
 *
 * All extra props are forwarded to the underlying <input>. `className`
 * styles the input itself; `wrapperClassName` styles the positioning
 * wrapper (e.g. `flex-1` when the field sits in a flex row).
 */
export default function PasswordInput({ className = '', wrapperClassName = '', ...props }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const label = visible ? t('common.hidePassword') : t('common.showPassword')

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...props} type={visible ? 'text' : 'password'} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-text-tertiary hover:text-text-secondary focus:outline-none focus-visible:text-primary"
      >
        {visible ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
