# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JustWiki is a lightweight, self-hosted wiki for small teams. Markdown-first, single SQLite file, no external dependencies. Backend is Python/FastAPI, frontend is React/Vite.

## Development Commands

```bash
make setup          # First-time: install deps (uv + npm), create .env from .env.example
make dev            # Start backend (port 8000) + frontend (port 5173) concurrently
make dev-backend    # Backend only: uvicorn with --reload on port 8000
make dev-frontend   # Frontend only: Vite dev server on port 5173
make build          # Build frontend for production (vite build)
make test           # Run all backend and frontend tests
make test-backend   # Run backend tests with pytest
make test-frontend  # Run frontend tests with vitest
make lint           # Run frontend linting
make backup         # Copy SQLite DB to backup/ with timestamp
```

Frontend linting: `cd frontend && npm run lint`
Backend tests location: `backend/tests/`
Frontend tests location: `frontend/src/**/*.test.{js,jsx}`

## Architecture

### Backend (`backend/app/`)

- **Framework**: FastAPI (async), aiosqlite for SQLite access (WAL mode)
- **Entry**: `main.py` — app creation, CORS, lifespan hooks, router mounting
- **Auth**: `auth.py` — JWT tokens in httpOnly cookies, bcrypt passwords, rate-limited login
- **Config**: `config.py` — Pydantic Settings reading from `.env`
- **Database**: `database.py` — schema DDL, migrations, FTS5 search index setup
- **Routers**: One file per domain — `pages.py`, `search.py`, `media.py`, `versions.py`, `tags.py`, `templates.py`, `users.py`, `diagrams.py`, `comments.py`, `bookmarks.py`, `activity.py`, `backup.py`, `export.py`, `auth_router.py`
- **Services**: `search.py` (FTS5 indexing, CJK segmentation), `wikilink.py` (backlink tracking)
- **Deps**: Python 3.11+, managed with `uv`

### Frontend (`frontend/src/`)

- **Framework**: React 19, Vite 8, Tailwind CSS 4
- **State**: Zustand stores in `store/` — one per domain (useAuth, usePages, useTags, useBookmarks, useTheme, useSearch, useActivity)
- **API client**: `api/client.js` — Axios instance with interceptors, 401 redirect to login
- **Routing**: React Router v7 in `App.jsx`, PrivateRoute wrapper for auth
- **Keyboard shortcuts**: `hooks/useKeyboard.jsx` (Ctrl+E edit, Ctrl+K search, etc.)

### Editor and Viewer (dual rendering paths)

These are separate systems with independent rendering logic — changes to one do not affect the other. **Always verify both when modifying markdown-related features.**

- **Editor**: `components/Editor/Editor.jsx` — Milkdown (ProseMirror-based) WYSIWYG editor with slash commands, wikilink autocomplete `[[page]]`, image paste upload, GFM support
- **Viewer**: `components/Viewer/MarkdownViewer.jsx` — Custom markdown-to-HTML parser (not a library). Handles Mermaid diagrams, KaTeX math (`$$...$$`), callout blocks (`:::info`), wikilinks, tables, nested lists. Sanitized with DOMPurify.

### Database (SQLite, single file at `data/just-wiki.db`)

Key tables: `users`, `pages` (with `parent_id` hierarchy and `slug` URL), `page_versions`, `tags`, `page_tags`, `backlinks`, `templates`, `media`, `diagrams`, `comments`, `bookmarks`, `activity_log`. FTS5 virtual table `search_index` for full-text search with CJK support.

Schema auto-migrates on startup in `database.py`.

### Wikilinks

Format: `[[slug]]` or `[[slug|display text]]`. Parsed on both backend (backlink tracking in `backlinks` table via `services/wikilink.py`) and frontend (navigation in viewer). Auto-generated slugs preserve CJK characters (Python 3 `\w` matches Unicode letters), so Chinese/Japanese/Korean titles appear in URLs as-is.

## API Structure

All endpoints under `/api/`. Vite dev server proxies `/api` to `localhost:8000`. Key routes:

- Pages CRUD: `/api/pages`, `/api/pages/{slug}`, `/api/pages/tree`, `/api/pages/graph`
- Versions: `/api/pages/{slug}/versions`, `/api/pages/{slug}/diff/{v1}/{v2}`
- Search: `/api/search?q=...`
- Media upload: `POST /api/media/upload` (20MB limit)
- Auth: `/api/auth/login`, `/api/auth/me`

## Themes

Multiple built-in themes (light, dark, lavender, forest, etc.) via CSS variables in `frontend/src/index.css`, persisted with Zustand store `useTheme.js`.

## Deployment

Docker Compose: backend (uvicorn, port 8000) + frontend (nginx, port 3000). Shared `./data` volume. All config in `.env`.
