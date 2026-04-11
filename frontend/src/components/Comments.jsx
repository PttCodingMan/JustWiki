import { useState, useEffect } from 'react'
import useAuth from '../store/useAuth'
import api from '../api/client'

function CommentItem({ comment, currentUser, onDelete, onUpdate }) {
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
      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium shrink-0">
        {((comment.display_name || comment.username) || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{comment.display_name || comment.username}</span>
          <span className="text-xs text-gray-400">{new Date(comment.created_at).toLocaleString()}</span>
          {comment.updated_at !== comment.created_at && (
            <span className="text-xs text-gray-400">(edited)</span>
          )}
        </div>
        {editing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-400 resize-none"
              rows={3}
            />
            <div className="flex gap-2 mt-1">
              <button onClick={handleSave} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
              <button onClick={() => { setEditing(false); setEditContent(comment.content) }} className="text-xs px-3 py-1 text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{comment.content}</div>
        )}
        {!editing && (isOwner || isAdmin) && (
          <div className="flex gap-3 mt-1">
            {isOwner && (
              <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-600">Edit</button>
            )}
            <button onClick={() => onDelete(comment.id)} className="text-xs text-gray-400 hover:text-red-500">Delete</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Comments({ slug }) {
  const { user } = useAuth()
  const [comments, setComments] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadComments = async () => {
    try {
      const res = await api.get(`/pages/${slug}/comments`)
      setComments(res.data.comments || [])
      setTotal(res.data.total || 0)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    loadComments()
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
    if (!confirm('Delete this comment?')) return
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
    <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
        Discussion {total > 0 && `(${total})`}
      </h3>

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : (
        <>
          {comments.length > 0 && (
            <div className="divide-y divide-gray-100 mb-4">
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

          <form onSubmit={handleSubmit}>
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              className="w-full p-3 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 resize-none"
              rows={3}
            />
            <div className="flex justify-end mt-2">
              <button
                type="submit"
                disabled={submitting || !newComment.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Posting...' : 'Comment'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  )
}
