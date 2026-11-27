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
- **Entry**: `main.py` — app creation, CORS, lifespan hooks, router mounting, origin-based CSRF middleware
- **Auth**: `auth.py` — issues and verifies credentials across three paths:
  - **Cookie session** (web UI): JWT in httpOnly `token` cookie, bcrypt passwords, rate-limited login. `auth.revoke_sessions` sets `users.sessions_revoked_at`; JWTs with an older `iat` are rejected (password change, admin reset, deactivation). The cookie only ever carries a JWT — `jwk_` API tokens are accepted from the `Authorization` header only
  - **Bearer API token** (`Authorization: Bearer jwk_…`): hashed SHA-256 on store, plaintext returned once at creation, revocable; managed via `routers/tokens.py`
  - **SSO**: OIDC (Google/GitHub/generic, PKCE, authlib state stored in signed session cookie) via `routers/oauth_router.py` + `services/oidc.py`; LDAP via `services/ldap_auth.py`; invitation-only mode gates first-time signup. SSO links to an existing account by email only when `users.email_trusted=1` (set by admin/invite/LDAP; a self-edited profile email clears it)
  - **CSRF**: origin/referer check in `main.py` for mutating cookie-auth requests; Bearer-token and login/logout paths are exempt
  - **Startup / headers**: `main._check_security` + `_enforce_admin_password` refuse to boot an exposed instance (Docker image sets `RUNNING_IN_DOCKER`) with a default SECRET_KEY or admin password. `security_headers` middleware adds CSP (SPA HTML only), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS when cookies are secure — new frontend features that load third-party scripts/frames/fonts must update `_CSP`
- **Config**: `config.py` — Pydantic Settings reading from `.env`
- **Schemas**: `schemas.py` — shared Pydantic request/response models
- **Database**: `database.py` — schema DDL and FTS5 search index setup; first-launch welcome pages and default templates are markdown files in `app/seed/`; startup-time migrations live in `migrations.py` and record applied versions in the `schema_migrations` ledger so each migration runs once per DB
- **Routers**: One file per domain — `pages.py`, `search.py`, `media.py`, `versions.py`, `tags.py`, `templates.py`, `users.py`, `diagrams.py`, `comments.py`, `bookmarks.py`, `activity.py`, `backup.py`, `export.py`, `imports.py`, `auth_router.py`, `oauth_router.py`, `tokens.py`, `trash.py`, `notifications.py`, `watch.py`, `public.py`, `dashboard.py`, `acl.py`, `groups.py`, `ai.py`, `reviews.py`
- **Services**: `search.py` (FTS5 indexing, CJK segmentation), `wikilink.py` (backlink tracking), `acl.py` (permission resolution — single source of truth, routers must use these helpers), `media_ref.py` (tracks which pages reference each media file), `diagram_ref.py`, `notifications.py` (fan-out to watchers on page events), `oidc.py` (OIDC client + provider config), `ldap_auth.py` (LDAP bind + attribute mapping), `accounts.py` (username derivation + SSO/LDAP user provisioning shared with invites), `page_review.py` (periodic review status + the hourly due-reminder loop started in the app lifespan), `md_import.py` (pure Markdown/Obsidian/HackMD/Wiki.js → JustWiki conversion used by `routers/imports.py`; rewrites links to random slugs, plans media, never touches the DB), `html_to_md.py` (stdlib HTML → Markdown for imported WYSIWYG pages)
- **Deps**: Python 3.11+, managed with `uv`

### Frontend (`frontend/src/`)

- **Framework**: React 19, Vite 8, Tailwind CSS 4
- **State**: Zustand stores in `store/` — one per domain (useAuth, usePages, useTags, useBookmarks, useTheme, useSearch, useActivity, useNotifications, usePermissions, useGroups, useChat)
- **API client**: `api/client.js` — Axios instance with interceptors, 401 redirect to login
- **Routing**: React Router v7 in `App.jsx`, PrivateRoute wrapper for auth
- **Keyboard shortcuts**: `hooks/useKeyboard.jsx` (Ctrl+E edit, Ctrl+K search, etc.)

### Editor and Viewer (dual rendering paths)

These are separate systems with independent rendering logic — changes to one do not affect the other. **Always verify both when modifying markdown-related features.**

- **Editor**: `components/Editor/Editor.jsx` — Milkdown (ProseMirror-based) WYSIWYG editor with slash commands, wikilink autocomplete `[[page]]`, image paste upload, GFM support
- **Viewer**: `components/Viewer/MarkdownViewer.jsx` — Renders via `lib/markdown.js`. Sanitized with DOMPurify.
- **Markdown pipeline**: `lib/markdown.js` — Centralized markdown-it + GFM pipeline. Adds callout blocks (`:::info/warning/tip/danger`), wikilinks (`[[slug]]`, `[[slug|text]]`), transclusion (`![[slug]]`), KaTeX (`$...$`, `$$...$$`), Mermaid fences, Draw.io embeds (`::drawio[id]`). Both the Viewer and any other rendering must go through this module.

### Database (SQLite, single file at `backend/data/just-wiki.db` in dev, `/app/data/just-wiki.db` in docker)

Key tables: `users`, `pages` (with `parent_id` hierarchy and `slug` URL), `page_versions`, `tags`, `page_tags`, `backlinks`, `templates`, `media`, `media_references`, `diagrams`, `comments`, `bookmarks`, `activity_log`, `page_acl`, `groups`, `group_members`, `page_watchers`, `notifications`, `view_dedup`, `page_reviews`. FTS5 virtual table `search_index` for full-text search with CJK support.

Pages use **soft-delete** (`deleted_at` column) — `DELETE /api/pages/{slug}` sets `deleted_at` rather than removing the row. Trash endpoints (`/api/trash`) handle list/restore/purge. Restore re-indexes FTS and re-parses backlinks.

Schema auto-migrates on startup — DDL lives in `database.py`, versioned migrations in `migrations.py`, and the `schema_migrations` ledger records which versions have run. Also relevant: `api_tokens` (token_hash, prefix, expires_at, revoked_at, last_used) backs personal API tokens.

### Optimistic locking on page edits

`PUT /api/pages/{slug}` **requires a `base_version`** in the body whenever `content` or `title` changes. If it doesn't match the current `pages.version`, the server returns **409** with `{"error": "base_version_stale" | "base_version_required", "your_version": …, "current_version": …}` so clients can resolve the conflict rather than silently clobbering a concurrent edit. New clients must send `base_version` — don't add a fallback.

### Wikilinks

Format: `[[slug]]` or `[[slug|display text]]`. Parsed on both backend (backlink tracking in `backlinks` table via `services/wikilink.py`) and frontend (navigation in viewer). Slugs are random 8-char alphanumeric IDs (`[A-Za-z0-9]`, case-sensitive; pages created before the switch keep their 8-char hex slug) assigned on creation (`services/page_slug.py`); the editor's `[[` autocomplete inserts `[[slug|title]]` so links stay readable. Migration 014 converted legacy title-derived slugs and rewrote wikilinks / `/page/<slug>` links in stored content.

## API Structure

All endpoints under `/api/`. Vite dev server proxies `/api` to `localhost:8000`. Key routes:

- Pages CRUD: `/api/pages`, `/api/pages/{slug}`, `/api/pages/tree`, `/api/pages/graph` (content/title edits require `base_version`)
- Versions: `/api/pages/{slug}/versions`, `/api/pages/{slug}/diff/{v1}/{v2}`
- Permission check: `GET /api/pages/{slug}/my-permission` → `{permission: 'admin'|'write'|'read'|'none'}`
- Search: `/api/search?q=...`
- Media upload: `POST /api/media/upload` (20MB limit)
- Auth: `/api/auth/login`, `/api/auth/me`
- API tokens: `GET/POST/DELETE /api/auth/tokens` — personal Bearer tokens (plaintext returned only on create)
- SSO: `GET /api/auth/providers`, `GET /api/auth/oauth/{provider}/login`, `GET /api/auth/oauth/{provider}/callback`
- AI chat: `/api/ai/*` — RAG over the wiki, scoped to the caller's ACL (only pages they can read are retrievable)
- ACL: `/api/acl/pages/{page_id}` (GET/PUT page-level access rules)
- Groups: `/api/groups` (admin-only CRUD + membership)
- Trash: `/api/trash` (list/restore/purge soft-deleted pages)
- Watch: `GET/POST/DELETE /api/pages/{slug}/watch`
- Notifications: `/api/notifications` (list, mark-read)
- Public: `/api/public/pages/{slug}` (unauthenticated, rate-limited 60 req/min/IP)
- Dashboard: `GET /api/dashboard/stats` (admin only)
- Reviews: `PUT/DELETE /api/pages/{slug}/review`, `POST /api/pages/{slug}/review/verify` (write permission); `GET /api/reviews?scope=all|mine` (ACL-filtered list). Review status is also embedded as `review` in `GET /api/pages/{slug}`
- Import: `POST /api/import` (admin; multipart `file` = .zip or .md, `source` = auto|markdown|obsidian|hackmd|wikijs, optional `parent_slug`) — returns a report with created pages and warnings
- Health: `GET /api/health`

## ACL / Permissions

Permission values: `admin > manage > write > read > none`. `manage` = `write` + deciding who can see the page: editing its ACL, toggling `is_public`, and moves that change which ACL anchor it inherits (`page_dep("manage")`, `has_permission(perm, level)` — never compare permission strings directly).

Resolution logic (in `services/acl.py` — routers must use these helpers, never roll their own):
- `admin` role bypasses all checks.
- Per-page ACL rows live in `page_acl (page_id, principal_type, principal_id, permission)` where principal is a user or group.
- To resolve: walk the `parent_id` chain, find the shallowest ancestor with any ACL row (the "anchor", `find_acl_anchor`), and take the most-permissive matching row. If no anchor exists, the page is open by default (write for editors, read for viewers) and its creator gets `manage` on it. Inside a restricted space only explicit `manage` grants count.
- `PUT /acl` refuses a change that would drop the caller's own `manage` (the ACL dialog pre-adds the current user as `manage` on a page's first rules); `DELETE /acl` (re-open the page) doesn't.
- `viewer` role is capped at `read` even when ACL grants write or manage.
- When `ANONYMOUS_READ=true` (env), unauthenticated requests get a synthetic guest user (`id=0`, `role=viewer`, `anonymous=True`) instead of 401. ACL still gates everything — guests can only read pages with no ACL anchor (the open-default set). All write/personal endpoints (bookmarks, comments POST, watch, profile, tokens, AI) reject the guest via `auth.require_real_user`; admin endpoints reject via `require_admin`. `/api/auth/me` keeps returning 401 for unauthenticated requests so the frontend can distinguish guest from logged-in.
- Frontend: `usePermissions` store caches per-slug; seeded from `effective_permission` on page-view responses. Helper functions `canEdit` (write+), `canRead`, `canManageAcl` (manage+, also gates the public-sharing menu) are exported from the store file.

## Themes

Multiple built-in themes (light, dark, lavender, forest, etc.) via CSS variables in `frontend/src/index.css`, persisted with Zustand store `useTheme.js`.

## Deployment

Single Docker image (root `Dockerfile`): a Node stage builds the frontend, the Python stage copies `dist/` to `/app/static` and FastAPI serves it (`app/spa.py`, installed as the router's fallback so `/api` routes always win). No nginx. Request body size caps live in the app (`max_body_size` on `FastAPI(...)` in `main.py`, raised per-route for backup restore). `docker-compose.yml` runs one service on host port 3000 → container 8000 with the `./data` volume. All config in `.env`.

## Development Workflow

Standard loop for every task:

1. **Develop** — implement the change.
2. **Test** — `make test` (or relevant subset: `make test-backend` / `make test-frontend`). Must pass.
3. **Code review** — self-review the diff. If issues found, return to step 1.

Repeat until the review surfaces no further issues. Then report done.

Frontend changes also require `make lint` before review.
