import { useEffect, useRef, useState } from 'react'

export default function TableOfContents({ headings }) {
  const [activeId, setActiveId] = useState(null)
  const activeRef = useRef(null)

  useEffect(() => {
    if (!headings || headings.length === 0) return
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean)
    if (elements.length === 0) return

    // IntersectionObserver only delivers the entries that changed since the
    // last callback, so we have to accumulate the currently-visible set
    // ourselves and pick the topmost in document order.
    const visibleIds = new Set()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visibleIds.add(e.target.id)
          else visibleIds.delete(e.target.id)
        })
        const topmost = headings.find((h) => visibleIds.has(h.id))
        if (topmost) setActiveId(topmost.id)
      },
      { rootMargin: '-56px 0px -60% 0px', threshold: 0 },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [headings])

  // Keep the active item in view inside the TOC rail when it overflows.
  // Use scrollTop on the rail directly instead of scrollIntoView, which
  // would cascade to the page's <main> scroll container and fight with
  // click-to-jump smooth scrolls.
  useEffect(() => {
    const el = activeRef.current
    if (!el) return
    const rail = el.closest('.toc-rail')
    if (!rail) return
    const itemTop = el.offsetTop
    const itemBottom = itemTop + el.offsetHeight
    const viewTop = rail.scrollTop
    const viewBottom = viewTop + rail.clientHeight
    if (itemTop < viewTop) {
      rail.scrollTop = itemTop
    } else if (itemBottom > viewBottom) {
      rail.scrollTop = itemBottom - rail.clientHeight
    }
  }, [activeId])

  const handleClick = (e, id) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  if (!headings || headings.length === 0) {
    return (
      <div className="toc-rail toc-empty">
        <h3 className="toc-title">On this page</h3>
        <p className="text-xs text-text-secondary">No headings yet.</p>
      </div>
    )
  }

  return (
    <nav className="toc-rail" aria-label="Table of contents">
      <h3 className="toc-title">On this page</h3>
      <ul className="toc-list">
        {headings.map((h) => (
          <li
            key={h.id}
            ref={activeId === h.id ? activeRef : null}
            className={`toc-item toc-level-${h.level} ${activeId === h.id ? 'toc-active' : ''}`}
          >
            <a href={`#${h.id}`} onClick={(e) => handleClick(e, h.id)}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
