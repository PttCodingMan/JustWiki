# AGENTS.md — Operating JustWiki from an AI agent

This guide teaches an AI agent how to read and write JustWiki content via its
REST API. Everything below is drawn from the live handlers under
`backend/app/routers/` — if behaviour ever diverges from this doc, trust the
code and update the doc.

## Base URL and transport

- Backend: `http://localhost:8000` in development; whatever host you deploy
  `uvicorn` on in production.
- All endpoints are JSON and live under `/api/`. The Vite dev server proxies
  `/api` → `:8000`, so `http://localhost:5173/api/...` works too.
- The server is a single-worker FastAPI app backed by SQLite in WAL mode.
  Assume low concurrency: you will not be fighting many writers.

## Authentication

JustWiki accepts two kinds of credentials on every authenticated endpoint:

1. **Personal API token** (recommended for agents) — looks like
   `jwk_<random>`. Long-lived, revocable, created in the Profile page.
2. **Session JWT** — issued by `/api/auth/login`, lives 24 hours, delivered
   as an httpOnly cookie or Bearer header. Good for short interactive jobs
   and the web UI.

Both are sent the same way: `Authorization: Bearer <token>`. The server
tells them apart by the `jwk_` prefix.

### Create an API token (one-time human step)

1. Log in to JustWiki with a password.
2. Open **Profile → API Tokens**.
3. Click **New Token**, name it (e.g. `ci-bot`), pick an expiry (default 30
   days, max 365, or "Never").
4. Copy the token string that starts with `jwk_…`. **This is the only time
   it will be shown.** If you lose it, revoke and mint a new one.

Prefer creating a dedicated `editor`-role account for agents so revocation
is clean and audit logs are easy to read.

Policy recap:

- Only `editor`/`admin` roles can create tokens; `viewer` cannot.
- A token **cannot** mint another token — stopping an attacker from using a
  stolen token to survive your revocation.
- Revoking leaves the row in place so `last_used` / activity entries
  remain auditable.
- No rate limit on token usage (only login is rate-limited).

### Use the token

```bash
export JW_TOKEN="jwk_xxxxxxxxxxxx..."

curl -sS -H "Authorization: Bearer $JW_TOKEN" \
     http://localhost:8000/api/auth/me
```

### Password login (alternative)

```bash
curl -sS -c cookies.txt -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
curl -sS -b cookies.txt http://localhost:8000/api/auth/me
```

Login is rate-limited to **5 attempts/IP/60s**. Back off on HTTP 429.

### Manage your own tokens from the API

| Method | Path                         | Purpose                               |
| ------ | ---------------------------- | ------------------------------------- |
| GET    | `/api/auth/tokens`           | List your tokens (plaintext not sent) |
| POST   | `/api/auth/tokens`           | Create one (body: `{name, expires_in_days}`) — only over session login |
| DELETE | `/api/auth/tokens/{id}`      | Revoke                                |

### Roles

| role   | can read | can write | can delete own | admin things |
| ------ | -------- | --------- | -------------- | ------------ |
| admin  | ✅        | ✅         | any page       | ✅ all        |
| editor | ✅        | ✅         | own pages      | ❌            |
| viewer | ✅        | ❌         | ❌              | ❌            |

`viewer` is capped at read even if an ACL grants write. `admin` bypasses all
ACL checks. The creator or an admin may delete a page. Only admins may purge
(hard-delete) from the trash.

## Resource reference

All routes are authenticated unless noted.

### Pages — `/api/pages`

| Method | Path                         | Purpose                                   |
| ------ | ---------------------------- | ----------------------------------------- |
| GET    | `/api/pages`                 | Paginated list (filter by `parent_id`)    |
| GET    | `/api/pages/tree`            | Hierarchical tree                         |
| GET    | `/api/pages/graph`           | Node/link graph for visualisation         |
| POST   | `/api/pages`                 | Create a page                             |
| GET    | `/api/pages/{slug}`          | Read one page (also bumps view count)     |
| PUT    | `/api/pages/{slug}`          | Update (requires `base_version` on edits) |
| PATCH  | `/api/pages/{slug}/move`     | Change `parent_id` / `sort_order`         |
| DELETE | `/api/pages/{slug}`          | Soft-delete (moves to trash)              |
| GET    | `/api/pages/{slug}/children` | Direct children                           |
| GET    | `/api/pages/{slug}/backlinks`| Incoming wikilinks                        |

### Versions — `/api/pages/{slug}/...`

| Method | Path                                    | Purpose                 |
| ------ | --------------------------------------- | ----------------------- |
| GET    | `/api/pages/{slug}/versions`            | List prior versions     |
| GET    | `/api/pages/{slug}/versions/{num}`      | Read a specific version |
| GET    | `/api/pages/{slug}/diff?v1=A&v2=B`      | Unified diff            |
| POST   | `/api/pages/{slug}/revert/{num}`        | Revert to version `num` |

### Search — `/api/search`

`GET /api/search?q=...&tag=...&page=1&per_page=20`. FTS5 with trigram; queries
with any word shorter than 3 chars fall back to LIKE. Snippets have matched
terms wrapped in `<mark>...</mark>`.

### Tags — `/api/tags`, `/api/pages/{slug}/tags`

List all tags with page counts, add/remove tag on a page.

### Media — `/api/media`

| Method | Path                       | Purpose                           |
| ------ | -------------------------- | --------------------------------- |
| POST   | `/api/media/upload`        | Multipart upload (20 MB limit)    |
| GET    | `/api/media`               | List visible media                |
| GET    | `/api/media/{filename}`    | Fetch file (ACL-checked)          |
| DELETE | `/api/media/{media_id}`    | Delete (admin, no live refs only) |

Allowed types: PNG, JPEG, GIF, WebP, SVG, PDF, text/plain, text/markdown.

### ACL — `/api/pages/{slug}/acl`

| Method | Path                                  | Purpose                           |
| ------ | ------------------------------------- | --------------------------------- |
| GET    | `/api/pages/{slug}/acl`               | Explicit + inherited rows         |
| PUT    | `/api/pages/{slug}/acl`               | Replace the explicit ACL set      |
| DELETE | `/api/pages/{slug}/acl`               | Clear explicit rows (re-inherit)  |
| GET    | `/api/pages/{slug}/my-permission`     | Your resolved permission          |

ACL row shape: `{"principal_type":"user"|"group","principal_id":<int>,"permission":"read"|"write"}`.

### Groups — `/api/groups` (admin-only for writes)

`GET /api/groups`, `POST /api/groups`, `DELETE /api/groups/{id}`,
`GET /api/groups/{id}/members`, `POST /api/groups/{id}/members`,
`DELETE /api/groups/{id}/members/{user_id}`.

### Comments — `/api/pages/{slug}/comments`

Read requires page-read; writes require page-write. `POST`, `PUT /{id}`,
`DELETE /{id}`. Non-admin authors can only edit or delete their own comments.

### Trash — `/api/trash`

`GET /api/trash` (your own items; admin sees all), `POST /api/trash/{slug}/restore`,
`DELETE /api/trash/{slug}` (admin-only hard delete).

### Templates — `/api/templates`

`GET`, `POST`, `PUT /{id}`, `DELETE /{id}`. You can pass `template_id` on
page creation and the template's `content_md` will seed the new page.

### Users — `/api/users` (mostly admin)

`GET /api/users/search?q=...&limit=...` is open to any authenticated user
(for ACL pickers). All other user CRUD is admin-only.

## Core write workflows

### 1. Create a page

```bash
curl -sS -b cookies.txt -X POST http://localhost:8000/api/pages \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Release checklist",
    "content_md": "# Release checklist\n\n- [ ] Bump version\n- [ ] Run tests\n",
    "parent_id": null,
    "sort_order": 0
  }'
```

Returns the created page, including `slug` (auto-generated from title; CJK
preserved) and `version: 1`. To nest under a parent, include `parent_id`; you
need write permission on the parent.

Templates: pass `"template_id": <int>` instead of `content_md` to seed from a
template.

### 2. Edit a page (optimistic locking)

`content_md` / `title` edits **require** `base_version` equal to the current
`version` on disk; otherwise you get HTTP 400 (`base_version_required`) or
409 (`conflict`). Metadata-only edits (`is_public`, `parent_id`, `sort_order`)
do not need it.

```bash
# 1) Read the page to learn its current version
curl -sS -b cookies.txt http://localhost:8000/api/pages/release-checklist \
  | jq '{version, slug}'
# → {"version": 3, "slug": "release-checklist"}

# 2) Send the edit with base_version
curl -sS -b cookies.txt -X PUT http://localhost:8000/api/pages/release-checklist \
  -H 'Content-Type: application/json' \
  -d '{
    "content_md": "# Release checklist\n\n- [x] Bump version\n- [ ] Run tests\n",
    "base_version": 3
  }'
```

On conflict (409) the server returns the latest `current_version`; re-read,
re-apply your change on top, and retry.

### 3. Upload media and reference it

```bash
curl -sS -b cookies.txt -X POST http://localhost:8000/api/media/upload \
  -F "file=@diagram.png"
# → {"id": 42, "filename":"ab12...png", "url":"/api/media/ab12...png", ...}
```

Then embed it in a page's `content_md`:

```markdown
![Architecture](/api/media/ab12...png)
```

The server scans page content on write and records each media reference in
`media_references`. Referenced media survives media-list filtering and cannot
be deleted until all referencing pages are purged.

### 4. Tag a page

```bash
curl -sS -b cookies.txt -X POST \
  http://localhost:8000/api/pages/release-checklist/tags \
  -H 'Content-Type: application/json' \
  -d '{"name":"ops"}'
```

`POST` creates the tag if it doesn't exist. `DELETE /api/pages/{slug}/tags/{tag_name}`
removes it; orphan tags are cleaned up automatically.

### 5. Restrict a page with ACL

```bash
# Grant a group read-only, a user write. Any existing rows are replaced.
curl -sS -b cookies.txt -X PUT \
  http://localhost:8000/api/pages/release-checklist/acl \
  -H 'Content-Type: application/json' \
  -d '{
    "rows": [
      {"principal_type":"group","principal_id": 3, "permission":"read"},
      {"principal_type":"user", "principal_id": 7, "permission":"write"}
    ]
  }'
```

Resolution rule: walk the `parent_id` chain, find the shallowest ancestor
with any ACL rows (the "anchor"), and take the most-permissive matching row
for the caller. No anchor ⇒ default open (write for editor, read for viewer).

Clear with `DELETE /api/pages/{slug}/acl` — the page then re-inherits.

### 6. Move a page

```bash
curl -sS -b cookies.txt -X PATCH \
  http://localhost:8000/api/pages/release-checklist/move \
  -H 'Content-Type: application/json' \
  -d '{"parent_id": 12, "sort_order": 5}'
```

Refuses with 400 if it would create a cycle. Requires write on both source
and destination parent.

### 7. Soft-delete and restore

```bash
# Soft delete (moves to trash; slug stays reserved)
curl -sS -b cookies.txt -X DELETE http://localhost:8000/api/pages/release-checklist

# Restore
curl -sS -b cookies.txt -X POST http://localhost:8000/api/trash/release-checklist/restore
```

Admin-only hard delete: `DELETE /api/trash/{slug}`.

### 8. Revert to an old version

```bash
curl -sS -b cookies.txt http://localhost:8000/api/pages/release-checklist/versions
curl -sS -b cookies.txt -X POST \
  http://localhost:8000/api/pages/release-checklist/revert/2
```

Reverting snapshots the current content into a new version first, then writes
the old content back and bumps `version` — a subsequent concurrent editor
will get a 409 as expected.

## Markdown conventions

Use stock GFM plus these JustWiki extensions. The backend parses them on
write to keep backlinks and media refs in sync; the viewer renders them.

- **Wikilinks** — `[[slug]]` or `[[slug|display text]]`. Creates a
  `backlinks` row and renders as a link to `/wiki/<slug>`. Auto-slug keeps
  CJK characters (e.g. `[[專案規劃]]`).
- **Transclusion** — `![[slug]]` inlines another page's rendered content.
- **Callouts** — fenced blocks: `:::info` / `:::tip` / `:::warning` / `:::danger`
  ending with `:::`.
- **Math** — `$inline$` and `$$display$$` (KaTeX).
- **Mermaid** — ```` ```mermaid ... ``` ```` fences.
- **Draw.io** — `::drawio[diagram_id]` embeds.

`content_md` is stored verbatim; the viewer sanitises on render with
DOMPurify. You can assume raw HTML in markdown will be stripped.

## Pitfalls an agent should know about

1. **Always fetch before editing.** Skipping the read to get `version` is the
   fastest way to hit `base_version_required` or `conflict`.
2. **Slugs are case-sensitive URL keys.** They're derived from the title;
   if you need a specific slug, pass it explicitly on `POST /api/pages`.
3. **404 may mean "no permission".** The server returns 404 instead of 403
   for pages the caller can't read, so treat 404 on known slugs as "maybe
   ACL-blocked."
4. **Soft-delete keeps the slug reserved.** To reuse a slug, either restore
   the trashed page or admin-purge it first.
5. **View counts bump on GET** — reading `/api/pages/{slug}` is a write in
   disguise. Dedup'd per (user, page) over `VIEW_DEDUP_MINUTES`, but still
   something to know if you're scraping.
6. **Editor and Viewer are separate render paths.** The dual pipeline lives
   on the frontend; content written via the API goes through the viewer path
   on display. If you're testing a markdown feature end-to-end, also click
   through the Editor in the UI.
7. **Rate limits.** Login: 5/min/IP. AI chat: `AI_RATE_LIMIT_PER_HOUR` per
   user. Public reads: 60/min/IP. No global write limit, but respect 429.

## Quick session template

```bash
# 1. Authenticate once (Profile → API Tokens → Copy)
export JW_TOKEN="jwk_xxxxxxxxxxxx..."
AUTH=(-H "Authorization: Bearer $JW_TOKEN")

# 2. Read current state
curl -sS "${AUTH[@]}" http://localhost:8000/api/pages/my-page | jq '{slug,version}'

# 3. Mutate with base_version
curl -sS "${AUTH[@]}" -X PUT http://localhost:8000/api/pages/my-page \
  -H 'Content-Type: application/json' \
  -d '{"content_md":"…new content…","base_version":7}'
```

## Further reading in this repo

- `backend/app/routers/` — one file per domain, each handler is short; read
  the one matching your endpoint for the exact contract.
- `backend/app/schemas.py` — Pydantic request/response models.
- `backend/app/services/acl.py` — the single source of truth for permission
  resolution; every router calls these helpers.
- `CLAUDE.md` — project-wide conventions and the dev workflow.
