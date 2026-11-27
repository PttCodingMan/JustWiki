import DOMPurify from 'dompurify'

// Draw.io diagrams are stored as an SVG snapshot (`svg_cache`) that the
// client uploads, so any editor controls its markup. It is inlined into the
// page (inline SVG keeps the dark-mode filter and crisp text), which means
// sanitizing away scripts is not enough: inline SVG can also restyle or
// overlay the whole app. On top of DOMPurify's SVG profile we therefore drop:
//   - <style>: its rules apply to the entire document, not just the SVG
//   - <a>: a diagram must not be a disguised link (e.g. a fake login prompt)
//   - class: would pick up the app's own CSS, e.g. a full-screen overlay class
//   - CSS `position` in style attributes: `position:fixed` escapes the
//     diagram container's overflow clipping and can cover the viewport
// Uses a private DOMPurify instance so these hooks don't leak into the
// markdown sanitizer.
let purifier = null

function getPurifier() {
  if (purifier) return purifier
  purifier = DOMPurify(window)
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.style && node.style.length) {
      node.style.removeProperty('position')
      if (!node.style.length) node.removeAttribute('style')
    }
  })
  return purifier
}

export function sanitizeDiagramSvg(svg) {
  if (!svg) return ''
  return getPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'a'],
    FORBID_ATTR: ['class'],
  })
}
