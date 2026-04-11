<p align="center">
  <img src="docs/images/logo.png" alt="JustWiki Logo" width="480">
</p>

# JustWiki

A lightweight, self-hosted wiki for small teams. Just clone, run, and write.

## Features

- **Markdown first** — Milkdown WYSIWYG editor with slash commands, Mermaid diagrams, KaTeX math, callout blocks
- **One SQLite file** — no external database needed. Backup = copy one file
- **Full-text search** — FTS5 powered, with optional AI Q&A (Gemini)
- **Version history** — page revisions with diff view
- **Draw.io integration** — embedded diagram editor
- **Themes** — multiple built-in themes
- **PWA ready** — installable on mobile and desktop
- **Docker support** — `docker-compose up` and done

## Tech Stack

| Layer    | Stack                                          |
| -------- | ---------------------------------------------- |
| Backend  | Python, FastAPI, aiosqlite, Pydantic           |
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand        |
| Editor   | Milkdown (ProseMirror)                         |
| Database | SQLite (single file)                           |
| Deploy   | Docker Compose                                 |

## Quick Start

### Docker (recommended)

```bash
cp .env.example .env
# edit .env — at minimum change SECRET_KEY and ADMIN_PASS
docker-compose up -d
```

Open http://localhost:3000

### Local Development

```bash
make setup   # install backend & frontend dependencies, create .env
make dev     # start backend (port 8000) + frontend (port 3000)
```

Requires: Python 3.11+, Node.js 20+, [uv](https://docs.astral.sh/uv/)

## Configuration

All settings live in a single `.env` file. See [.env.example](.env.example) for available options.

Key variables:

| Variable        | Description                        | Default              |
| --------------- | ---------------------------------- | -------------------- |
| `SECRET_KEY`    | Session signing key                | `change-me-...`      |
| `ADMIN_USER`    | Admin username                     | `admin`              |
| `ADMIN_PASS`    | Admin password                     | `admin`              |
| `DB_PATH`       | SQLite database path               | `./data/just-wiki.db`|
| `AI_ENABLED`    | Enable Gemini AI Q&A               | `false`              |
| `GEMINI_API_KEY`| Gemini API key (when AI enabled)   |                      |

## Makefile Commands

```bash
make dev            # Start backend + frontend in dev mode
make dev-backend    # Start backend only
make dev-frontend   # Start frontend only
make build          # Build frontend for production
make backup         # Backup SQLite database with timestamp
make clean          # Remove database, media, and frontend dist
make docker-up      # docker-compose up -d
make docker-down    # docker-compose down
make setup          # First-time setup (install deps, create .env)
```

## Project Structure

```
just-wiki/
├── backend/          # FastAPI REST API
│   └── app/
│       ├── main.py
│       ├── routers/  # pages, search, media, tags, versions, ...
│       └── services/ # markdown, search, AI, webhook, export
├── frontend/         # React SPA (Vite)
│   └── src/
│       ├── components/
│       │   ├── Editor/   # Milkdown editor
│       │   ├── Viewer/   # Markdown renderer
│       │   ├── Search/   # Search + AI Q&A
│       │   └── Layout/   # Sidebar, Navbar
│       ├── pages/
│       ├── hooks/
│       └── store/        # Zustand
├── data/             # Runtime data (SQLite, media)
├── docker-compose.yml
├── Makefile
└── .env.example
```

## License

This project is licensed under the [MIT License](LICENSE).
