import { useEffect, useRef, useCallback } from 'react'
import useTheme from '../store/useTheme'

const DRAWIO_BASE = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&saveAndExit=1&noSaveBtn=1&configure=1'
const DRAWIO_ORIGIN = 'https://embed.diagrams.net'

export default function DrawioModal({ open, xml, onSave, onClose }) {
  const dark = useTheme((s) => s.dark)
  const iframeRef = useRef(null)
  const xmlRef = useRef(null)

  const handleMessage = useCallback((e) => {
    if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return

    let msg
    try {
      msg = JSON.parse(e.data)
    } catch {
      return
    }

    if (msg.event === 'configure') {
      // Disable adaptive color schemes; use explicit white/black defaults
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          action: 'configure',
          config: {
            defaultColorSchemes: [],
            defaultVertexStyle: {
              fillColor: '#ffffff',
              strokeColor: '#000000',
              fontColor: '#000000',
            },
            defaultEdgeStyle: {
              strokeColor: '#000000',
              fontColor: '#000000',
            },
          },
        }),
        DRAWIO_ORIGIN
      )
    } else if (msg.event === 'init') {
      // draw.io ready — load existing diagram or blank canvas
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ action: 'load', xml: xml || '' }),
        DRAWIO_ORIGIN
      )
    } else if (msg.event === 'save') {
      // User clicked "Save & Exit" — request SVG export before closing
      xmlRef.current = msg.xml
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ action: 'export', format: 'svg' }),
        DRAWIO_ORIGIN
      )
    } else if (msg.event === 'export') {
      // Got SVG data — decode and pass to parent
      let svg = msg.data
      if (svg && svg.startsWith('data:image/svg+xml;base64,')) {
        svg = atob(svg.replace('data:image/svg+xml;base64,', ''))
      }
      onSave({ xml: xmlRef.current, svg })
    } else if (msg.event === 'exit') {
      // User clicked close without saving
      onClose()
    }
  }, [xml, onSave, onClose])

  useEffect(() => {
    if (!open) return
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [open, handleMessage])

  if (!open) return null

  return (
    <div className="drawio-modal-overlay">
      <iframe
        ref={iframeRef}
        src={`${DRAWIO_BASE}&ui=${dark ? 'dark' : 'atlas'}`}
        className="drawio-modal-iframe"
        title="Draw.io Editor"
      />
    </div>
  )
}
