"""Regression tests for media upload hardening.

Background: the upload endpoint previously trusted the client-declared
Content-Type and allowed SVG uploads without scanning the payload. That
combination turned SVG into a stored-XSS vector and let polyglot files
slip past the allow-list. These tests cover:

  * content-type must match the actual file bytes (PNG/JPEG/GIF),
  * SVG uploads are scanned for <script> / on*= handlers,
  * the serve path adds ``nosniff`` (all formats) and forces an
    attachment disposition for SVG even after the upload-time filter.
"""
import pytest


# Minimal 1x1 PNG (8-byte PNG signature + IHDR/IDAT/IEND). Small enough to
# paste inline so the test doesn't depend on a fixture file.
_PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


@pytest.mark.asyncio
async def test_upload_rejects_content_type_mismatch(auth_client):
    # Claim image/png but send JPEG magic bytes → the sniffer catches it.
    fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    files = {"file": ("sneaky.png", fake_jpeg, "image/png")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 400
    assert "do not match" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upload_rejects_svg_with_script_tag(auth_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    files = {"file": ("xss.svg", svg, "image/svg+xml")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 400
    assert "script" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upload_rejects_svg_with_event_handler(auth_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
    files = {"file": ("xss.svg", svg, "image/svg+xml")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_upload_accepts_clean_png(auth_client):
    files = {"file": ("ok.png", _PNG_BYTES, "image/png")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 201, res.text
    filename = res.json()["filename"]

    # Serve path must set nosniff.
    got = await auth_client.get(f"/api/media/{filename}")
    assert got.status_code == 200
    assert got.headers.get("x-content-type-options", "").lower() == "nosniff"
    # PNG should NOT be served as attachment — only SVG is forced to download.
    assert "attachment" not in got.headers.get("content-disposition", "").lower()


@pytest.mark.asyncio
async def test_upload_accepts_clean_svg_but_serves_as_attachment(auth_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'
    files = {"file": ("ok.svg", svg, "image/svg+xml")}
    res = await auth_client.post("/api/media/upload", files=files)
    assert res.status_code == 201
    filename = res.json()["filename"]

    got = await auth_client.get(f"/api/media/{filename}")
    assert got.status_code == 200
    # Even a clean SVG must not render inline in the app's origin, which
    # would execute any script embedded via a future bypass.
    assert got.headers.get("x-content-type-options", "").lower() == "nosniff"
    assert "attachment" in got.headers.get("content-disposition", "").lower()
