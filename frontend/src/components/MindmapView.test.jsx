import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MindmapView from './MindmapView'
import useMindmapTheme from '../store/useMindmapTheme'

beforeEach(() => {
  cleanup()
  // Reset mindmap-theme store between tests so palette selection from one
  // test doesn't leak into another.
  useMindmapTheme.setState({ theme: 'classic' })
})

describe('MindmapView', () => {
  it('renders a rect per node and a path per edge', () => {
    const md = `# Root\n\n## A\n\n## B\n`
    const { container } = render(<MindmapView content={md} title="Ignored" />)
    // Scope to the mindmap SVG — the theme dropdown button has its own
    // chevron `<svg><path>` that we must not count.
    const mindmap = container.querySelector('svg[role="img"]')
    const rects = mindmap.querySelectorAll('rect')
    const paths = mindmap.querySelectorAll('.mindmap-edges path')
    // 3 nodes → 3 rects; 2 non-root edges → 2 paths.
    expect(rects.length).toBe(3)
    expect(paths.length).toBe(2)
  })

  it('labels each node with the parsed text', () => {
    const md = `# Root\n\n## Child\n`
    const { container } = render(<MindmapView content={md} title="" />)
    const texts = [...container.querySelectorAll('svg text')].map(
      (el) => el.textContent,
    )
    expect(texts).toEqual(expect.arrayContaining(['Root', 'Child']))
  })

  it('shows a friendly error panel when the markdown has no structure', () => {
    render(<MindmapView content="just prose" title="X" />)
    expect(
      screen.getByText(/心智圖頁面需要至少包含 heading 或 bullet list 結構/),
    ).toBeInTheDocument()
  })

  it('lets the reader change the mindmap palette', async () => {
    const md = `# R\n\n## A\n`
    const { container } = render(<MindmapView content={md} title="" />)
    // Open the theme dropdown — the button is labelled with the current palette
    // name, so we locate it by aria-label.
    const trigger = screen.getByRole('button', { name: /mindmap theme/i })
    fireEvent.click(trigger)
    // Pick the Colorful palette.
    fireEvent.click(screen.getByRole('button', { name: /^Colorful/ }))
    // The root rect (first in document order) should now carry the Colorful
    // palette's lv0 fill instead of the classic CSS-var reference.
    const firstRect = container.querySelector('svg rect')
    expect(firstRect.getAttribute('fill')).toBe('#e76f51')
    // Wiki-theme dropdown is gone; subsequent render of the same view uses
    // the store's updated selection.
    expect(useMindmapTheme.getState().theme).toBe('colorful')
  })

  it('uses CSS variables for the classic palette so the wiki theme wins', () => {
    const md = `# R\n\n## A\n`
    const { container } = render(<MindmapView content={md} title="" />)
    const firstRect = container.querySelector('svg rect')
    // Classic palette defers to `var(--mindmap-lv0-fill)` at the root.
    expect(firstRect.getAttribute('fill')).toBe('var(--mindmap-lv0-fill)')
  })

  it('persists a chosen palette to localStorage', () => {
    const md = `# R\n\n## A\n`
    render(<MindmapView content={md} title="" />)
    fireEvent.click(screen.getByRole('button', { name: /mindmap theme/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Pastel/ }))
    expect(localStorage.getItem('mindmapTheme')).toBe('pastel')
  })
})
