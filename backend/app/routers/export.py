import asyncio
import base64
import html as _html
import io
import mimetypes
import re
import urllib.parse
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from markdown_it import MarkdownIt
from markdown_it.rules_inline import StateInline
from mdit_py_plugins.container import container_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.services.acl import PageAccess, page_dep


# Matches `src="/api/media/<name>"` (optionally with a scheme+host prefix or
# query/fragment). Only attribute-form srcs — URLs in user text aren't rewritten.
_MEDIA_SRC_PATTERN = re.compile(
    r'(?P<prefix>src=")'
    r'(?:https?://[^/"]+)?'
    r'/api/media/'
    r'(?P<filename>[^"?#]+)'
    r'(?:[?#][^"]*)?"'
)


def _inline_media_srcs(html: str) -> str:
    """Rewrite ``/api/media/<file>`` image srcs into ``data:`` URIs.

    Without this, downloaded HTML opened via ``file://`` and print-dialog
    PDFs saved from the browser can't resolve the media URLs, so embedded
    images silently disappear from the export. Inlining keeps the artifact
    self-contained.
    """
    media_dir = Path(settings.MEDIA_DIR).resolve()

    def _replace(match: re.Match) -> str:
        filename = match.group("filename")
        try:
            filepath = (media_dir / filename).resolve()
            if not filepath.is_relative_to(media_dir) or not filepath.is_file():
                return match.group(0)
            data = filepath.read_bytes()
        except OSError:
            return match.group(0)
        mime = mimetypes.guess_type(str(filepath))[0] or "application/octet-stream"
        b64 = base64.b64encode(data).decode("ascii")
        return f'{match.group("prefix")}data:{mime};base64,{b64}"'

    return _MEDIA_SRC_PATTERN.sub(_replace, html)

router = APIRouter(prefix="/api/export", tags=["export"])

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang TC', 'Noto Sans CJK TC', sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1.25rem; color: #1e293b; line-height: 1.7; background: #ffffff; }}
  h1, h2, h3, h4, h5, h6 {{ margin: 1.4em 0 0.6em; font-weight: 600; line-height: 1.3; }}
  h1 {{ font-size: 2em; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; }}
  h2 {{ font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }}
  h3 {{ font-size: 1.25em; }}
  p {{ margin: 0.5em 0; }}
  ul, ol {{ padding-left: 1.6em; margin: 0.5em 0; }}
  li {{ margin: 0.25em 0; }}
  li.task-list-item {{ list-style: none; }}
  pre {{ background: #1e293b; color: #e2e8f0; padding: 1em; border-radius: 8px; overflow-x: auto; font-size: 0.9em; }}
  code {{ background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; font-family: 'SF Mono', Menlo, Consolas, monospace; }}
  pre code {{ background: none; padding: 0; color: inherit; font-size: 1em; }}
  blockquote {{ border-left: 4px solid #e2e8f0; padding-left: 1em; color: #64748b; margin: 0.75em 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 0.75em 0; }}
  th, td {{ border: 1px solid #e2e8f0; padding: 0.5em 0.75em; text-align: left; }}
  th {{ background: #f8fafc; font-weight: 600; }}
  img {{ max-width: 100%; border-radius: 6px; display: block; margin: 0.5em 0; }}
  a {{ color: #2563eb; text-decoration: underline; }}
  a.wikilink {{ color: #2563eb; text-decoration: none; border-bottom: 1px dashed #93c5fd; }}
  hr {{ border: none; border-top: 2px solid #e2e8f0; margin: 1.5em 0; }}
  .callout {{ border: 1px solid; border-left-width: 4px; border-radius: 6px; padding: 0.75em 1em; margin: 1em 0; }}
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


def _wikilink_rule(state: StateInline, silent: bool) -> bool:
    """Inline rule for ``[[slug]]``, ``[[slug|display]]`` and ``![[slug]]``.

    Mirrors ``wikilinkRule`` in ``frontend/src/lib/markdown.js``. Transclusion
    can't be resolved in a static file, so ``![[slug]]`` exports as a link.
    """
    src, start = state.src, state.pos
    if src.startswith("![[", start):
        open_len = 3
    elif src.startswith("[[", start):
        open_len = 2
    else:
        return False
    close = src.find("]]", start + open_len)
    if close == -1:
        return False
    inside = src[start + open_len:close]
    if not inside or "\n" in inside:
        return False
    if not silent:
        slug, sep, display = inside.partition("|")
        token = state.push("wikilink", "", 0)
        token.meta = {"slug": slug.strip(), "display": (display if sep else slug).strip()}
    state.pos = close + 2
    return True


def _render_wikilink(self, tokens, idx, options, env) -> str:
    meta = tokens[idx].meta
    # Same href form as the site index, so links resolve inside the zip.
    href = _html.escape(urllib.parse.quote(meta["slug"], safe=""))
    return f'<a href="{href}.html" class="wikilink">{_html.escape(meta["display"])}</a>'


def _render_callout(self, tokens, idx, options, env) -> str:
    if tokens[idx].nesting == 1:
        # Only the validated first word — `info` holds the rest of the
        # `:::` line verbatim, which is user text.
        kind = tokens[idx].info.split(maxsplit=1)[0]
        return f'<div class="callout callout-{kind}">\n'
    return "</div>\n"


def _build_markdown() -> MarkdownIt:
    # Same base as the web viewer (lib/markdown.js): CommonMark + GFM tables,
    # strikethrough, task lists, linkify, raw HTML off. markdown-it's link
    # validation already drops javascript:/vbscript:/data: URLs.
    md = (
        MarkdownIt("commonmark", {"html": False, "linkify": True})
        .enable(["table", "strikethrough", "linkify"])
        .use(tasklists_plugin)
    )
    for kind in ("info", "warning", "tip", "danger"):
        md.use(container_plugin, name=kind, render=_render_callout)
    md.inline.ruler.before("link", "wikilink", _wikilink_rule)
    md.add_render_rule("wikilink", _render_wikilink)
    return md


_md = _build_markdown()


def md_to_simple_html(text):
    """Render page markdown to HTML for export (no JS deps)."""
    return _md.render(text or "")


@router.get("/page/{slug}")
async def export_page(slug: str, ctx: PageAccess = Depends(page_dep("read"))):
    page = ctx.page
    # Render + inline media in a thread: _inline_media_srcs reads files
    # synchronously and md_to_simple_html does CPU work. Pages with many
    # embedded images would otherwise stall the event loop.
    html_content = await asyncio.to_thread(
        lambda: _inline_media_srcs(md_to_simple_html(page["content_md"]))
    )
    # Escape title/slug: they're rendered into <title>, <h1>, and a meta
    # breadcrumb as raw text, so a page title containing e.g. `<script>` would
    # execute when the exported HTML is opened locally (file:// context).
    full_html = HTML_TEMPLATE.format(
        title=_html.escape(page["title"]),
        slug=_html.escape(page["slug"]),
        content=html_content,
    )

    return HTMLResponse(content=full_html, headers={
        "Content-Disposition": f'attachment; filename="{slug}.html"',
    })


def build_site_files(pages):
    """Render pages into ``[(filename, html), ...]`` for a static export.

    Shared by the HTTP zip endpoint and the CLI demo-site builder so both
    paths produce byte-identical output.
    """
    files = []
    page_links = []
    for p in pages:
        page = dict(p)
        html_content = _inline_media_srcs(md_to_simple_html(page["content_md"]))
        safe_title = _html.escape(page["title"])
        safe_slug = _html.escape(page["slug"])
        full_html = HTML_TEMPLATE.format(
            title=safe_title,
            slug=safe_slug,
            content=html_content,
        )
        files.append((f"{page['slug']}.html", full_html))
        # Both href and link text need escaping — slug may contain chars
        # that break the attribute, title may contain HTML.
        page_links.append(
            f'<li><a href="{urllib.parse.quote(page["slug"], safe="")}.html">'
            f'{safe_title}</a></li>'
        )

    index_html = SITE_INDEX_TEMPLATE.format(page_list="\n".join(page_links))
    files.append(("index.html", index_html))
    return files


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

    # File reads (_inline_media_srcs), HTML rendering, and zip compression
    # are all blocking; do the whole bundle off the event loop.
    def _build_zip() -> io.BytesIO:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename, content in build_site_files(pages):
                zf.writestr(filename, content)
        out.seek(0)
        return out

    buf = await asyncio.to_thread(_build_zip)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=just-wiki-site.zip"},
    )
