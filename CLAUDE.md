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

Single-test commands:
```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_foo.py::test_bar -v
cd frontend && npm test -- src/path/to/file.test.jsx
```

## Architecture

### Backend (`backend/app/`)

- **Framework**: FastAPI (async), aiosqlite for SQLite access (WAL mode)
- **Entry**: `main.py` — app creation, CORS, lifespan hooks, router mounting
- **Auth**: `auth.py` — JWT tokens in httpOnly cookies, bcrypt passwords, rate-limited login
- **Config**: `config.py` — Pydantic Settings reading from `.env`
- **Database**: `database.py` — schema DDL, migrations, FTS5 search index setup
- **Routers**: One file per domain — `pages.py`, `search.py`, `media.py`, `versions.py`, `tags.py`, `templates.py`, `users.py`, `diagrams.py`, `comments.py`, `bookmarks.py`, `activity.py`, `backup.py`, `export.py`, `auth_router.py`, `trash.py`, `notifications.py`, `watch.py`, `public.py`, `dashboard.py`, `acl.py`, `groups.py`
- **Services**: `search.py` (FTS5 indexing, CJK segmentation), `wikilink.py` (backlink tracking), `acl.py` (permission resolution — single source of truth, routers must use these helpers), `media_ref.py` (tracks which pages reference each media file), `diagram_ref.py`, `notifications.py` (fan-out to watchers on page events)
- **Deps**: Python 3.11+, managed with `uv`

### Frontend (`frontend/src/`)

- **Framework**: React 19, Vite 8, Tailwind CSS 4
- **State**: Zustand stores in `store/` — one per domain (useAuth, usePages, useTags, useBookmarks, useTheme, useSearch, useActivity, useNotifications, usePermissions, useGroups)
- **API client**: `api/client.js` — Axios instance with interceptors, 401 redirect to login
- **Routing**: React Router v7 in `App.jsx`, PrivateRoute wrapper for auth
- **Keyboard shortcuts**: `hooks/useKeyboard.jsx` (Ctrl+E edit, Ctrl+K search, etc.)

### Editor and Viewer (dual rendering paths)

These are separate systems with independent rendering logic — changes to one do not affect the other. **Always verify both when modifying markdown-related features.**

- **Editor**: `components/Editor/Editor.jsx` — Milkdown (ProseMirror-based) WYSIWYG editor with slash commands, wikilink autocomplete `[[page]]`, image paste upload, GFM support
- **Viewer**: `components/Viewer/MarkdownViewer.jsx` — Renders via `lib/markdown.js`. Sanitized with DOMPurify.
- **Markdown pipeline**: `lib/markdown.js` — Centralized markdown-it + GFM pipeline. Adds callout blocks (`:::info/warning/tip/danger`), wikilinks (`[[slug]]`, `[[slug|text]]`), transclusion (`![[slug]]`), KaTeX (`$...$`, `$$...$$`), Mermaid fences, Draw.io embeds (`::drawio[id]`). Both the Viewer and any other rendering must go through this module.

### Database (SQLite, single file at `data/just-wiki.db`)

Key tables: `users`, `pages` (with `parent_id` hierarchy and `slug` URL), `page_versions`, `tags`, `page_tags`, `backlinks`, `templates`, `media`, `media_references`, `diagrams`, `comments`, `bookmarks`, `activity_log`, `page_acl`, `groups`, `group_members`, `page_watchers`, `notifications`, `view_dedup`. FTS5 virtual table `search_index` for full-text search with CJK support.

Pages use **soft-delete** (`deleted_at` column) — `DELETE /api/pages/{slug}` sets `deleted_at` rather than removing the row. Trash endpoints (`/api/trash`) handle list/restore/purge. Restore re-indexes FTS and re-parses backlinks.

Schema auto-migrates on startup in `database.py`.

### Wikilinks

Format: `[[slug]]` or `[[slug|display text]]`. Parsed on both backend (backlink tracking in `backlinks` table via `services/wikilink.py`) and frontend (navigation in viewer). Auto-generated slugs preserve CJK characters (Python 3 `\w` matches Unicode letters), so Chinese/Japanese/Korean titles appear in URLs as-is.

## API Structure

All endpoints under `/api/`. Vite dev server proxies `/api` to `localhost:8000`. Key routes:

- Pages CRUD: `/api/pages`, `/api/pages/{slug}`, `/api/pages/tree`, `/api/pages/graph`
- Versions: `/api/pages/{slug}/versions`, `/api/pages/{slug}/diff/{v1}/{v2}`
- Permission check: `GET /api/pages/{slug}/my-permission` → `{permission: 'admin'|'write'|'read'|'none'}`
- Search: `/api/search?q=...`
- Media upload: `POST /api/media/upload` (20MB limit)
- Auth: `/api/auth/login`, `/api/auth/me`
- ACL: `/api/acl/pages/{page_id}` (GET/PUT page-level access rules)
- Groups: `/api/groups` (admin-only CRUD + membership)
- Trash: `/api/trash` (list/restore/purge soft-deleted pages)
- Watch: `GET/POST/DELETE /api/pages/{slug}/watch`
- Notifications: `/api/notifications` (list, mark-read)
- Public: `/api/public/pages/{slug}` (unauthenticated, rate-limited 60 req/min/IP)
- Dashboard: `GET /api/dashboard/stats` (admin only)
- Health: `GET /api/health`

## ACL / Permissions

Permission values: `admin > write > read > none`.

Resolution logic (in `services/acl.py` — routers must use these helpers, never roll their own):
- `admin` role bypasses all checks.
- Per-page ACL rows live in `page_acl (page_id, principal_type, principal_id, permission)` where principal is a user or group.
- To resolve: walk the `parent_id` chain, find the shallowest ancestor with any ACL row (the "anchor"), and take the most-permissive matching row. If no anchor exists, the page is open by default (write for editors, read for viewers).
- `viewer` role is capped at `read` even when ACL grants write.
- Frontend: `usePermissions` store caches per-slug; seeded from `effective_permission` on page-view responses. Helper functions `canEdit`, `canRead`, `canManageAcl` are exported from the store file.

## Themes

Multiple built-in themes (light, dark, lavender, forest, etc.) via CSS variables in `frontend/src/index.css`, persisted with Zustand store `useTheme.js`.

## Deployment

Docker Compose: backend (uvicorn, port 8000) + frontend (nginx, port 3000). Shared `./data` volume. All config in `.env`.

## Development Workflow

After completing any development task, always run the following before reporting the task as done:

1. **Tests** — run `make test` (or the relevant subset: `make test-backend` / `make test-frontend`) and make sure everything passes.
2. **Lint** — run `make lint` for frontend changes.
3. **Code review** — perform a self-review of the diff, then run a second-opinion review with Gemini CLI for non-trivial changes.
