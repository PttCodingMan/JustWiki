"""Convert a folder of Markdown files into JustWiki pages.

Covers the sources whose export *is* plain Markdown on disk:

  * ``markdown`` — any folder of ``.md`` files (GitHub wiki, MkDocs,
    Docusaurus, GitBook, a plain notes folder, …)
  * ``obsidian`` — an Obsidian vault (auto-detected via ``.obsidian/``)
  * ``hackmd``   — HackMD / HedgeDoc notes (a single ``.md`` or a zip of them)

This module is pure: it reads an :class:`ImportSource`, plans the page tree,
rewrites links/embeds into JustWiki syntax and returns the pages and media to
create. It never touches the database or disk, so the router owns the
transaction and the tests can run it directly.

JustWiki-specific constraints the conversion has to respect:

  * ``[[x]]`` means *slug* x, and slugs are random — so every wikilink and
    relative ``.md`` link is resolved to a page in the batch and rewritten to
    ``[[slug|text]]``. Unresolvable links become plain text (and a warning)
    rather than links to a slug that doesn't exist.
  * ``![[x]]`` is page transclusion, not an image — Obsidian image embeds are
    rewritten to ``![alt](/api/media/…)``.
  * Raw HTML is escaped by the viewer (markdown-it ``html: false``), so
    ``<img>`` tags are rewritten to Markdown images.
  * Callouts are ``:::info|tip|warning|danger`` with no custom title, so a
    title becomes a bold first line.
"""
from __future__ import annotations

import io
import json
import posixpath
import re
import unicodedata
import uuid
import zipfile
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import unquote

FLAVORS = ("markdown", "obsidian", "hackmd")

DOC_EXTS = (".md", ".markdown")

# Attachment extension → (MIME, stored extension). Must stay a subset of the
# media router's ALLOWED_TYPES (asserted in tests) — imports may not smuggle
# in types a normal upload would refuse.
ASSET_TYPES: dict[str, tuple[str, str]] = {
    ".png": ("image/png", ".png"),
    ".jpg": ("image/jpeg", ".jpg"),
    ".jpeg": ("image/jpeg", ".jpg"),
    ".gif": ("image/gif", ".gif"),
    ".webp": ("image/webp", ".webp"),
    ".svg": ("image/svg+xml", ".svg"),
    ".pdf": ("application/pdf", ".pdf"),
    ".txt": ("text/plain", ".txt"),
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}

# Path components that are never content: VCS/OS metadata, Obsidian's
# config + trash, dependency folders.
_SKIP_DIRS = {"__MACOSX", "node_modules"}

# Archive guards. The upload itself is capped by the router; these stop a
# small zip from expanding into something huge (zip bomb) or listing an
# absurd number of entries.
MAX_ENTRIES = 20_000
MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024  # 1 GiB
MAX_DOC_BYTES = 10 * 1024 * 1024
MAX_WARNINGS = 300


class ImportFailed(ValueError):
    """The upload can't be imported at all (bad archive, nothing to import)."""


# ── Source archive ──────────────────────────────────────────────────────────


class ImportSource:
    """Read-only view over the uploaded files, keyed by POSIX relative path.

    Wraps either a zip archive or a single Markdown file. Reads are lazy so
    attachments nobody links to are never decompressed.
    """

    def __init__(
        self,
        entries: dict[str, Callable[[int], bytes]],
        has_obsidian_dir: bool,
        obsidian_config: dict | None = None,
    ):
        self._entries = entries
        self.has_obsidian_dir = has_obsidian_dir
        self.obsidian_config = obsidian_config or {}
        self._read_total = 0

    @property
    def paths(self) -> list[str]:
        return list(self._entries)

    def read(self, path: str, limit: int) -> bytes | None:
        """Return the file's bytes, or None if it exceeds ``limit``."""
        data = self._entries[path](limit + 1)
        if len(data) > limit:
            return None
        self._read_total += len(data)
        if self._read_total > MAX_TOTAL_UNCOMPRESSED:
            raise ImportFailed("Archive expands to more than 1 GiB")
        return data

    @classmethod
    def from_upload(cls, filename: str, content: bytes) -> "ImportSource":
        name = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        lower = name.lower()
        if lower.endswith(".zip"):
            return cls._from_zip(content)
        if lower.endswith(DOC_EXTS):
            return cls({name: lambda limit: content[:limit]}, has_obsidian_dir=False)
        raise ImportFailed("Upload a .zip archive or a single .md file")

    @classmethod
    def _from_zip(cls, content: bytes) -> "ImportSource":
        try:
            zf = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            raise ImportFailed("Invalid zip file")
        infos = [i for i in zf.infolist() if not i.is_dir()]
        if len(infos) > MAX_ENTRIES:
            raise ImportFailed(f"Archive has more than {MAX_ENTRIES} files")

        raw: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            name = info.filename
            if not info.flag_bits & 0x800:
                # No UTF-8 flag: zipfile decoded the name as cp437. Many
                # tools write UTF-8 without setting the flag — try that.
                try:
                    name = name.encode("cp437").decode("utf-8")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            path = _clean_path(name)
            if path:
                raw[path] = info

        # A zip of a folder wraps everything in one top-level directory —
        # strip it so the vault's own folders become the top-level pages.
        tops = {p.split("/", 1)[0] for p in raw}
        if len(tops) == 1 and all("/" in p for p in raw):
            prefix = next(iter(tops)) + "/"
            raw = {p[len(prefix):]: i for p, i in raw.items()}

        has_obsidian = any(p.startswith(".obsidian/") for p in raw)
        obsidian_config: dict = {}
        app_json = raw.get(".obsidian/app.json")
        if app_json is not None and app_json.file_size <= 1024 * 1024:
            try:
                loaded = json.loads(zf.read(app_json))
                if isinstance(loaded, dict):
                    obsidian_config = loaded
            except (ValueError, UnicodeDecodeError):
                pass

        def reader(info: zipfile.ZipInfo) -> Callable[[int], bytes]:
            def read(limit: int) -> bytes:
                with zf.open(info) as fh:
                    return fh.read(limit)
            return read

        entries = {
            p: reader(i) for p, i in raw.items()
            if not any(part.startswith(".") or part in _SKIP_DIRS for part in p.split("/"))
        }
        return cls(entries, has_obsidian_dir=has_obsidian, obsidian_config=obsidian_config)


def _clean_path(name: str) -> str | None:
    """Normalise a zip member name; None for anything unsafe or empty.

    NFC because macOS archives store names decomposed (NFD) while the links
    inside notes are composed — Hangul / kana with dakuten would otherwise
    never resolve.
    """
    name = unicodedata.normalize("NFC", name).replace("\\", "/")
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or ".." in parts:
        return None
    return "/".join(parts)


# ── Result types ────────────────────────────────────────────────────────────


@dataclass
class PlannedPage:
    key: str
    slug: str
    title: str
    parent_key: str | None
    sort_order: int
    source_path: str | None
    content_md: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class PlannedMedia:
    filename: str
    original_name: str
    mime_type: str
    data: bytes


@dataclass
class ImportResult:
    flavor: str
    pages: list[PlannedPage]  # parents before children
    media: list[PlannedMedia]
    warnings: list[dict]
    warnings_truncated: int = 0


# ── Frontmatter ─────────────────────────────────────────────────────────────

_YAML_LINE_RE = re.compile(r"^(?:[^\s:#-][^:]*:(?:[ \t]|$)|[ \t]+\S|-(?:[ \t]|$)|#)")
_FRONTMATTER_RE = re.compile(r"\A---[ \t]*\n(.*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|\Z)", re.S)

# Keys the importer consumes (or that are pure rendering hints in the source
# tool). Anything else is user data and is preserved as a YAML block.
_CONSUMED_FM_KEYS = {
    "title", "tags", "tag", "aliases", "alias", "cssclasses", "cssclass",
    "lang", "breaks", "robots", "dir", "GA", "disqus", "type", "slideOptions",
}


def _unquote_scalar(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def _parse_frontmatter(text: str) -> tuple[dict, str | None, str]:
    """Minimal YAML subset: top-level ``key: scalar``, ``key: [a, b]`` and
    ``key:`` followed by ``- item`` lines. Returns (data, raw_yaml, body).
    Nested structures are kept only in raw_yaml.
    """
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, None, text
    raw = m.group(1) or ""
    # A note may simply open with a `---` rule; only treat the block as
    # frontmatter when every line looks like YAML, or its text would be lost.
    if not all(_YAML_LINE_RE.match(line) for line in raw.split("\n") if line.strip()):
        return {}, None, text
    data: dict[str, object] = {}
    current: str | None = None
    for line in raw.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0] not in " \t-":
            key, sep, value = line.partition(":")
            if not sep:
                current = None
                continue
            current = key.strip()
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                data[current] = [_unquote_scalar(x) for x in value[1:-1].split(",") if x.strip()]
            elif value:
                data[current] = _unquote_scalar(value)
            else:
                data[current] = []
        elif current is not None and line.lstrip().startswith("- "):
            existing = data.get(current)
            if isinstance(existing, list):
                existing.append(_unquote_scalar(line.lstrip()[2:]))
    return data, raw, text[m.end():]


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [v for v in (x.strip() for x in re.split(r"[,\s]+", value)) if v]
    return [str(v).strip() for v in value if str(v).strip()]


def _norm_tags(values) -> list[str]:
    out: list[str] = []
    for v in values:
        v = v.strip().lstrip("#").strip()
        if v and len(v) <= 100 and v not in out:
            out.append(v)
    return out


# ── Code-aware text splitting ───────────────────────────────────────────────

_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_INLINE_CODE_RE = re.compile(r"(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.S)


def _split_code_blocks(text: str) -> list[tuple[bool, str]]:
    """Split into (is_code, chunk) runs. Fenced code and ``$$`` math blocks
    are code; transformations only touch prose chunks."""
    chunks: list[tuple[bool, list[str]]] = []
    fence: str | None = None
    in_math = False
    for line in text.split("\n"):
        stripped = line.strip()
        if fence is not None:
            chunks[-1][1].append(line)
            m = _FENCE_RE.match(line)
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not line[m.end():].strip():
                fence = None
            continue
        if in_math:
            chunks[-1][1].append(line)
            if stripped == "$$":
                in_math = False
            continue
        m = _FENCE_RE.match(line)
        opens_math = stripped == "$$"
        if m or opens_math:
            chunks.append((True, [line]))
            if m:
                fence = m.group(1)
            else:
                in_math = True
            continue
        if not chunks or chunks[-1][0]:
            chunks.append((False, [line]))
        else:
            chunks[-1][1].append(line)
    return [(is_code, "\n".join(lines)) for is_code, lines in chunks]


_ATX_H1_RE = re.compile(r"^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$", re.M)


def _first_h1(text: str) -> tuple[str, int, int] | None:
    """(title, start, end) of the first ATX H1 outside code, or None."""
    offset = 0
    for is_code, chunk in _split_code_blocks(text):
        if not is_code:
            m = _ATX_H1_RE.search(chunk)
            if m:
                return m.group(1).strip(), offset + m.start(), offset + m.end()
        offset += len(chunk) + 1
    return None


def _protect_inline_code(text: str) -> tuple[str, list[str]]:
    saved: list[str] = []

    def stash(m: re.Match) -> str:
        saved.append(m.group(0))
        return f"\x00{len(saved) - 1}\x00"

    return _INLINE_CODE_RE.sub(stash, text), saved


def _restore_inline_code(text: str, saved: list[str]) -> str:
    return re.sub(r"\x00(\d+)\x00", lambda m: saved[int(m.group(1))], text)


# ── Callouts / admonitions ──────────────────────────────────────────────────

_CALLOUT_KIND = {
    **dict.fromkeys(
        ["note", "info", "abstract", "summary", "tldr", "todo", "question",
         "help", "faq", "quote", "cite", "example", "spoiler"], "info"),
    **dict.fromkeys(["tip", "hint", "important", "success", "check", "done"], "tip"),
    **dict.fromkeys(["warning", "caution", "attention"], "warning"),
    **dict.fromkeys(["danger", "error", "bug", "failure", "fail", "missing"], "danger"),
}

_QUOTE_CALLOUT_RE = re.compile(r"^( {0,3})>[ \t]?\[!([A-Za-z][\w-]*)\][+-]?[ \t]*(.*)$")
_QUOTE_LINE_RE = re.compile(r"^ {0,3}>[ \t]?")
_CONTAINER_OPEN_RE = re.compile(r"^( {0,3})(:{3,})[ \t]*([A-Za-z][\w-]*)[ \t]*(.*)$")


_CONTAINER_CLOSE_RE = re.compile(r"^ {0,3}:{3,}[ \t]*$")


def _convert_callouts(text: str) -> str:
    """Obsidian / GitHub ``> [!type] Title`` blockquotes and HackMD /
    Docusaurus ``:::type Title`` containers → JustWiki ``:::kind``.

    Runs over the whole document (code chunks are passed through), so a
    container can span a fenced block. Markers are emitted as their own
    paragraphs — the same shape the editor's slash command inserts — so the
    Milkdown round-trip keeps them on separate lines.
    """
    out: list[str] = []
    depth = 0  # open ``:::`` containers

    def blank_before() -> None:
        if out and out[-1].strip():
            out.append("")

    for is_code, chunk in _split_code_blocks(text):
        if is_code:
            out.extend(chunk.split("\n"))
            continue
        lines = chunk.split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            m = _QUOTE_CALLOUT_RE.match(line)
            if m:
                indent, kind, title = m.group(1), m.group(2).lower(), m.group(3).strip()
                body: list[str] = []
                i += 1
                while i < len(lines) and _QUOTE_LINE_RE.match(lines[i]):
                    body.append(_QUOTE_LINE_RE.sub("", lines[i], count=1))
                    i += 1
                while body and not body[-1].strip():
                    body.pop()
                blank_before()
                out.extend([f"{indent}:::{_CALLOUT_KIND.get(kind, 'info')}", ""])
                if title:
                    out.extend([f"{indent}**{title}**", ""])
                out.extend(f"{indent}{b}" if b else b for b in body)
                blank_before()
                out.append(f"{indent}:::")
                if i < len(lines) and lines[i].strip():
                    out.append("")
                continue
            m = _CONTAINER_OPEN_RE.match(line)
            if m:
                indent, colons, kind, title = m.groups()
                kind = _CALLOUT_KIND.get(kind.lower(), kind)
                depth += 1
                blank_before()
                out.extend([f"{indent}{colons}{kind}", ""])
                if title.strip():
                    out.extend([f"{indent}**{title.strip()}**", ""])
                i += 1
                while i < len(lines) and not lines[i].strip():
                    i += 1
                continue
            if depth and _CONTAINER_CLOSE_RE.match(line):
                depth -= 1
                blank_before()
                out.append(line)
                if i + 1 < len(lines) and lines[i + 1].strip():
                    out.append("")
                i += 1
                continue
            out.append(line)
            i += 1
    return "\n".join(out)


# A line that starts a new block — a soft break before it is not a line
# break inside a paragraph.
_BLOCK_START_RE = re.compile(
    r"^(?: {0,3}(?:#{1,6}(?:[ \t]|$)|>|\||:{3,}|\$\$|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|=+[ \t]*$)"
    r"|[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$))"
)
_QUOTE_PREFIX_RE = re.compile(r"^ {0,3}>[ \t]?")


def _soft_breaks_to_hard(chunk: str) -> str:
    """Obsidian (default) and HackMD render a single newline as a line break;
    CommonMark joins the lines. Add the canonical two-space hard break so the
    text keeps its shape. Only between two lines of the same paragraph."""
    lines = chunk.split("\n")
    for i in range(len(lines) - 1):
        cur, nxt = lines[i], lines[i + 1]
        cq, nq = _QUOTE_PREFIX_RE.match(cur), _QUOTE_PREFIX_RE.match(nxt)
        if bool(cq) != bool(nq):
            continue
        if cq:  # both quote lines: compare the quoted content
            cur, nxt = cur[cq.end():], nxt[nq.end():]
        if not cur.strip() or not nxt.strip():
            continue
        if _BLOCK_START_RE.match(nxt) or re.match(r"^ {0,3}(?:#{1,6}(?:[ \t]|$)|\||:{3,}|\$\$)", cur):
            continue
        if cur.endswith(("  ", "\\")) or re.search(r"<br\s*/?>$", cur, re.I):
            continue
        lines[i] = lines[i].rstrip(" \t") + "  "
    return "\n".join(lines)


# ── HackMD specifics ────────────────────────────────────────────────────────

_HACKMD_TAGS_LINE_RE = re.compile(r"^#{6}[ \t]+tags:[ \t]*(.*)$", re.M | re.I)
_HACKMD_TOC_RE = re.compile(r"^[ \t]*\[toc\][ \t]*$\n?", re.M | re.I)
_HACKMD_EMBED_RE = re.compile(
    r"\{%[ \t]*(youtube|vimeo|gist|slideshare|speakerdeck|pdf|figma)[ \t]+(\S+?)[ \t]*%\}",
    re.I,
)
_HACKMD_EMBED_URL = {
    "youtube": "https://www.youtube.com/watch?v={}",
    "vimeo": "https://vimeo.com/{}",
    "gist": "https://gist.github.com/{}",
    "slideshare": "https://www.slideshare.net/{}",
    "speakerdeck": "https://speakerdeck.com/player/{}",
}


def _hackmd_tags(text: str) -> tuple[list[str], str]:
    tags: list[str] = []

    def take(m: re.Match) -> str:
        found = re.findall(r"`([^`]+)`", m.group(1)) or _as_list(m.group(1))
        tags.extend(found)
        return ""

    return tags, _HACKMD_TAGS_LINE_RE.sub(take, text)


def _hackmd_embeds(text: str) -> str:
    def repl(m: re.Match) -> str:
        kind, arg = m.group(1).lower(), m.group(2)
        if kind in _HACKMD_EMBED_URL and not arg.startswith("http"):
            url = _HACKMD_EMBED_URL[kind].format(arg)
        else:
            url = arg
        return f"[{kind.capitalize()}: {url}]({url})"

    return _HACKMD_EMBED_RE.sub(repl, _HACKMD_TOC_RE.sub("", text))


# ── Obsidian specifics ──────────────────────────────────────────────────────

_OBSIDIAN_COMMENT_RE = re.compile(r"%%.*?%%", re.S)
_BLOCK_ID_RE = re.compile(r"[ \t]+\^[A-Za-z0-9-]+[ \t]*$", re.M)
# Obsidian tags: start of line or after whitespace, must contain at least one
# non-digit. Headings (`# x`) don't match because `#` is followed by a space.
_INLINE_TAG_RE = re.compile(r"(?:^|(?<=\s))#([\w/-]*[^\W\d][\w/-]*)", re.M)


# ── Link rewriting ──────────────────────────────────────────────────────────

_WIKILINK_RE = re.compile(r"(!?)\[\[([^\[\]\n]+?)\]\]")
_MD_LINK_RE = re.compile(
    r"(!?)\[((?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])*)\]"
    r"\([ \t]*(<[^<>\n]*>|(?:\\.|[^\s()\\]|\((?:\\.|[^\s()\\])*\))*)"
    r"((?:[ \t]+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^()\n]*\)))?)[ \t]*\)"
)
_REF_DEF_RE = re.compile(r"^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^<>\n]*>|\S+)(.*)$", re.M)
_HTML_IMG_RE = re.compile(r"<img\b[^>]*>", re.I)
_HTML_ATTR_RE = re.compile(r"""\b(src|alt|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)
# The viewer escapes raw HTML (markdown-it `html: false`), so common tags are
# translated and pure layout wrappers dropped; anything else stays (shown as
# text) and is reported.
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_HTML_A_RE = re.compile(r"<a\b([^>]*)>(.*?)</a\s*>", re.I | re.S)
_HTML_INLINE = [
    (re.compile(r"<(strong|b)\b[^>]*>(.*?)</\1\s*>", re.I | re.S), r"**\2**"),
    (re.compile(r"<(em|i)\b[^>]*>(.*?)</\1\s*>", re.I | re.S), r"*\2*"),
    (re.compile(r"<(s|del|strike)\b[^>]*>(.*?)</\1\s*>", re.I | re.S), r"~~\2~~"),
    (re.compile(r"<(code|kbd|samp|tt)\b[^>]*>([^`<]*?)</\1\s*>", re.I), r"`\2`"),
    (re.compile(r"<summary\b[^>]*>(.*?)</summary\s*>", re.I | re.S), r"**\1**"),
    (re.compile(r"^([ \t]*)<hr\b[^>]*>[ \t]*$", re.I | re.M), r"\1---"),
]
_HTML_WRAPPER_RE = re.compile(
    r"</?(?:p|div|span|center|section|article|header|footer|main|nav|aside|figure|figcaption"
    r"|picture|source|small|big|font|u|ins|mark|sub|sup|abbr|details|summary)\b[^<>]*>",
    re.I,
)
_HTML_TAG_RE = re.compile(r"</?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?/?>")
_HTML_BLOCK_START_RE = re.compile(r"^ {0,3}<(?:/?[A-Za-z]|!--)")
_EXTERNAL_RE = re.compile(r"^(?:[A-Za-z][A-Za-z0-9+.-]*:|//|/|#)")


def _natural_key(s: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s.casefold())]


def _strip_doc_ext(path: str) -> str:
    lower = path.lower()
    for ext in DOC_EXTS:
        if lower.endswith(ext):
            return path[: -len(ext)]
    return path


def _is_index_name(path: str) -> bool:
    """index.md / README.md / README.zh-TW.md — names that say nothing."""
    stem = posixpath.basename(_strip_doc_ext(path)).lower()
    return stem.split(".", 1)[0] in ("index", "readme")


def _ext(path: str) -> str:
    return posixpath.splitext(path)[1].lower()


def _safe_label(text: str) -> str:
    """Make text safe inside ``[[slug|text]]`` (no ``]]`` or newlines)."""
    return re.sub(r"\s*\n\s*", " ", text).replace("]]", "] ]").strip()


@dataclass
class _Doc:
    path: str
    text: str = ""
    title: str = ""
    tags: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    frontmatter_raw: str | None = None
    breaks: bool | None = None  # frontmatter `breaks:` override


class _Converter:
    def __init__(
        self,
        source: ImportSource,
        flavor: str,
        new_slug: Callable[[], str],
        max_asset_bytes: int,
    ):
        self.source = source
        self.flavor = flavor
        self.new_slug = new_slug
        self.max_asset_bytes = max_asset_bytes
        self.warnings: list[dict] = []
        self.warnings_truncated = 0
        # Obsidian (unless "Strict line breaks" is on) and HackMD render a
        # single newline as a line break; plain Markdown follows CommonMark.
        self.soft_breaks = (
            (flavor == "obsidian" and not source.obsidian_config.get("strictLineBreaks"))
            or flavor == "hackmd"
        )

        self.docs: dict[str, _Doc] = {}
        self.asset_paths: dict[str, str] = {}  # lower path → real path
        self.asset_by_name: dict[str, list[str]] = {}
        for path in source.paths:
            ext = _ext(path)
            if ext in DOC_EXTS:
                self.docs[path] = _Doc(path)
            else:
                self.asset_paths[path.lower()] = path
                self.asset_by_name.setdefault(posixpath.basename(path).lower(), []).append(path)

        # Filled during planning.
        self.pages: dict[str, PlannedPage] = {}
        self.doc_page: dict[str, str] = {}  # doc path → page key
        self.title_by_slug: dict[str, str] = {}
        self.folder_pages: dict[str, str] = {}  # lower folder path → page key
        self.doc_by_noext: dict[str, str] = {}
        self.doc_by_stem: dict[str, list[str]] = {}
        self.doc_by_alias: dict[str, list[str]] = {}
        self.media: dict[str, PlannedMedia | None] = {}  # asset path → media (None = rejected)
        self.media_order: list[PlannedMedia] = []

    # ── warnings ──
    def warn(self, path: str | None, message: str) -> None:
        if len(self.warnings) >= MAX_WARNINGS:
            self.warnings_truncated += 1
            return
        self.warnings.append({"file": path, "message": message})

    # ── reading + metadata ──
    def load_docs(self) -> None:
        for path in list(self.docs):
            data = self.source.read(path, MAX_DOC_BYTES)
            if data is None:
                self.warn(path, "Skipped: file is larger than 10 MB")
                del self.docs[path]
                continue
            if data.startswith(b"\xef\xbb\xbf"):
                data = data[3:]
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = data.decode("utf-8", errors="replace")
                self.warn(path, "Not valid UTF-8; undecodable bytes were replaced")
            doc = self.docs[path]
            doc.text = text.replace("\r\n", "\n").replace("\r", "\n")
            fm, raw, body = _parse_frontmatter(doc.text)
            doc.text = body
            doc.title = str(fm.get("title") or "").strip() if isinstance(fm.get("title"), str) else ""
            doc.tags = _as_list(fm.get("tags")) + _as_list(fm.get("tag"))
            doc.aliases = _as_list(fm.get("aliases")) if isinstance(fm.get("aliases"), list) else (
                [str(fm["aliases"])] if fm.get("aliases") else [])
            if isinstance(fm.get("alias"), str):
                doc.aliases.append(fm["alias"])
            if isinstance(fm.get("breaks"), str) and fm["breaks"].lower() in ("true", "false"):
                doc.breaks = fm["breaks"].lower() == "true"
            if raw is not None and any(k not in _CONSUMED_FM_KEYS for k in fm):
                doc.frontmatter_raw = raw.rstrip("\n")
            if self.flavor == "hackmd":
                tags, doc.text = _hackmd_tags(doc.text)
                doc.tags += tags

        for path in self.docs:
            noext = _strip_doc_ext(path).lower()
            self.doc_by_noext[noext] = path
            self.doc_by_stem.setdefault(posixpath.basename(noext), []).append(path)
            for alias in self.docs[path].aliases:
                self.doc_by_alias.setdefault(alias.strip().lower(), []).append(path)

    # ── tree planning ──
    def plan_tree(self) -> None:
        folders: set[str] = set()
        for path in self.docs:
            d = posixpath.dirname(path)
            while d:
                folders.add(d)
                d = posixpath.dirname(d)

        # Folder notes: a doc that *is* the folder's page rather than a child
        # of it. Checked in priority order; a doc can only claim one folder.
        folder_note: dict[str, str] = {}
        claimed: set[str] = set()
        lower_docs = {p.lower(): p for p in self.docs}
        for folder in sorted(folders, key=lambda f: -f.count("/")):
            name = posixpath.basename(folder)
            parent = posixpath.dirname(folder)
            candidates = [f"{folder}/index", f"{folder}/readme", f"{folder}/{name}",
                          f"{parent}/{name}" if parent else name]
            for cand in candidates:
                for ext in DOC_EXTS:
                    hit = lower_docs.get(f"{cand}{ext}".lower())
                    if hit and hit not in claimed:
                        folder_note[folder] = hit
                        claimed.add(hit)
                        break
                if folder in folder_note:
                    break

        # Siblings per parent folder ("" = import root).
        children: dict[str, list[tuple[bool, str, str]]] = {}
        for folder in folders:
            children.setdefault(posixpath.dirname(folder), []).append(
                (True, posixpath.basename(folder), folder))
        for path in self.docs:
            if path in claimed:
                continue
            children.setdefault(posixpath.dirname(path), []).append(
                (False, posixpath.basename(_strip_doc_ext(path)), path))

        def visit(folder: str, parent_key: str | None) -> None:
            entries = sorted(children.get(folder, []), key=lambda e: (not e[0], _natural_key(e[1])))
            for order, (is_folder, name, ref) in enumerate(entries):
                if is_folder:
                    note = folder_note.get(ref)
                    key = f"dir:{ref}"
                    title = self._title_for(note, fallback=name, prefer_h1=note is not None and (
                        self.flavor != "obsidian" or _is_index_name(note)))
                    self._add_page(key, title, parent_key, order, note)
                    visit(ref, key)
                else:
                    title = self._title_for(ref, fallback=name,
                                            prefer_h1=self.flavor != "obsidian" or _is_index_name(ref))
                    self._add_page(f"doc:{ref}", title, parent_key, order, ref)

        visit("", None)

    def _title_for(self, doc_path: str | None, fallback: str, prefer_h1: bool) -> str:
        if doc_path is None:
            return fallback
        doc = self.docs[doc_path]
        if doc.title:
            return doc.title
        if prefer_h1:
            h1 = _first_h1(doc.text)
            if h1:
                return h1[0]
        return fallback

    def _add_page(self, key: str, title: str, parent_key: str | None, order: int, doc_path: str | None) -> None:
        self.pages[key] = PlannedPage(
            key=key, slug=self.new_slug(), title=title[:500] or "Untitled",
            parent_key=parent_key, sort_order=order, source_path=doc_path,
        )
        self.title_by_slug[self.pages[key].slug] = self.pages[key].title
        if doc_path is not None:
            self.doc_page[doc_path] = key

    # ── resolution ──
    def _pick(self, candidates: list[str], from_dir: str) -> str:
        """Obsidian's tie-break: prefer the same folder, then the shortest path."""
        return sorted(candidates, key=lambda p: (posixpath.dirname(p) != from_dir, p.count("/"), p))[0]

    def resolve_doc(self, target: str, from_dir: str) -> str | None:
        t = _strip_doc_ext(unicodedata.normalize("NFC", target).strip().strip("/")).lower()
        if not t:
            return None
        rel = posixpath.normpath(posixpath.join(from_dir.lower(), t))
        for cand in (rel, t):
            if cand in self.doc_by_noext:
                return self.doc_by_noext[cand]
        if "/" in t:
            hits = [p for k, p in self.doc_by_noext.items() if k.endswith("/" + t)]
        else:
            hits = self.doc_by_stem.get(t, [])
        if not hits and self.flavor == "obsidian":
            hits = self.doc_by_alias.get(target.strip().lower(), [])
        return self._pick(hits, from_dir) if hits else None

    def resolve_asset(self, target: str, from_dir: str) -> str | None:
        t = unicodedata.normalize("NFC", target).strip().strip("/").lower()
        if not t:
            return None
        rel = posixpath.normpath(posixpath.join(from_dir.lower(), t))
        for cand in (rel, t):
            if cand in self.asset_paths:
                return self.asset_paths[cand]
        hits = [p for p in self.asset_by_name.get(posixpath.basename(t), [])
                if "/" not in t or p.lower().endswith("/" + t)]
        return self._pick(hits, from_dir) if hits else None

    def media_url(self, asset_path: str, from_path: str) -> str | None:
        """Plan the asset as media (once) and return its URL, or None."""
        if asset_path in self.media:
            m = self.media[asset_path]
            return f"/api/media/{m.filename}" if m else None
        self.media[asset_path] = None
        ext = _ext(asset_path)
        if ext not in ASSET_TYPES:
            self.warn(from_path, f"Attachment type not supported, left as text: {asset_path}")
            return None
        mime, stored_ext = ASSET_TYPES[ext]
        data = self.source.read(asset_path, self.max_asset_bytes)
        if data is None:
            self.warn(from_path, f"Attachment exceeds the upload size limit: {asset_path}")
            return None
        from app.routers.media import check_media_content
        error = check_media_content(data, mime)
        if error:
            self.warn(from_path, f"Attachment rejected ({error}): {asset_path}")
            return None
        media = PlannedMedia(
            filename=f"{uuid.uuid4().hex}{stored_ext}",
            original_name=posixpath.basename(asset_path),
            mime_type=mime,
            data=data,
        )
        self.media[asset_path] = media
        self.media_order.append(media)
        return f"/api/media/{media.filename}"

    # ── content conversion ──
    def convert_doc(self, doc_path: str) -> str:
        doc = self.docs[doc_path]
        page = self.pages[self.doc_page[doc_path]]
        text = doc.text
        from_dir = posixpath.dirname(doc_path)

        # Drop the first H1 when it just repeats the page title (the viewer
        # already shows the title above the content).
        h1 = _first_h1(text)
        if h1 and h1[0].casefold() == page.title.strip().casefold():
            before, after = text[:h1[1]].rstrip("\n"), text[h1[2]:].lstrip("\n")
            text = f"{before}\n\n{after}" if before.strip() else after

        text = _convert_callouts(text)
        soft_breaks = self.soft_breaks and doc.breaks is not False
        parts = []
        for is_code, chunk in _split_code_blocks(text):
            if not is_code:
                chunk = self._convert_prose(chunk, doc_path, from_dir, doc)
                if soft_breaks:
                    chunk = _soft_breaks_to_hard(chunk)
                # Blank-line runs carry no meaning in Markdown; removed
                # wrappers/comments leave them behind.
                chunk = re.sub(r"\n{3,}", "\n\n", chunk)
            parts.append(chunk)
        out = "\n".join(parts).strip("\n")

        if doc.frontmatter_raw:
            out = f"```yaml\n{doc.frontmatter_raw}\n```\n\n{out}".rstrip("\n")
        return out + "\n" if out else ""

    def _convert_prose(self, chunk: str, doc_path: str, from_dir: str, doc: _Doc) -> str:
        chunk, saved = _protect_inline_code(chunk)
        if self.flavor == "obsidian":
            chunk = _OBSIDIAN_COMMENT_RE.sub("", chunk)
            chunk = _BLOCK_ID_RE.sub("", chunk)
            doc.tags += _INLINE_TAG_RE.findall(chunk)
        if self.flavor == "hackmd":
            chunk = _hackmd_embeds(chunk)
        chunk = _WIKILINK_RE.sub(lambda m: self._wikilink(m, doc_path, from_dir), chunk)
        chunk = self._convert_html(chunk, doc_path, from_dir)
        chunk = _MD_LINK_RE.sub(lambda m: self._md_link(m, doc_path, from_dir), chunk)
        chunk = _REF_DEF_RE.sub(lambda m: self._ref_def(m, doc_path, from_dir), chunk)
        return _restore_inline_code(chunk, saved)

    def _wikilink(self, m: re.Match, doc_path: str, from_dir: str) -> str:
        embed = m.group(1) == "!"
        inner = m.group(2)
        # Inside tables Obsidian escapes the alias pipe as `\|`; keep the
        # escape on output so the table cell isn't split.
        sep = "\\|" if "\\|" in inner else "|"
        target, _, alias = inner.replace("\\|", "|").partition("|")
        target, _, sub = target.partition("#")
        target, alias, sub = target.strip(), alias.strip(), sub.strip()
        label = alias or (f"{target} > {sub.lstrip('^')}" if target and sub else target or sub.lstrip("^"))

        if not target:  # same-page heading link
            return label
        if _ext(target) not in ("",) + DOC_EXTS:
            asset = self.resolve_asset(target, from_dir)
            if asset:
                url = self.media_url(asset, doc_path)
                if url:
                    name = alias if alias and not alias.isdigit() and not re.fullmatch(r"\d+x\d+", alias) \
                        else posixpath.basename(asset)
                    if embed and _ext(asset) in IMAGE_EXTS:
                        return f"![{name}]({url})"
                    return f"[{name}]({url})"
                return posixpath.basename(target)
            # Fall through: a page title may legitimately contain a dot.
        doc = self.resolve_doc(target, from_dir)
        if doc is None:
            self.warn(doc_path, f"Unresolved link, kept as text: [[{inner}]]")
            return label
        target_page = self.pages[self.doc_page[doc]]
        slug = target_page.slug
        if embed:
            return f"![[{slug}{sep}{_safe_label(target_page.title)}]]"
        return f"[[{slug}{sep}{_safe_label(label)}]]"

    def _rewrite_target(self, raw_target: str, doc_path: str, from_dir: str) -> tuple[str, str] | None:
        """Resolve a Markdown link target. Returns (kind, value) where kind is
        'page' (value=slug), 'media' (value=url) or 'broken'; None = leave."""
        t = raw_target[1:-1] if raw_target.startswith("<") and raw_target.endswith(">") else raw_target
        if not t or _EXTERNAL_RE.match(t):
            return None
        path = unquote(re.split(r"[#?]", t, maxsplit=1)[0])
        if not path:
            return None
        ext = _ext(path)
        if ext in DOC_EXTS or ext == "":
            doc = self.resolve_doc(path, from_dir)
            if doc:
                return "page", self.pages[self.doc_page[doc]].slug
            if ext in DOC_EXTS:
                self.warn(doc_path, f"Link target not found in the import: {path}")
                return "broken", path
            folder = posixpath.normpath(posixpath.join(
                from_dir, unicodedata.normalize("NFC", path).strip("/"))).lower()
            if folder in self.folder_pages:
                return "page", self.pages[self.folder_pages[folder]].slug
        asset = self.resolve_asset(path, from_dir)
        if asset:
            url = self.media_url(asset, doc_path)
            return ("media", url) if url else ("broken", path)
        self.warn(doc_path, f"Link target not found in the import: {path}")
        return "broken", path

    def _md_link(self, m: re.Match, doc_path: str, from_dir: str) -> str:
        bang, text, target, title = m.group(1), m.group(2), m.group(3), m.group(4) or ""
        # Process nested links/images in the label (e.g. a linked image).
        text = _MD_LINK_RE.sub(lambda mm: self._md_link(mm, doc_path, from_dir), text)
        res = self._rewrite_target(target, doc_path, from_dir)
        if res is None:
            return f"{bang}[{text}]({target}{title})"
        kind, value = res
        if kind == "page":
            label = text if text.strip() else self.title_by_slug[value]
            if bang or "](" in label:
                return f"[{label}](/page/{value})"
            return f"[[{value}|{_safe_label(label)}]]"
        if kind == "media":
            return f"{bang}[{text}]({value}{title})"
        # broken: keep the visible text, drop the dead link
        return text or posixpath.basename(value)

    def _ref_def(self, m: re.Match, doc_path: str, from_dir: str) -> str:
        res = self._rewrite_target(m.group(2), doc_path, from_dir)
        if res is None or res[0] == "broken":
            return m.group(0)
        kind, value = res
        url = f"/page/{value}" if kind == "page" else value
        return f"{m.group(1)}{url}{m.group(3)}"

    def _convert_html(self, chunk: str, doc_path: str, from_dir: str) -> str:
        if "<" not in chunk:
            return chunk
        # Lines of an HTML block keep their indentation once the tags are
        # gone, and 4+ spaces would turn them into a code block — so dedent
        # first. A block runs from a line starting with a tag to the next
        # blank line (CommonMark HTML block rule).
        lines = chunk.split("\n")
        in_block = False
        for i, line in enumerate(lines):
            if not line.strip():
                in_block = False
            elif _HTML_BLOCK_START_RE.match(line):
                in_block = True
            if in_block:
                lines[i] = line.strip()
        chunk = "\n".join(lines)

        chunk = _HTML_COMMENT_RE.sub("", chunk)
        chunk = _HTML_IMG_RE.sub(lambda m: self._html_img(m, doc_path, from_dir), chunk)
        chunk = _HTML_A_RE.sub(self._html_a, chunk)
        for pattern, repl in _HTML_INLINE:
            chunk = pattern.sub(repl, chunk)
        chunk = _HTML_WRAPPER_RE.sub("", chunk)
        # A wrapper-only line leaves trailing spaces that would read as a
        # hard break on the previous line; normalise whitespace-only lines.
        chunk = re.sub(r"^[ \t]+$", "", chunk, flags=re.M)

        leftover = sorted({t.lower() for t in _HTML_TAG_RE.findall(chunk)} - {"br"})
        if leftover:
            self.warn(doc_path, "HTML shown as text (not supported by the viewer): "
                      + ", ".join(f"<{t}>" for t in leftover))
        return chunk

    def _html_a(self, m: re.Match) -> str:
        href = None
        for am in _HTML_ATTR_RE.finditer(m.group(1)):
            if am.group(1).lower() == "href":
                href = next(g for g in am.groups()[1:] if g is not None)
        text = m.group(2).strip()
        if not href:
            return text
        # Emit a Markdown link; the Markdown link pass resolves relative targets.
        target = f"<{href}>" if re.search(r"[\s()]", href) else href
        return f"[{text}]({target})"

    def _html_img(self, m: re.Match, doc_path: str, from_dir: str) -> str:
        attrs = {}
        for am in _HTML_ATTR_RE.finditer(m.group(0)):
            attrs[am.group(1).lower()] = next(g for g in am.groups()[1:] if g is not None)
        src = attrs.get("src")
        if not src:
            return ""
        alt = attrs.get("alt", "").replace("]", "")
        res = self._rewrite_target(src, doc_path, from_dir)
        if res is None:
            return f"![{alt}]({src})"
        kind, value = res
        if kind == "media":
            return f"![{alt}]({value})"
        return alt or posixpath.basename(value)

    def run(self) -> ImportResult:
        self.load_docs()
        if not self.docs:
            raise ImportFailed("No Markdown (.md) files found in the upload")
        self.plan_tree()
        self.folder_pages = {k[4:].lower(): k for k in self.pages if k.startswith("dir:")}
        for doc_path, key in self.doc_page.items():
            page = self.pages[key]
            page.content_md = self.convert_doc(doc_path)
            page.tags = _norm_tags(self.docs[doc_path].tags)
        return ImportResult(
            flavor=self.flavor,
            pages=list(self.pages.values()),
            media=self.media_order,
            warnings=self.warnings,
            warnings_truncated=self.warnings_truncated,
        )


def convert(
    source: ImportSource,
    flavor: str = "auto",
    *,
    new_slug: Callable[[], str],
    max_asset_bytes: int,
) -> ImportResult:
    """Plan an import. ``flavor`` is one of FLAVORS or 'auto'."""
    if flavor == "auto":
        flavor = "obsidian" if source.has_obsidian_dir else "markdown"
    if flavor not in FLAVORS:
        raise ImportFailed(f"Unknown source type: {flavor}")
    return _Converter(source, flavor, new_slug, max_asset_bytes).run()
