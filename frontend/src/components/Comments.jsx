import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAuth from '../store/useAuth'
import api from '../api/client'

function CommentItem({ comment, currentUser, onDelete, onUpdate }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const isOwner = currentUser?.id === comment.user_id
  const isAdmin = currentUser?.role === 'admin'

  const handleSave = async () => {
    if (!editContent.trim()) return
    await onUpdate(comment.id, editContent.trim())
    setEditing(false)
  }

  return (
    <div className="flex gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-primary-soft text-primary flex items-center justify-center text-sm font-medium shrink-0">
        {((comment.display_name || comment.username) || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-text">{comment.display_name || comment.username}</span>
          <span className="text-xs text-text-secondary">{new Date(comment.created_at).toLocaleString()}</span>
          {comment.updated_at !== comment.created_at && (
            <span className="text-xs text-text-secondary">{t('comments.edited')}</span>
          )}
        </div>
        {editing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-2 border border-border rounded-lg text-sm focus:outline-none focus:border-primary resize-none bg-surface text-text"
              rows={3}
            />
            <div className="flex gap-2 mt-1">
              <button onClick={handleSave} className="text-xs px-3 py-1 bg-primary text-primary-text rounded hover:bg-primary-hover">{t('comments.save')}</button>
              <button onClick={() => { setEditing(false); setEditContent(comment.content) }} className="text-xs px-3 py-1 text-text-secondary hover:text-text">{t('comments.cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text whitespace-pre-wrap">{comment.content}</div>
        )}
        {!editing && (isOwner || isAdmin) && (
          <div className="flex gap-3 mt-1">
            {isOwner && (
              <button onClick={() => setEditing(true)} className="text-xs text-text-secondary hover:text-text">{t('comments.edit')}</button>
            )}
            <button onClick={() => onDelete(comment.id)} className="text-xs text-text-secondary hover:text-red-500">{t('comments.delete')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Comments({ slug }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [comments, setComments] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadedSlug, setLoadedSlug] = useState(slug)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset loading when the slug changes (adjusting state during render).
  if (loadedSlug !== slug) {
    setLoadedSlug(slug)
    setLoading(true)
  }

  const loadComments = async () => {
    try {
      const res = await api.get(`/pages/${slug}/comments`)
      setComments(res.data.comments || [])
      setTotal(res.data.total || 0)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let cancelled = false
    api.get(`/pages/${slug}/comments`)
      .then((res) => {
        if (cancelled) return
        setComments(res.data.comments || [])
        setTotal(res.data.total || 0)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slug])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!newComment.trim() || submitting) return
    setSubmitting(true)
    try {
      await api.post(`/pages/${slug}/comments`, { content: newComment.trim() })
      setNewComment('')
      loadComments()
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const handleDelete = async (commentId) => {
    if (!confirm(t('comments.confirmDelete'))) return
    try {
      await api.delete(`/pages/${slug}/comments/${commentId}`)
      loadComments()
    } catch { /* ignore */ }
  }

  const handleUpdate = async (commentId, content) => {
    try {
      await api.put(`/pages/${slug}/comments/${commentId}`, { content })
      loadComments()
    } catch { /* ignore */ }
  }

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-6">
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
        {total > 0 ? t('comments.titleCount', { count: total }) : t('comments.title')}
      </h3>

      {loading ? (
        <div className="text-sm text-text-secondary">{t('common.loading')}</div>
      ) : (
        <>
          {comments.length > 0 && (
            <div className="divide-y divide-border mb-4">
              {comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  currentUser={user}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}

          {user?.anonymous ? (
            <div className="text-sm text-text-secondary text-center py-2">
              {t('comments.signInToReply')}
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={t('comments.placeholder')}
                className="w-full p-3 border border-border bg-surface text-text rounded-lg text-sm focus:outline-none focus:border-primary resize-none"
                rows={3}
              />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={submitting || !newComment.trim()}
                  className="px-4 py-2 bg-primary text-primary-text rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50"
                >
                  {submitting ? t('comments.posting') : t('comments.post')}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
