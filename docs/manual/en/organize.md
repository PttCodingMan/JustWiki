# Organizing Pages

## Page hierarchy

Pages nest as deep as you like — no fixed Book → Chapter → Page levels as in BookStack. The left page tree shows every page you can read:

- Choose **New subpage** in a page's **Page actions** to create a page under it
- Drag pages in the tree to reorder them or move them under a different parent
- Sub-pages inherit their parent's permissions by default (see [[en-permissions|Permissions & Accounts]]), so moving a page into another branch can change who can read it

A good pattern is top-level pages for broad areas ("Product", "Engineering", "Operations") with projects or topics underneath. This guide is an example: one contents page per language, with the chapters under it.

## Tags

Tags classify pages across the tree — think `onboarding`, `runbook`, `deprecated`:

- Click **+ tag** above a page to add one, × on a tag to remove it
- Filter search results by tag to see one kind of page

## Templates

Pick a template when creating a page to keep team docs consistent. Four ship by default:

| Template | Use it for |
|----------|-----------|
| Meeting Notes (會議記錄) | Agenda, discussion, decisions, action items |
| Tech Doc (技術文件) | Overview, architecture, API, caveats |
| Troubleshooting | Symptoms, cause, resolution steps |
| ADR | Architecture Decision Record |

Admins can add, edit and delete templates in **Admin → Templates**; the whole team shares the same set.

## Page types

When creating a page, choose its type:

- **📄 Document** — a regular Markdown page
- **🧠 Mindmap** — written as Markdown headings or bullet lists and rendered as a mindmap. Readers can switch its color theme and layout (expand right, expand left, radial)

See the [[en-mindmap|mindmap page example]].

## Deleting and the Trash

Deleted pages aren't gone right away — they move to **Trash** (in the sidebar):

- The original author or an admin can restore a page; its search index and backlinks are rebuilt automatically
- Only admins can delete permanently
