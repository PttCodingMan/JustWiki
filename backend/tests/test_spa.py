"""Single-image deployment: the backend serves the built frontend and caps
request bodies itself (previously nginx's job)."""

import gzip

import pytest

from app.main import MAX_REQUEST_BODY, app
from app.spa import SPAStaticFiles, install_spa

INDEX = "<!doctype html><html><body>JustWiki shell</body></html>"
APP_JS = "console.log('hello from a hashed bundle');" * 50


@pytest.fixture
def dist(tmp_path):
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text(INDEX)
    (d / "assets" / "index-abc123.js").write_text(APP_JS)
    (d / "assets" / "index-abc123.js.gz").write_bytes(gzip.compress(APP_JS.encode()))
    (d / "favicon.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    return d


@pytest.fixture
def spa(dist):
    original = app.router.default
    assert install_spa(app, dist) is True
    yield dist
    app.router.default = original


def test_install_spa_is_noop_without_build(tmp_path):
    original = app.router.default
    assert install_spa(app, tmp_path / "missing") is False
    assert app.router.default is original


@pytest.mark.asyncio
async def test_root_serves_index(spa, client):
    r = await client.get("/")
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_client_side_route_falls_back_to_index(spa, client):
    r = await client.get("/page/aB3dE5fG/edit")
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_hashed_asset_is_immutable_and_gzipped(spa, client):
    r = await client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers["content-encoding"] == "gzip"
    assert "javascript" in r.headers["content-type"]
    assert "immutable" in r.headers["cache-control"]
    assert r.text == APP_JS  # httpx transparently decodes


@pytest.mark.asyncio
async def test_asset_served_plain_without_gzip(spa, client):
    r = await client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert r.text == APP_JS


@pytest.mark.asyncio
async def test_root_level_public_file(spa, client):
    r = await client.get("/favicon.svg")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_missing_asset_is_404_not_index(spa, client):
    r = await client.get("/assets/index-gone.js")
    assert r.status_code == 404
    assert INDEX not in r.text


@pytest.mark.asyncio
async def test_unknown_api_path_keeps_json_404(spa, client):
    r = await client.get("/api/does-not-exist")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


@pytest.mark.asyncio
async def test_api_routes_still_win(spa, client):
    r = await client.get("/api/health")
    assert r.json() == {"status": "ok"}
    r = await client.get("/api/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_wrong_method_on_api_route_is_still_405(spa, client):
    r = await client.delete("/api/health")
    assert r.status_code == 405


@pytest.mark.asyncio
async def test_non_get_on_spa_path_is_404(spa, client):
    r = await client.post("/page/abc")
    assert r.status_code == 404


def test_path_traversal_is_not_served(dist):
    s = SPAStaticFiles(dist, fallback=None)
    assert s._resolve("/../secret.txt") is None
    assert s._resolve("/assets/../../secret.txt") is None
    assert s._resolve("/bad\x00name") is None
    assert s._resolve("/assets/index-abc123.js") is not None


# ── Request body limits ──


async def _chunks(total: int, size: int = 1024 * 1024):
    sent = 0
    while sent < total:
        n = min(size, total - sent)
        sent += n
        yield b"0" * n


@pytest.mark.asyncio
async def test_oversized_body_rejected_before_auth(client):
    # Unauthenticated, chunked (no Content-Length): the cap still applies
    # while the body streams in, so it can't be used to fill memory/disk.
    r = await client.post(
        "/api/auth/login",
        content=_chunks(MAX_REQUEST_BODY + 1),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_oversized_content_length_rejected(client):
    r = await client.post(
        "/api/media/upload",
        content=b"0" * (MAX_REQUEST_BODY + 1),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_backup_restore_allows_larger_body(admin_client):
    # Above the app-wide cap but within the restore route's own limit: the
    # request must reach the handler (which rejects the non-zip upload).
    payload = b"0" * (MAX_REQUEST_BODY + 1024 * 1024)
    r = await admin_client.post(
        "/api/backup/restore",
        files={"file": ("big.bin", payload, "application/octet-stream")},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "File must be a .zip"
