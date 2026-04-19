import { create } from 'zustand'
import api from '../api/client'

// Parses one SSE `data: ...` payload, returning the decoded object or null
// if the line should be skipped (keepalives, [DONE] sentinel, parse errors).
function parseSseData(line) {
  if (!line.startsWith('data: ')) return null
  const payload = line.slice(6).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

const useChat = create((set, get) => ({
  messages: [],       // { role: 'user' | 'assistant', content, citations?, error? }
  isStreaming: false,
  error: null,
  aiStatus: null,     // { enabled: bool, model: string | null } — cached after checkStatus
  abortController: null,

  checkStatus: async () => {
    try {
      const res = await api.get('/ai/status')
      set({ aiStatus: res.data })
      return res.data
    } catch {
      const fallback = { enabled: false, model: null }
      set({ aiStatus: fallback })
      return fallback
    }
  },

  clearHistory: () => set({ messages: [], error: null }),

  stopStreaming: () => {
    const ctrl = get().abortController
    if (ctrl) ctrl.abort()
    set({ isStreaming: false, abortController: null })
  },

  sendMessage: async (text) => {
    const question = text.trim()
    if (!question || get().isStreaming) return

    const priorMessages = get().messages
    // Only send user/assistant turns with content back as history — strip
    // out any error-state assistant stubs.
    const history = priorMessages
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }))

    const userMsg = { role: 'user', content: question }
    const assistantMsg = { role: 'assistant', content: '', citations: [] }
    set({
      messages: [...priorMessages, userMsg, assistantMsg],
      isStreaming: true,
      error: null,
    })

    const controller = new AbortController()
    set({ abortController: controller })

    // We update the trailing assistant message in-place by copying the array
    // each tick. Zustand's shallow-compare triggers re-renders that way.
    const updateAssistant = (mutator) => {
      const msgs = get().messages.slice()
      const last = msgs.length - 1
      if (last < 0 || msgs[last].role !== 'assistant') return
      msgs[last] = mutator({ ...msgs[last] })
      set({ messages: msgs })
    }

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: question, history }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`
        try {
          const body = await resp.json()
          if (body?.detail) detail = body.detail
        } catch {
          /* body wasn't JSON */
        }
        updateAssistant((m) => ({ ...m, error: true, content: detail }))
        set({ isStreaming: false, abortController: null, error: detail })
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handleLine = (raw) => {
        const obj = parseSseData(raw)
        if (!obj) return
        if (obj.type === 'citations') {
          updateAssistant((m) => ({ ...m, citations: obj.citations || [] }))
        } else if (obj.error) {
          updateAssistant((m) => ({ ...m, error: true, content: obj.error }))
        } else if (obj.choices?.[0]?.delta?.content) {
          const delta = obj.choices[0].delta.content
          updateAssistant((m) => ({ ...m, content: m.content + delta }))
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trimEnd()
          buffer = buffer.slice(nl + 1)
          handleLine(line)
        }
      }
      // Flush any trailing line without a terminating newline so the last
      // token isn't lost if the upstream closes without a final \n.
      if (buffer.trim()) handleLine(buffer.trim())
    } catch (err) {
      if (err.name === 'AbortError') {
        // User-initiated stop — leave whatever content arrived in place.
      } else {
        updateAssistant((m) => ({
          ...m,
          error: true,
          content: err.message || 'Network error',
        }))
        set({ error: err.message || 'Network error' })
      }
    } finally {
      set({ isStreaming: false, abortController: null })
    }
  },
}))

export default useChat
