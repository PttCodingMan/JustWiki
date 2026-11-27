# Search & Browse

## Full-text search

Press `Ctrl+K` (`⌘K` on macOS) or click the search icon. Results appear as you type; press Enter for the full results page, where you can also filter by tag.

- Searches titles and body text, showing the matching passage with your keywords highlighted
- Powered by SQLite FTS5 with native Chinese, Japanese and Korean support — no word segmentation needed
- Only returns pages you're allowed to read

:::tip
Try it on this demo: search for "backup" or "ACL".
:::

## Graph View

![3D knowledge graph](/api/media/graph-3d-en.png)

**Graph View** in the sidebar draws every page as a node and every wikilink as an edge, so you can spot the hubs and the orphans.

- 3D and flat 2D modes; falls back to 2D when the browser has no WebGL
- Click a node to see its link count and jump to the page

## Recent Changes

**Recent Changes** in the sidebar is a timeline of the whole wiki: who created, updated, deleted or verified which page, plus totals for pages, users and the most-viewed pages.

## Bookmarks

Click the bookmark icon on any page and it appears under **Bookmarks** in the sidebar — handy for pages you open every day. Bookmarks are personal.

## Themes and fonts

![The 9 built-in themes](/api/media/themes-en.png)

The theme menu (top right) has 9 color schemes: **Light, Dark, Lavender, Forest, Rose, Ocean, Sand, Sunset, Nord**. You can also switch the body font to monospace. Your choice is remembered in the browser.

## Interface language

The language menu (top right) switches between **English, 繁體中文, 日本語 and 한국어**. It changes the interface only; page content isn't translated.

## Exporting a page

Under a page's **⋯ More actions**:

- **Copy Markdown / Download .md** — the raw Markdown
- **Export HTML** — a single HTML file for sending or archiving
- **Print / Save as PDF** — opens the browser's print dialog; choose "Save as PDF"

To export the entire wiki, see the [[en-admin|Admin Guide]].
