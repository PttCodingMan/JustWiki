# Developer Guide

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, aiosqlite, Pydantic |
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand |
| Editor | Milkdown (ProseMirror) |
| Database | A single SQLite file (WAL mode, FTS5 full-text index) |
| Deployment | One Docker image; FastAPI serves both the API and the frontend |

## Local development

Requirements: Python 3.11+, Node.js 20+, [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/PttCodingMan/JustWiki.git
cd JustWiki
make setup   # install backend + frontend deps, create .env
make dev     # backend on http://localhost:8000 + frontend on http://localhost:5173
```

Open http://localhost:5173 while developing; Vite proxies `/api` to the backend.

## Makefile targets

| Target | What it does |
|--------|--------------|
| `make setup` | First-time setup (install deps, create .env) |
| `make dev` | Start backend and frontend together |
| `make dev-backend` | Backend only (uvicorn --reload, port 8000) |
| `make dev-frontend` | Frontend only (Vite, port 5173) |
| `make build` | Production build of the frontend |
| `make test` | All backend and frontend tests |
| `make test-backend` / `make test-frontend` | Backend (pytest) or frontend (vitest) tests only |
| `make lint` | Frontend lint |
| `make backup` | Timestamped copy of the SQLite database |
| `make clean` | Remove the database, media and frontend dist |
| `make docker-up` / `make docker-down` | Start / stop Docker Compose |

## Project layout

```
JustWiki/
├── backend/            # FastAPI
│   ├── app/
│   │   ├── main.py     # app creation, middleware, router mounting
│   │   ├── routers/    # one file per domain: pages, search, media, acl…
│   │   ├── services/   # search index, wikilinks, ACL, notifications, OIDC, LDAP…
│   │   └── seed/       # first-launch welcome pages and default templates (Markdown)
│   ├── scripts/        # tools such as build_static_demo.py
│   └── tests/
├── frontend/           # React SPA (Vite)
│   └── src/
│       ├── components/ # Editor (Milkdown), Viewer (markdown-it), Layout…
│       ├── pages/
│       ├── store/      # Zustand
│       └── lib/markdown.js  # the viewer's Markdown pipeline
├── docs/
│   ├── images/         # screenshots used by the README and this guide
│   └── manual/         # source Markdown for this guide
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## REST API

Everything the UI does goes through the same REST API. Interactive API docs are served by your own instance at `https://your-host/docs`.

### API tokens

Create a personal token (starting with `jwk_`) under **Profile → API Tokens**, with an expiry in days or none. The token is shown in full only once, carries your own permissions, and should be revoked when no longer needed. Viewer accounts can't create tokens.

Send it in the `Authorization` header:

```bash
curl -H "Authorization: Bearer jwk_xxxxxxxx" https://wiki.example.com/api/pages/tree
```

### Common endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/pages/tree` | Page tree |
| `GET` | `/api/pages/{slug}` | Read a page (including `content_md` and `version`) |
| `POST` | `/api/pages` | Create a page: `title`, `content_md`, `parent_id`, `page_type`… |
| `PUT` | `/api/pages/{slug}` | Update a page |
| `PATCH` | `/api/pages/{slug}/move` | Move a page |
| `DELETE` | `/api/pages/{slug}` | Delete a page (to Trash) |
| `GET` | `/api/search?q=term&tag=tag` | Full-text search |

### Updates need base_version

When changing `title` or `content_md`, send the version you read as `base_version`:

```bash
curl -X PUT https://wiki.example.com/api/pages/aB3xK9pQ \
  -H "Authorization: Bearer jwk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"content_md": "# New content", "base_version": 7}'
```

If someone changed the page in the meantime you get a **409**:

```json
{ "error": "base_version_stale", "your_version": 7, "current_version": 8 }
```

Re-read the latest content, merge, and send again. Omitting `base_version` returns `base_version_required`.

## How this demo is built

This site is the real frontend built in demo mode (`VITE_DEMO=true`). `backend/scripts/build_static_demo.py` boots a throwaway JustWiki, imports the Markdown in `docs/manual/`, and saves the response of every read API the UI calls as JSON. The frontend reads those files instead of a server, so it runs on a static host like GitHub Pages and redeploys on every push to main.

To change this guide, edit `docs/manual/` in the repository.
