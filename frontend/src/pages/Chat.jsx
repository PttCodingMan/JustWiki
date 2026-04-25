import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useChat from '../store/useChat'
import MarkdownViewer from '../components/Viewer/MarkdownViewer'

export default function Chat() {
  const { t } = useTranslation()
  const {
    messages,
    isStreaming,
    aiStatus,
    checkStatus,
    sendMessage,
    stopStreaming,
    clearHistory,
  } = useChat()
  const [input, setInput] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    if (aiStatus === null) checkStatus()
  }, [aiStatus, checkStatus])

  // Auto-scroll to the bottom as tokens arrive.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || isStreaming) return
    sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    // Enter to send, Shift+Enter for newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  if (aiStatus && !aiStatus.enabled) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <h1 className="text-2xl font-bold text-text mb-2">{t('chat.disabledTitle')}</h1>
        <p className="text-text-secondary">
          {t('chat.disabledIntro')}{' '}
          <code className="px-1.5 py-0.5 bg-surface rounded text-xs">AI_ENABLED=true</code>{' '}
          {t('chat.disabledAnd')}{' '}
          <code className="px-1.5 py-0.5 bg-surface rounded text-xs">AI_API_KEY</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-2xl font-bold text-text">{t('chat.title')}</h1>
          {aiStatus?.model && (
            <p className="text-xs text-text-secondary mt-0.5">
              {t('chat.modelLabel', { model: aiStatus.model })}
            </p>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            disabled={isStreaming}
            className="text-sm text-text-secondary hover:text-text disabled:opacity-50"
          >
            {t('chat.clear')}
          </button>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4"
      >
        {messages.length === 0 ? (
          <div className="text-center text-text-secondary py-16">
            {t('chat.empty')}
          </div>
        ) : (
          messages.map((m, i) => <Message key={i} message={m} />)
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border pt-3 pb-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.inputPlaceholder')}
            rows={2}
            disabled={isStreaming}
            className="flex-1 resize-none bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary disabled:opacity-60"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="px-4 py-2 rounded-lg bg-surface border border-border text-sm text-text hover:bg-surface-hover"
            >
              {t('chat.stop')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-text text-sm font-medium disabled:opacity-50"
            >
              {t('chat.send')}
            </button>
          )}
        </div>
        <p className="text-xs text-text-secondary mt-1.5">
          {t('chat.shortcutHint')}
        </p>
      </form>
    </div>
  )
}

function Message({ message }) {
  const { t } = useTranslation()
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary text-primary-text rounded-2xl rounded-br-md px-4 py-2 whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-surface border border-border rounded-2xl rounded-bl-md px-4 py-3">
        {message.error ? (
          <div className="text-sm text-red-600">{message.content || t('chat.errorFallback')}</div>
        ) : message.content ? (
          <div className="text-sm text-text break-words chat-markdown">
            <MarkdownViewer content={message.content} />
          </div>
        ) : (
          <div className="text-sm text-text-secondary italic">{t('chat.thinking')}</div>
        )}
        {message.citations?.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <Link
                key={c.slug}
                to={`/page/${c.slug}`}
                className="text-xs px-2 py-0.5 bg-surface-hover border border-border rounded-full text-text-secondary hover:text-text hover:border-primary"
                title={c.title}
              >
                {c.title}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
