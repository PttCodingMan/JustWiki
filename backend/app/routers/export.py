import io
import re
import urllib.parse
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, HTMLResponse

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.services.acl import resolve_page_permission


def _sanitize_url(url: str) -> str:
    """Block javascript:, data:text/html, and vbscript: URLs."""
    decoded = urllib.parse.unquote(url).replace(" ", "").lower()
    if decoded.startswith(("javascript:", "data:text/html", "vbscript:")):
        return "about:blank"
    return url

router = APIRouter(prefix="/api/export", tags=["export"])

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1e293b; line-height: 1.7; }}
  h1 {{ border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; }}
  h2 {{ border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }}
  pre {{ background: #1e293b; color: #e2e8f0; padding: 1em; border-radius: 8px; overflow-x: auto; }}
  code {{ background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }}
  pre code {{ background: none; padding: 0; color: inherit; }}
  blockquote {{ border-left: 4px solid #e2e8f0; padding-left: 1em; color: #64748b; margin: 0.5em 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 0.75em 0; }}
  th, td {{ border: 1px solid #e2e8f0; padding: 0.5em 0.75em; text-align: left; }}
  th {{ background: #f8fafc; font-weight: 600; }}
  img {{ max-width: 100%; }}
  a {{ color: #2563eb; }}
  hr {{ border: none; border-top: 2px solid #e2e8f0; margin: 1.5em 0; }}
  .callout {{ border: 1px solid; border-radius: 8px; padding: 0.75em 1em; margin: 1em 0; }}
  .callout-info {{ border-color: #bfdbfe; background: #f0f7ff; }}
  .callout-warning {{ border-color: #fde68a; background: #fffdf5; }}
  .callout-tip {{ border-color: #a7f3d0; background: #f0fdf8; }}
  .callout-danger {{ border-color: #fecaca; background: #fff5f5; }}
  .meta {{ color: #94a3b8; font-size: 0.85em; margin-bottom: 2em; }}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="meta">Exported from JustWiki &middot; /{slug}</div>
{content}
</body>
</html>"""

SITE_INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JustWiki Export</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1e293b; }}
  h1 {{ border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; }}
  a {{ color: #2563eb; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  li {{ margin: 0.3em 0; }}
</style>
</head>
<body>
<h1>JustWiki</h1>
<ul>
{page_list}
</ul>
</body>
</html>"""


def md_to_simple_html(text):
    """Minimal markdown-to-HTML for export (no JS deps)."""
    if not text:
        return ""

    # Code blocks
    blocks = []
    def save_block(m):
        lang = m.group(1)
        code = m.group(2)
        idx = len(blocks)
        escaped = code.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        blocks.append(f'<pre><code class="language-{lang}">{escaped}</code></pre>')
        return f"%%BLOCK_{idx}%%"

    html = re.sub(r"```(\w*)\n([\s\S]*?)```", save_block, text)

    # Escape HTML
    html = html.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    # Restore blocks
    for i, b in enumerate(blocks):
        html = html.replace(f"%%BLOCK_{i}%%", b)

    # Headers
    for i in range(6, 0, -1):
        html = re.sub(rf"^{'#' * i}\s+(.+)$", rf"<h{i}>\1</h{i}>", html, flags=re.MULTILINE)

    # HR
    html = re.sub(r"^---$", "<hr />", html, flags=re.MULTILINE)

    # Bold/italic
    html = re.sub(r"\*\*\*(.+?)\*\*\*", r"<strong><em>\1</em></strong>", html)
    html = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html)
    html = re.sub(r"\*(.+?)\*", r"<em>\1</em>", html)

    # Inline code
    html = re.sub(r"`([^`]+)`", r"<code>\1</code>", html)

    # Wikilinks
    html = re.sub(r"\[\[([^\]|]+?)\|([^\]]+?)\]\]", r'<a href="\1.html">\2</a>', html)
    html = re.sub(r"\[\[([^\]|]+?)\]\]", r'<a href="\1.html">\1</a>', html)

    # Images
    html = re.sub(
        r"!\[([^\]]*)\]\(([^)]+)\)",
        lambda m: f'<img src="{_sanitize_url(m.group(2))}" alt="{m.group(1)}" />',
        html,
    )

    # Links
    html = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: f'<a href="{_sanitize_url(m.group(2))}">{m.group(1)}</a>',
        html,
    )

    # Blockquotes
    html = re.sub(r"^&gt;\s+(.+)$", r"<blockquote>\1</blockquote>", html, flags=re.MULTILINE)

    # Unordered lists
    html = re.sub(r"^[-*]\s+(.+)$", r"<li>\1</li>", html, flags=re.MULTILINE)
    html = re.sub(r"(<li>.*?</li>\n?)+", lambda m: f"<ul>{m.group(0)}</ul>", html)

    # Ordered lists
    html = re.sub(r"^\d+\.\s+(.+)$", r"<li>\1</li>", html, flags=re.MULTILINE)

    # Tables (simple)
    def parse_table(m):
        lines = m.group(0).strip().split("\n")
        if len(lines) < 2:
            return m.group(0)
        header_cells = [c.strip() for c in lines[0].strip("|").split("|")]
        out = "<table><thead><tr>" + "".join(f"<th>{c}</th>" for c in header_cells) + "</tr></thead><tbody>"
        for line in lines[2:]:
            cells = [c.strip() for c in line.strip("|").split("|")]
            out += "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"
        out += "</tbody></table>"
        return out

    html = re.sub(r"(\|.+\|\n)+", parse_table, html)

    # Callouts — run after inline transforms so the body already has <strong>,
    # <em>, wikilinks etc., but before paragraph wrapping so the `:::` markers
    # haven't been swallowed into <p> blocks. Non-recursive: the body is taken
    # verbatim, which avoids the double HTML-escape bug of the earlier design.
    html = re.sub(
        r":::[ \t]*(info|warning|tip|danger)\s*\n([\s\S]*?):::",
        lambda m: f'<div class="callout callout-{m.group(1)}">{m.group(2).strip()}</div>',
        html,
    )

    # Paragraphs
    html = re.sub(r"^(?!<[a-z/])((?!\s*$).+)$", r"<p>\1</p>", html, flags=re.MULTILINE)

    return html


@router.get("/page/{slug}")
async def export_page(
    slug: str,
    format: str = Query("html", pattern="^(html|pdf)$"),
    user=Depends(get_current_user),
):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, slug, title, content_md FROM pages WHERE slug = ? AND deleted_at IS NULL",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")

    page = dict(rows[0])
    if await resolve_page_permission(db, user, page["id"]) == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    html_content = md_to_simple_html(page["content_md"])
    full_html = HTML_TEMPLATE.format(
        title=page["title"],
        slug=page["slug"],
        content=html_content,
    )

    if format == "pdf":
        # Return HTML with print-friendly styling — browser can use Ctrl+P
        pdf_html = full_html.replace("</style>", """
  @media print {
    body { margin: 0; max-width: 100%; }
    @page { margin: 1.5cm; }
  }
</style>""")
        return HTMLResponse(content=pdf_html, headers={
            "Content-Disposition": f'inline; filename="{slug}.html"',
        })

    return HTMLResponse(content=full_html, headers={
        "Content-Disposition": f'attachment; filename="{slug}.html"',
    })


@router.get("/site")
async def export_site(
    format: str = Query("html"),
    user=Depends(require_admin),
):
    """Export all pages as a static HTML site in a .zip file.

    Admin-only because partial exports (containing only the caller's
    readable pages) would be confusing and silently omit content.
    """
    db = await get_db()
    pages = await db.execute_fetchall(
        "SELECT id, slug, title, content_md FROM pages WHERE deleted_at IS NULL ORDER BY title"
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Generate page files
        page_links = []
        for p in pages:
            page = dict(p)
            html_content = md_to_simple_html(page["content_md"])
            full_html = HTML_TEMPLATE.format(
                title=page["title"],
                slug=page["slug"],
                content=html_content,
            )
            zf.writestr(f"{page['slug']}.html", full_html)
            page_links.append(f'<li><a href="{page["slug"]}.html">{page["title"]}</a></li>')

        # Generate index
        index_html = SITE_INDEX_TEMPLATE.format(page_list="\n".join(page_links))
        zf.writestr("index.html", index_html)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=just-wiki-site.zip"},
    )
