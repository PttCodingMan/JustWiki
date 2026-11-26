# Single image: the React frontend is built in a Node stage, then copied into
# the Python image and served by FastAPI itself (backend/app/spa.py). No
# nginx — one container, one port.
#
# Build context is the repo root so VERSION (single source of truth) reaches
# both stages. See docker-compose.yml and .github/workflows/ci.yml.

# ── Frontend build ──
FROM node:20-alpine AS frontend

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
COPY VERSION /app/VERSION
RUN npm run build \
 # Pre-compress text assets so the backend can serve .gz without spending
 # CPU per request. Originals stay for clients that don't accept gzip.
 && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \
      -o -name '*.svg' -o -name '*.json' -o -name '*.txt' -o -name '*.map' \) \
      -size +1k -exec gzip -9 -k {} +

# ── Runtime ──
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY VERSION /app/VERSION
# config.FRONTEND_DIST_DIR defaults to <backend>/static, i.e. /app/static.
COPY --from=frontend /app/dist /app/static

# Defaults for a plain `docker run -v ./data:/app/data`. docker-compose.yml
# sets these again because its env_file (.env) would otherwise override them
# with the dev paths from .env.example.
ENV DATA_DIR=/app/data \
    DB_PATH=/app/data/just-wiki.db \
    MEDIA_DIR=/app/data/media

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "__import__('urllib.request',fromlist=['request']).urlopen('http://localhost:8000/api/health',timeout=3).read()" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
