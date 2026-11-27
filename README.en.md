<p align="center">
  <img src="docs/images/logo.jpg" alt="JustWiki Logo" width="480">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.md">中文</a>
</p>

# JustWiki

A lightweight, self-hosted wiki for small teams. Markdown-first, and all your data is one SQLite file plus a media folder — no external database. A 1 vCPU / 512 MB VM or a Raspberry Pi is enough.

<p align="center">
  <img src="docs/images/hero-en.png" alt="JustWiki main UI: page tree on the left, table of contents on the right, Markdown viewer in the middle" width="100%">
</p>

**📖 Documentation and live demo: <https://codingman.cc/JustWiki/>**

Features, how-tos, permissions, SSO, AI chat and administration are all covered in the documentation, which is itself a read-only JustWiki. This README only covers deployment.

## Quick start (Docker Compose)

Requirements: Docker and Docker Compose.

```bash
mkdir justwiki && cd justwiki
curl -fsSLO https://raw.githubusercontent.com/PttCodingMan/JustWiki/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/PttCodingMan/JustWiki/main/.env.example -o .env
```

Edit `.env` and change at least these two:

```bash
# Generate a key: python3 -c "import secrets; print(secrets.token_urlsafe(32))"
SECRET_KEY=<random string>
ADMIN_PASS=<strong password>
```

Start it:

```bash
docker compose up -d
```

Open <http://localhost:3000> and sign in as `admin` with your `ADMIN_PASS`.

> [!IMPORTANT]
> The container **refuses to start** while `SECRET_KEY` is a default or the admin account still has a default password. The reason is printed in the log (`docker compose logs justwiki`).

## Without Compose: docker run

JustWiki ships as a single image (`ghcr.io/pttcodingman/justwiki`); one container serves both the API and the frontend:

```bash
docker run -d --name justwiki --restart unless-stopped \
  -p 3000:8000 -v ./data:/app/data \
  -e SECRET_KEY=<random string> -e ADMIN_PASS=<strong password> \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  ghcr.io/pttcodingman/justwiki:latest
```

The app listens on port 8000 inside the container; the health check endpoint is `/api/health`.

## Exposing it

When people connect from other machines or through a domain, three more things are needed:

1. **HTTPS** — put a TLS reverse proxy (Caddy, Traefik, nginx…) in front, or the session cookie travels in clear text
2. **Allow the public URL as an origin** — otherwise every write (edits, comments…) from that URL is rejected by the CSRF check with 403
3. **Trust the proxy** — so login rate limits see the real client IP

`.env`:

```bash
PUBLIC_BASE_URL_DOCKER=https://wiki.example.com   # with docker run, set PUBLIC_BASE_URL instead
ALLOWED_ORIGINS=https://wiki.example.com
TRUST_PROXY=true
```

An `https://` public URL turns secure cookies on automatically (same as `COOKIE_SECURE=true`).

Caddy (certificates handled automatically):

```
wiki.example.com {
    reverse_proxy localhost:3000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name wiki.example.com;
    # ssl_certificate / ssl_certificate_key ...

    # Media uploads go up to 100 MB; restoring a backup from the UI up to 500 MB
    client_max_body_size 510m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> [!NOTE]
> On a LAN with no proxy, connecting to `http://<host IP>:3000` directly, you still need that URL in `ALLOWED_ORIGINS` (comma-separated for several) or editing won't work. Leave `TRUST_PROXY` at `false`.

## Configuration

Everything is configured in `.env`; run `docker compose up -d` after a change to recreate the container. See [.env.example](.env.example) for every option with comments.

| Variable | Meaning | Default |
| -------- | ------- | ------- |
| `SECRET_KEY` | Session signing key — **must be changed** | `change-me-...` |
| `ADMIN_USER` / `ADMIN_PASS` | The first admin account; `ADMIN_PASS` **must be changed** | `admin` / `admin` |
| `PUBLIC_BASE_URL_DOCKER` | Public URL (Compose) | `http://localhost:3000` |
| `ALLOWED_ORIGINS` | Origins allowed to send writes, comma-separated | localhost only |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy | `false` |
| `COOKIE_SECURE` | Force secure cookies (automatic with an https public URL) | `false` |
| `ANONYMOUS_READ` | Let signed-out visitors read the whole wiki | `false` |
| `AI_ENABLED` | Turn on AI chat (also needs `AI_API_KEY` etc.) | `false` |
| `OIDC_ENABLED` / `LDAP_ENABLED` | Turn on SSO / LDAP sign-in (requires HTTPS) | `false` |
| `CHECK_UPDATES` | Let the dashboard check ghcr.io for new versions | `false` |

For AI chat, SSO and LDAP details see [AI Chat](https://codingman.cc/JustWiki/page/Tw2agRKS) and the [Admin Guide](https://codingman.cc/JustWiki/page/pkXTD5C3) in the documentation.

## Data and backups

All data lives in `./data`:

```
data/
├── just-wiki.db   # SQLite database (WAL mode; -wal / -shm files may sit beside it)
└── media/         # uploaded images and files
```

- **From the UI** — Admin → Backup & Restore → Download Backup gives a `.zip` with the database and media; the same page restores from a `.zip`
- **From the host** — stop the container and copy all of `data/`; if it's running, copy the `-wal` file too
- **Moving servers** — put `docker-compose.yml`, `.env` and `data/` on the new machine and run `docker compose up -d`

## Upgrading

```bash
docker compose pull
docker compose up -d
```

The database schema migrates automatically on startup. Back up `data/` first.

> **Upgrading from the old two-image layout (backend + frontend)**: switch to the new `docker-compose.yml` and run `docker compose up -d --remove-orphans`. The `./data` directory and host port 3000 are unchanged. The old compose file forced `TRUST_PROXY` on and the new one doesn't — set it in `.env` if you have a proxy in front.

## Building from source

```bash
git clone https://github.com/PttCodingMan/JustWiki.git
cd JustWiki
cp .env.example .env   # edit as described above
docker compose up -d --build
```

For local development, tests and the project layout, see the [Developer Guide](https://codingman.cc/JustWiki/page/iP4uO0Bn).

## License

Released under the [MIT License](LICENSE).
