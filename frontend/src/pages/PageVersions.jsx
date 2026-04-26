import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/client'

function DiffViewer({ oldText, newText, v1, v2 }) {
  const { t } = useTranslation()
  const oldLines = (oldText || '').split('\n')
  const newLines = (newText || '').split('\n')

  // Simple LCS-based diff
  const diff = computeDiff(oldLines, newLines)

  return (
    <div className="grid grid-cols-2 gap-0 border border-gray-200 rounded-lg overflow-hidden text-sm font-mono">
      <div className="bg-gray-50 px-3 py-2 border-b border-r border-gray-200 font-sans font-medium text-gray-600 text-xs">
        {t('versions.diffOldHeader', { v: v1 })}
      </div>
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 font-sans font-medium text-gray-600 text-xs">
        {t('versions.diffNewHeader', { v: v2 })}
      </div>
      <div className="border-r border-gray-200 overflow-auto max-h-[600px]">
        {diff.map((d, i) => (
          <div
            key={`l-${i}`}
            className={`px-3 py-0.5 whitespace-pre-wrap break-all ${
              d.type === 'removed' ? 'bg-red-50 text-red-800' :
              d.type === 'modified' ? 'bg-yellow-50 text-yellow-800' :
              d.type === 'added' ? 'bg-gray-100 text-gray-400' :
              'text-gray-700'
            }`}
          >
            {d.type === 'added' ? '' : d.old}
          </div>
        ))}
      </div>
      <div className="overflow-auto max-h-[600px]">
        {diff.map((d, i) => (
          <div
            key={`r-${i}`}
            className={`px-3 py-0.5 whitespace-pre-wrap break-all ${
              d.type === 'added' ? 'bg-green-50 text-green-800' :
              d.type === 'modified' ? 'bg-yellow-50 text-yellow-800' :
              d.type === 'removed' ? 'bg-gray-100 text-gray-400' :
              'text-gray-700'
            }`}
          >
            {d.type === 'removed' ? '' : d.new}
          </div>
        ))}
      </div>
    </div>
  )
}

function computeDiff(oldLines, newLines) {
  const result = []
  let oi = 0, ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length) {
      if (oldLines[oi] === newLines[ni]) {
        result.push({ type: 'same', old: oldLines[oi], new: newLines[ni] })
        oi++; ni++
      } else {
        // Look ahead to find if old line appears later in new
        let foundInNew = newLines.indexOf(oldLines[oi], ni)
        let foundInOld = oldLines.indexOf(newLines[ni], oi)

        if (foundInNew !== -1 && (foundInOld === -1 || foundInNew - ni <= foundInOld - oi)) {
          // Lines were added before this point
          while (ni < foundInNew) {
            result.push({ type: 'added', old: '', new: newLines[ni] })
            ni++
          }
        } else if (foundInOld !== -1) {
          // Lines were removed
          while (oi < foundInOld) {
            result.push({ type: 'removed', old: oldLines[oi], new: '' })
            oi++
          }
        } else {
          // Modified line
          result.push({ type: 'modified', old: oldLines[oi], new: newLines[ni] })
          oi++; ni++
        }
      }
    } else if (oi < oldLines.length) {
      result.push({ type: 'removed', old: oldLines[oi], new: '' })
      oi++
    } else {
      result.push({ type: 'added', old: '', new: newLines[ni] })
      ni++
    }
  }
  return result
}

export default function PageVersions() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [diffData, setDiffData] = useState(null)
  const [selectedV1, setSelectedV1] = useState(null)
  const [selectedV2, setSelectedV2] = useState(null)
  const [reverting, setReverting] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(null)
  const [pageVersion, setPageVersion] = useState(null)

  useEffect(() => {
    api.get(`/pages/${slug}/versions`).then((res) => {
      setVersions(res.data.versions)
      setPageVersion(res.data.page_version)
      setLoading(false)
      // Auto-select latest two for diff
      if (res.data.versions.length >= 2) {
        const sorted = [...res.data.versions].sort((a, b) => a.version_num - b.version_num)
        setSelectedV1(sorted[sorted.length - 2].version_num)
        setSelectedV2(sorted[sorted.length - 1].version_num)
      }
    }).catch(() => {
      setLoading(false)
    })
  }, [slug])

  useEffect(() => {
    if (selectedV1 != null && selectedV2 != null && selectedV1 !== selectedV2) {
      const v1 = Math.min(selectedV1, selectedV2)
      const v2 = Math.max(selectedV1, selectedV2)
      api.get(`/pages/${slug}/diff`, { params: { v1, v2 } }).then((res) => {
        setDiffData(res.data)
      })
    } else {
      setDiffData(null)
    }
  }, [selectedV1, selectedV2, slug])

  const handleRevert = async (versionNum) => {
    setReverting(true)
    try {
      // Pin to the page version we loaded so a concurrent edit returns 409
      // instead of silently clobbering the other user's change.
      await api.post(`/pages/${slug}/revert/${versionNum}`, { base_version: pageVersion })
      setConfirmRevert(null)
      navigate(`/page/${slug}`)
    } catch (err) {
      alert(err?.response?.data?.detail || t('versions.revertFailed'))
    } finally {
      setReverting(false)
    }
  }

  if (loading) return <div className="text-text-secondary">{t('common.loading')}</div>

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/page/${slug}`)}
            className="text-text-secondary hover:text-text"
          >
            &larr;
          </button>
          <h1 className="text-2xl font-bold text-text">{t('versions.title')}</h1>
        </div>
        <Link
          to={`/page/${slug}`}
          className="px-3 py-1.5 text-sm text-text-secondary rounded-lg hover:bg-surface-hover"
        >
          {t('versions.back')}
        </Link>
      </div>

      {versions.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">{t('versions.empty')}</p>
          <p className="text-sm">{t('versions.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-6">
          {/* Timeline */}
          <div className="space-y-1">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
              {t('versions.list', { count: versions.length })}
            </div>
            {versions.map((v) => (
              <div
                key={v.version_num}
                className={`relative p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedV1 === v.version_num || selectedV2 === v.version_num
                    ? 'border-primary bg-primary-soft'
                    : 'border-border hover:border-text-secondary bg-surface'
                }`}
                onClick={() => {
                  if (selectedV1 === v.version_num) {
                    setSelectedV1(null)
                  } else if (selectedV2 === v.version_num) {
                    setSelectedV2(null)
                  } else if (!selectedV1) {
                    setSelectedV1(v.version_num)
                  } else if (!selectedV2) {
                    setSelectedV2(v.version_num)
                  } else {
                    setSelectedV1(selectedV2)
                    setSelectedV2(v.version_num)
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-text">v{v.version_num}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmRevert(v.version_num)
                    }}
                    className="text-xs text-primary hover:text-primary-hover"
                    title={t('versions.revertTitle')}
                  >
                    {t('versions.revert')}
                  </button>
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  {v.display_name || v.username || t('versions.unknownAuthor')} &middot; {new Date(v.edited_at).toLocaleString()}
                </div>
                <div className="text-xs text-text-secondary mt-0.5 truncate">{v.title}</div>
              </div>
            ))}
          </div>

          {/* Diff panel */}
          <div>
            {diffData ? (
              <DiffViewer
                oldText={diffData.v1.content_md}
                newText={diffData.v2.content_md}
                v1={diffData.v1.num}
                v2={diffData.v2.num}
              />
            ) : (
              <div className="text-center py-16 text-text-secondary border border-dashed border-border rounded-lg">
                {t('versions.selectTwo')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revert confirmation modal */}
      {confirmRevert && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-surface rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-text mb-2">{t('versions.confirmTitle', { v: confirmRevert })}</h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('versions.confirmBody')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRevert(null)}
                className="px-3 py-1.5 text-sm text-text-secondary rounded-lg hover:bg-surface-hover"
              >
                {t('versions.cancel')}
              </button>
              <button
                onClick={() => handleRevert(confirmRevert)}
                disabled={reverting}
                className="px-3 py-1.5 text-sm bg-primary text-primary-text rounded-lg hover:bg-primary-hover disabled:opacity-50"
              >
                {reverting ? t('versions.reverting') : t('versions.revert')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
