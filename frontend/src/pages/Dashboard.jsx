import { useEffect, useState, useCallback } from 'react'
import useAuth from '../store/useAuth'
import api from '../api/client'

function formatBytes(bytes) {
  if (bytes == null) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatPercent(value) {
  if (value == null) return 'N/A'
  return `${value.toFixed(1)}%`
}

// Stacked horizontal bar: DB / Media / Other-used / Free as a single
// 100%-wide strip. When disk totals aren't available, falls back to
// DB+Media scaled against their sum.
function StorageBar({ storage }) {
  const { disk_total_bytes: total, disk_used_bytes: used, db_size_bytes: db, media_size_bytes: media } = storage

  if (total == null || used == null) {
    const scale = (db || 0) + (media || 0)
    if (scale === 0) {
      return <div className="mt-3 text-xs text-text-secondary">No data</div>
    }
    const dbPct = (db / scale) * 100
    const mediaPct = (media / scale) * 100
    return (
      <div className="mt-3">
        <div className="flex h-3 rounded overflow-hidden bg-surface-hover">
          <div style={{ width: `${dbPct}%`, background: '#8b5cf6' }} title={`DB: ${formatBytes(db)}`} />
          <div style={{ width: `${mediaPct}%`, background: '#3b82f6' }} title={`Media: ${formatBytes(media)}`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
          <LegendDot color="#8b5cf6" label={`DB ${formatBytes(db)}`} />
          <LegendDot color="#3b82f6" label={`Media ${formatBytes(media)}`} />
          <span className="italic">disk total unavailable</span>
        </div>
      </div>
    )
  }

  const dbPct = (db / total) * 100
  const mediaPct = (media / total) * 100
  const otherUsed = Math.max(0, used - db - media)
  const otherPct = (otherUsed / total) * 100
  const freePct = Math.max(0, 100 - dbPct - mediaPct - otherPct)

  return (
    <div className="mt-3">
      <div className="flex h-3 rounded overflow-hidden bg-surface-hover">
        <div style={{ width: `${dbPct}%`, background: '#8b5cf6' }} title={`DB: ${formatBytes(db)}`} />
        <div style={{ width: `${mediaPct}%`, background: '#3b82f6' }} title={`Media: ${formatBytes(media)}`} />
        <div style={{ width: `${otherPct}%`, background: '#9ca3af' }} title={`Other used: ${formatBytes(otherUsed)}`} />
        <div style={{ width: `${freePct}%`, background: 'transparent' }} title={`Free: ${formatBytes(total - used)}`} />
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-text-secondary">
        <LegendDot color="#8b5cf6" label={`DB ${formatBytes(db)}`} />
        <LegendDot color="#3b82f6" label={`Media ${formatBytes(media)}`} />
        <LegendDot color="#9ca3af" label={`Other ${formatBytes(otherUsed)}`} />
        <LegendDot color="transparent" border label={`Free ${formatBytes(total - used)}`} />
      </div>
    </div>
  )
}

function LegendDot({ color, label, border }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{
          background: color,
          border: border ? '1px solid var(--color-border)' : 'none',
        }}
      />
      <span>{label}</span>
    </span>
  )
}

function StatCard({ title, value, sub }) {
  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
      <div className="text-xs uppercase tracking-wide text-text-secondary">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-text">{value}</div>
      {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
    </div>
  )
}

// Injected by Vite at build time. See frontend/vite.config.js.
// eslint-disable-next-line no-undef
const BUILD_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/dashboard/stats')
      setStats(res.data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') load()
  }, [user, load])

  if (user?.role !== 'admin') {
    return <div className="text-center text-text-secondary mt-8">Admin access required.</div>
  }

  const storage = stats?.storage
  const storageHeadline = storage
    ? storage.disk_total_bytes != null
      ? `${formatBytes(storage.disk_used_bytes)} / ${formatBytes(storage.disk_total_bytes)}`
      : `${formatBytes((storage.db_size_bytes || 0) + (storage.media_size_bytes || 0))} wiki data`
    : 'N/A'
  const storagePct = storage && storage.disk_total_bytes != null && storage.disk_total_bytes > 0
    ? (storage.disk_used_bytes / storage.disk_total_bytes) * 100
    : null

  const versionMatch = stats && stats.latest_version
    ? stats.app_version === stats.latest_version
    : null
  const versionSub = stats
    ? stats.latest_version
      ? versionMatch
        ? 'Up to date'
        : `Latest: ${stats.latest_version}`
      : stats.check_updates_enabled
        ? 'Check failed'
        : 'Update check disabled'
    : null

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">Dashboard</h1>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 bg-surface-hover border border-border text-text rounded-lg text-sm hover:bg-surface-active disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm bg-red-50 text-red-600 border border-red-200">
          {error}
        </div>
      )}

      {!stats && loading && <p className="text-sm text-text-secondary">Loading…</p>}

      {stats && (
        <>
          <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wide text-text-secondary">Storage</div>
              {storagePct != null && (
                <div className="text-xs text-text-secondary">{formatPercent(storagePct)} used</div>
              )}
            </div>
            <div className="mt-1 text-2xl font-semibold text-text">{storageHeadline}</div>
            {storage && <StorageBar storage={storage} />}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              title="Pages"
              value={stats.page_count}
              sub={`${stats.user_count} users`}
            />
            <StatCard
              title="Version"
              value={stats.app_version}
              sub={versionSub}
            />
            <StatCard
              title="Runtime"
              value={stats.python_version}
              sub={`SQLite ${stats.sqlite_version}`}
            />
          </div>

          <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Build</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-text-secondary">Frontend build</dt>
              <dd className="text-text">{BUILD_APP_VERSION}</dd>
              <dt className="text-text-secondary">Backend version</dt>
              <dd className="text-text">{stats.app_version}</dd>
            </dl>
          </div>
        </>
      )}
    </div>
  )
}
