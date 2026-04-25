FROM python:3.12-slim

WORKDIR /app

# Build context is the repo root so VERSION (single source of truth) is
# available at /app/VERSION inside the image. See docker-compose.yml and
# .github/workflows/ci.yml — both set context to the repo root.

# psutil has prebuilt manylinux wheels on PyPI for CPython 3.12 so no
# build-essential is needed. If you pin a version without a wheel, add
# `gcc python3-dev` here.

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY VERSION /app/VERSION

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health',timeout=3).status==200 else 1)" || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
