<p align="center">
  <img src="docs/images/logo.png" alt="JustWiki Logo" width="480">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh.md">中文</a>
</p>

# JustWiki

A lightweight, self-hosted wiki for small teams. Just clone, run, and write.

## Features

- **Markdown first** — Milkdown WYSIWYG editor with slash commands, Mermaid diagrams, KaTeX math, callout blocks
- **One SQLite file** — no external database needed. Backup = copy one file
- **Full-text search** — FTS5 powered, with optional AI Q&A (Gemini)
- **Version history** — page revisions with diff view
- **Draw.io integration** — embedded diagram editor
- **Themes** — 9 built-in color palettes ([preview](#themes))
- **PWA ready** — installable on mobile and desktop
- **Docker support** — `docker-compose up` and done

## Themes

<p align="center">
  <img src="docs/images/themes.png" alt="9 built-in themes: Light, Dark, Lavender, Forest, Rose, Ocean, Sand, Sunset, Nord" width="100%">
</p>

Nine curated palettes ship out of the box — **Light, Dark, Lavender, Forest, Rose, Ocean, Sand, Sunset, Nord**. Switch any time from the top-right theme picker; your choice is remembered per browser.

## Deployment

### Docker (Recommended)

The fastest way to get JustWiki running is with Docker Compose.

```bash
cp .env.example .env
# edit .env — at minimum change SECRET_KEY and ADMIN_PASS
docker-compose up -d
```

Open http://localhost:3000 to start writing.

### Configuration

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

## Usage

### Slash Commands

<p align="center">
  <img src="docs/images/slash-commands.png" alt="Type / in the editor to open the slash command menu" width="80%">
</p>

In the editor, type `/` to open the slash menu. You can filter by typing after the slash.

| Command | Description |
| ------- | ----------- |
| `/h1` | Heading 1 — big section heading |
| `/h2` | Heading 2 — medium section heading |
| `/h3` | Heading 3 — small section heading |
| `/bullet` | Bullet List — unordered list |
| `/ordered` | Ordered List — numbered list |
| `/quote` | Blockquote — quote block |
| `/code` | Code Block — code snippet |
| `/hr` | Divider — horizontal rule |
| `/callout-info` | Info Callout — `:::info` block |
| `/callout-warning` | Warning Callout — `:::warning` block |
| `/callout-tip` | Tip Callout — `:::tip` block |
| `/callout-danger` | Danger Callout — `:::danger` block |
| `/mermaid` | Mermaid Diagram — insert mermaid chart |
| `/math` | Math Formula — KaTeX math block |
| `/drawio` | Draw.io Diagram — insert Draw.io embed |

---

## Development Guide

### Tech Stack

| Layer    | Stack                                          |
| -------- | ---------------------------------------------- |
| Backend  | Python, FastAPI, aiosqlite, Pydantic           |
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand        |
| Editor   | Milkdown (ProseMirror)                         |
| Database | SQLite (single file)                           |
| Deploy   | Docker Compose                                 |

### Local Development

1. **Setup**: Install backend & frontend dependencies and create `.env`
   ```bash
   make setup
   ```
   *Requires: Python 3.11+, Node.js 20+, [uv](https://docs.astral.sh/uv/)*

2. **Run**: Start backend (port 8000) and frontend (port 3000)
   ```bash
   make dev
   ```

### Makefile Commands

| Command | Description |
| ------- | ----------- |
| `make dev` | Start backend + frontend in dev mode |
| `make dev-backend` | Start backend only |
| `make dev-frontend` | Start frontend only |
| `make build` | Build frontend for production |
| `make backup` | Backup SQLite database with timestamp |
| `make clean` | Remove database, media, and frontend dist |
| `make docker-up` | `docker-compose up -d` |
| `make docker-down` | `docker-compose down` |
| `make setup` | First-time setup (install deps, create .env) |

### Project Structure

```
justwiki/
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
