import { useCallback, useEffect, useState } from 'react'

// Ctrl/Cmd+S calls `onSave` while the page is mounted.
export function useSaveShortcut(onSave) {
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        onSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onSave])
}

// Open state for MediaPickerModal; the picked snippet goes into the editor.
export function useMediaPicker(editorRef) {
  const [open, setOpen] = useState(false)
  const onOpen = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])
  const onInsert = useCallback((snippet) => {
    editorRef.current?.insertText(`\n${snippet}\n`)
  }, [editorRef])
  return { open, onOpen, onClose, onInsert }
}
