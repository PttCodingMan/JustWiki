# The Editor

JustWiki's editor is Milkdown, a WYSIWYG editor: what you type is what readers see. Underneath, pages are still stored as plain Markdown, so non-engineers can write comfortably while engineers can process content with Git, scripts or the API — your data is never locked into a proprietary format.

## Slash commands

![Slash command menu](/api/media/slash-commands-en.png)

Type `/` in the editor to open the insert menu. Keep typing to filter, use ↑ ↓ to choose and Enter to insert.

| Command | Inserts |
| ------- | ------- |
| `/h1` `/h2` `/h3` | Heading 1 / 2 / 3 |
| `/bullet` | Bulleted list |
| `/ordered` | Numbered list |
| `/quote` | Blockquote |
| `/code` | Code block |
| `/hr` | Horizontal rule |
| `/callout-info` | Info callout (`:::info`) |
| `/callout-warning` | Warning callout (`:::warning`) |
| `/callout-tip` | Tip callout (`:::tip`) |
| `/callout-danger` | Danger callout (`:::danger`) |
| `/mermaid` | Mermaid diagram |
| `/math` | KaTeX math block |
| `/drawio` | Draw.io diagram |
| `/media` | A file picked from the media library |

See [[en-rich-content|Rich Content]] for what each block looks like.

## Markdown

JustWiki supports GitHub Flavored Markdown (GFM). Markdown typed into the editor is converted as you go — start a line with `## ` and it becomes a heading.

| Syntax | Result |
|--------|--------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `` `inline code` `` | `inline code` |
| `[link text](https://example.com)` | [link text](https://example.com) |
| `![alt](image-url)` | an image |

Lists and task lists:

```
- item
  - nested item
1. numbered item
- [x] done
- [ ] to do
```

- [x] done
- [ ] to do

Tables:

```
| Column A | Column B |
|----------|----------|
| data 1   | data 2   |
```

| Column A | Column B |
|----------|----------|
| data 1   | data 2   |

## Images and files

- **Paste to upload** — take a screenshot and press `Ctrl+V` in the editor; the image is uploaded and inserted
- **Media library** — use `/media` to reuse a file that's already uploaded
- **Size limit** — 20 MB per file by default; admins can change it in **Admin → Site Settings** (1–100 MB)

JustWiki tracks which pages use each media file, so admins can see which files are no longer used.

## Draft autosave

What you type while editing is continuously saved in **this browser**. If you close the tab, the browser crashes or the machine restarts, the next time you edit that page you'll see "Unsaved draft found" with **Restore draft** and **Discard draft**.

:::warning
Drafts live only in your local browser; they don't sync to the server or other devices. If someone else edited the page after you left, the prompt shows which version the draft was based on, and saving will ask you to resolve the conflict (see [[en-collaboration|Collaboration]]).
:::

## Editing without the editor

Some things work straight from the page view:

- **Tags** — click **+ Tag** above the page, or × on a tag to remove it
- **Bookmarks** — click the bookmark icon
- **Copy / download Markdown** — under **⋯ More actions**, handy for pasting elsewhere or feeding a script
