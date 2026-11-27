import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/client'
import { ReviewStatusChip } from '../components/PageReview'
import { reviewDueText } from '../lib/review'

/** Pages with periodic review turned on, most urgent first. */
export default function Reviews() {
  const { t } = useTranslation()
  const [scope, setScope] = useState('all') // 'all' | 'mine'
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/reviews', { params: { scope } })
      setItems(res.data.items || [])
    } catch (err) {
      setError(err?.response?.data?.detail || t('reviews.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [scope, t])

  useEffect(() => { load() }, [load])

  const tabCls = (active) =>
    `h-8 px-3 rounded-lg text-sm font-medium transition-colors ${
      active ? 'bg-primary-soft text-sidebar-active-text' : 'text-text-secondary hover:text-text hover:bg-surface-hover'
    }`

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="page-title mb-2">{t('reviews.title')}</h1>
      <p className="text-sm text-text-secondary mb-6">{t('reviews.intro')}</p>

      <div className="flex gap-1 mb-4" role="tablist">
        <button role="tab" aria-selected={scope === 'all'} className={tabCls(scope === 'all')} onClick={() => setScope('all')}>
          {t('reviews.all')}
        </button>
        <button role="tab" aria-selected={scope === 'mine'} className={tabCls(scope === 'mine')} onClick={() => setScope('mine')}>
          {t('reviews.mine')}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 text-red-600 text-sm rounded-lg border border-red-500/25">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-text-secondary">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-text-secondary bg-surface rounded-2xl border border-hairline shadow-xs">
          {scope === 'mine' ? t('reviews.emptyMine') : t('reviews.empty')}
        </div>
      ) : (
        <ul className="bg-surface rounded-2xl shadow-sm border border-hairline divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <li key={item.page_id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Link to={`/page/${item.slug}`} className="font-medium text-text hover:text-primary min-w-0 flex-1 truncate">
                {item.title}
              </Link>
              <ReviewStatusChip status={item.status} />
              <span className="text-text-secondary whitespace-nowrap">{reviewDueText(t, item)}</span>
              <span className="text-text-secondary w-32 truncate">
                {item.owner_username ? (
                  <Link to={`/u/${encodeURIComponent(item.owner_username)}`} className="hover:text-text hover:underline">
                    {item.owner_name || item.owner_username}
                  </Link>
                ) : t('review.noOwner')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
