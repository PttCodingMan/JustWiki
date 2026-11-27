# User Guide

> 🌐 **Language:** English · [[zh-guide|中文]]

JustWiki is a lightweight, self-hosted wiki for small teams. It is Markdown-first, and everything lives in a single SQLite file plus a media folder — no external database. A 1 vCPU / 512 MB VM or a Raspberry Pi is enough to run it.

![JustWiki main UI](/api/media/hero-en.png)

## Why JustWiki

- **vs Outline** — no PostgreSQL, Redis or MinIO, and no 4 CPU / 8 GB machine
- **vs Wiki.js** — v3 has had no stable release since its 2021 announcement and v2 is in maintenance; JustWiki is actively developed
- **vs BookStack** — pages nest as deep as you like instead of a fixed Book → Chapter → Page hierarchy
- **vs Notion / Obsidian** — self-hosted, your data stays on your machine, with real multi-user collaboration (ACLs, comments, watch notifications)

## Contents

**Writing**
- [[en-quick-start|Quick Start]] — your first page, the page tree, shortcuts
- [[en-editor|The Editor]] — WYSIWYG, slash commands, images, draft autosave
- [[en-rich-content|Rich Content]] — callouts, Mermaid, KaTeX, Draw.io, code
- [[en-links|Links & Embeds]] — wikilinks, backlinks, transclusion, @mentions

**Organizing & browsing**
- [[en-organize|Organizing Pages]] — hierarchy, tags, templates, page types
- [[en-mindmap|Mindmap Page]] — a live mindmap page example
- [[en-browse|Search & Browse]] — full-text search, graph, activity, bookmarks, themes, language

**Teams**
- [[en-collaboration|Collaboration]] — comments, watching, version history, concurrent edits, periodic review
- [[en-permissions|Permissions & Accounts]] — roles, page ACLs, groups, public pages, SSO, API tokens
- [[en-ai|AI Chat]] — a Q&A assistant grounded in your wiki

**Operations**
- [[en-admin|Admin Guide]] — site settings, users, webhooks, backups, export
- [[en-developer|Developer Guide]] — tech stack, local development, API

:::info
This guide is itself a set of JustWiki pages, so every syntax it describes renders live. To see the source Markdown, look at `docs/manual/` on GitHub.
:::
