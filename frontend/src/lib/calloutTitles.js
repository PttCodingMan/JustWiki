// Callout header labels for the markdown-it pipeline in lib/markdown.js.
//
// Kept as a single mutable object so i18n can localize the headers without
// threading a `t()` function through the shared, synchronous markdown
// pipeline. i18n.js calls setCalloutTitles() on init and on every language
// change; the pipeline reads this object at render time, so the next render
// picks up the current language. Defaults to English.
export const CALLOUT_TITLES = { info: 'Info', warning: 'Warning', tip: 'Tip', danger: 'Danger' }

export function setCalloutTitles(map) {
  if (map) Object.assign(CALLOUT_TITLES, map)
}
