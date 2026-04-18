import base64
from pathlib import Path

import pytest

from app.config import settings

@pytest.mark.asyncio
async def test_export_page(auth_client):
    # Create page
    await auth_client.post("/api/pages", json={
        "title": "Export Page",
        "content_md": "Export content",
        "slug": "export-page"
    })

    response = await auth_client.get("/api/export/page/export-page")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
    assert b"Export content" in response.content

@pytest.mark.asyncio
async def test_export_page_pdf_auto_prints(auth_client):
    """format=pdf returns HTML that auto-opens the browser print dialog."""
    await auth_client.post("/api/pages", json={
        "title": "PDF Page",
        "content_md": "PDF content body",
        "slug": "pdf-page",
    })

    response = await auth_client.get("/api/export/page/pdf-page?format=pdf")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/html; charset=utf-8"
    # inline (browser displays it) rather than attachment (which would download
    # a useless .html pretending to be a PDF).
    assert "inline" in response.headers["content-disposition"]

    body = response.text
    assert "PDF content body" in body
    assert "window.print()" in body
    assert "print-hint" in body
    # Print CSS hides the hint banner in the rendered PDF.
    assert "@media print" in body
    assert ".print-hint { display: none; }" in body


@pytest.mark.asyncio
async def test_export_page_html_has_no_auto_print(auth_client):
    """format=html must NOT auto-print — it's a plain download."""
    await auth_client.post("/api/pages", json={
        "title": "Html Only",
        "content_md": "Plain html export",
        "slug": "html-only",
    })

    response = await auth_client.get("/api/export/page/html-only?format=html")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    assert "window.print()" not in response.text
    assert "print-hint" not in response.text


@pytest.mark.asyncio
async def test_export_page_pdf_content_not_double_injected(auth_client):
    """Page content containing '<body>' literal must not trigger re-injection.

    md_to_simple_html escapes `<` and `>`, so user content cannot smuggle real
    `<body>` / `</style>` tags into the template — but guard the assumption
    with a test so regressions in the markdown escaping are caught here.
    """
    await auth_client.post("/api/pages", json={
        "title": "Tricky",
        "content_md": "Body tag test: <body> </style> </body>",
        "slug": "tricky-tags",
    })

    response = await auth_client.get("/api/export/page/tricky-tags?format=pdf")
    assert response.status_code == 200
    body = response.text
    # Exactly one auto-print script and one hint banner.
    assert body.count("window.print()") == 1
    assert body.count('class="print-hint"') == 1


@pytest.mark.asyncio
async def test_export_page_inlines_media_images(auth_client):
    """Images served from /api/media must be embedded as data URIs so the
    exported file stays self-contained when opened via file:// or saved as PDF.
    """
    # 1x1 PNG, placed directly in MEDIA_DIR to bypass the auth-gated upload
    # endpoint (which would require bouncing through a multipart request).
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    filename = "export-test-pixel.png"
    filepath = Path(settings.MEDIA_DIR) / filename
    filepath.write_bytes(png_bytes)

    try:
        await auth_client.post("/api/pages", json={
            "title": "With Image",
            "content_md": f"Has image: ![pixel](/api/media/{filename})",
            "slug": "with-image",
        })

        response = await auth_client.get("/api/export/page/with-image")
        assert response.status_code == 200
        body = response.text
        expected = "data:image/png;base64," + base64.b64encode(png_bytes).decode()
        assert expected in body
        # Raw /api/media path must not leak through in the exported src.
        assert f'src="/api/media/{filename}"' not in body

        # PDF export goes through the same inlining path.
        pdf_response = await auth_client.get(
            "/api/export/page/with-image?format=pdf"
        )
        assert expected in pdf_response.text
    finally:
        filepath.unlink(missing_ok=True)


@pytest.mark.asyncio
async def test_export_double_backtick_doesnt_desync_inline_code(auth_client):
    """`` `x` `` (double-backtick escape for a backtick inside inline code) must
    not flip <code>/</code> tags for later inline code in the same document.

    Regression: the original `([^`]+)` regex paired backticks left-to-right,
    so ``| `` `x` `` | `y` |`` left stray backticks that inverted every
    subsequent `<code>` span — e.g. `.env` rendered as `</code>.env`.
    """
    await auth_client.post("/api/pages", json={
        "title": "Backtick Escape",
        "content_md": (
            "Escape demo: `` `inner` ``\n\n"
            "Later inline: `./data` and `.env`\n"
        ),
        "slug": "backtick-escape",
    })
    response = await auth_client.get("/api/export/page/backtick-escape")
    assert response.status_code == 200
    body = response.text

    # The later inline codes must render with correctly ordered tags.
    assert "<code>./data</code>" in body
    assert "<code>.env</code>" in body
    # And no flipped tags should leak out.
    assert "</code>./data" not in body
    assert "</code>.env" not in body


@pytest.mark.asyncio
async def test_export_site_requires_admin(auth_client):
    # Non-admins should be blocked — site exports would otherwise silently
    # omit ACL-restricted content with no user-visible indicator.
    response = await auth_client.get("/api/export/site")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_export_site_admin(admin_client):
    response = await admin_client.get("/api/export/site")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/zip"
