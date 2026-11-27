"""Minimal HTML → Markdown conversion for imported pages.

Used for pages that were authored in a WYSIWYG editor and stored as HTML
(e.g. Wiki.js's CKEditor pages). Standard library only: the HTML is parsed
into a small tree with ``html.parser`` and rendered back as CommonMark/GFM.
Anything without a Markdown equivalent degrades to its text content, so no
raw HTML reaches the viewer (which escapes it).
"""
from __future__ import annotations

import re
from html.parser import HTMLParser

_VOID = {"br", "img", "hr", "input", "meta", "link", "source", "col", "wbr",
         "area", "base", "embed", "param", "track"}
_SKIP = {"script", "style", "head", "template", "noscript", "iframe", "object"}
_BLOCK = {"p", "div", "section", "article", "header", "footer", "main", "nav",
          "aside", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6",
          "ul", "ol", "li", "blockquote", "pre", "table", "hr", "details",
          "summary", "dl", "dt", "dd", "address", "body", "html"}
_CALLOUT_CLASSES = {"is-info": "info", "is-success": "tip", "is-warning": "warning",
                    "is-danger": "danger"}
_BR = "\x01"  # placeholder so whitespace collapsing can't eat hard breaks


class _Node:
    __slots__ = ("tag", "attrs", "children")

    def __init__(self, tag: str, attrs: dict | None = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list = []


class _TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("#root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = _Node(tag, {k: v or "" for k, v in attrs})
        self.stack[-1].children.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(_Node(tag, {k: v or "" for k, v in attrs}))

    def handle_endtag(self, tag):
        # Close the nearest matching open element; stray end tags are ignored.
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def html_to_markdown(html: str) -> str:
    builder = _TreeBuilder()
    builder.feed(html)
    builder.close()
    out = _blocks(builder.root.children)
    return re.sub(r"\n{3,}", "\n\n", out).strip() + "\n"


def _escape(text: str) -> str:
    return re.sub(r"([\\`*_\[\]])", r"\\\1", text)


def _text_of(node) -> str:
    if isinstance(node, str):
        return node
    if node.tag in _SKIP:
        return ""
    if node.tag == "br":
        return "\n"
    return "".join(_text_of(c) for c in node.children)


def _classes(node: _Node) -> set[str]:
    return set(node.attrs.get("class", "").split())


def _finish_inline(text: str) -> str:
    text = re.sub(r"[ \t\r\n]+", " ", text)
    text = re.sub(rf" *{_BR} *", _BR, text).strip()
    return text.strip(_BR).replace(_BR, "  \n")


def _inline(node) -> str:
    if isinstance(node, str):
        return _escape(node)
    tag = node.tag
    if tag in _SKIP:
        return ""
    if tag == "br":
        return _BR
    if tag == "img":
        src = node.attrs.get("src", "")
        if not src:
            return ""
        alt = node.attrs.get("alt", "").replace("]", "").replace("[", "")
        return f"![{alt}]({_url(src)})"
    inner = "".join(_inline(c) for c in node.children)
    if tag == "a":
        href = node.attrs.get("href", "")
        label = inner.strip()
        if not href or not label:
            return inner
        return f"[{label}]({_url(href)})"
    if tag in ("strong", "b"):
        return _wrap(inner, "**")
    if tag in ("em", "i"):
        return _wrap(inner, "*")
    if tag in ("s", "del", "strike"):
        return _wrap(inner, "~~")
    if tag in ("code", "kbd", "samp", "tt"):
        raw = _text_of(node)
        if not raw.strip():
            return ""
        ticks = "`" * (max((len(m) for m in re.findall(r"`+", raw)), default=0) + 1)
        pad = " " if raw.startswith("`") or raw.endswith("`") else ""
        return f"{ticks}{pad}{raw}{pad}{ticks}"
    if tag in _BLOCK:  # block element inside inline context: keep its text
        return " " + inner + " "
    return inner


def _wrap(inner: str, marker: str) -> str:
    stripped = inner.strip()
    if not stripped:
        return inner
    lead = " " if inner[:1].isspace() else ""
    trail = " " if inner[-1:].isspace() else ""
    return f"{lead}{marker}{stripped}{marker}{trail}"


def _url(url: str) -> str:
    url = url.strip()
    return f"<{url}>" if re.search(r"[\s()<>]", url) else url


def _blocks(nodes: list, sep: str = "\n\n") -> str:
    parts: list[str] = []
    buf: list[str] = []

    def flush():
        text = _finish_inline("".join(buf))
        buf.clear()
        if text:
            parts.append(text)

    for node in nodes:
        if isinstance(node, str) or node.tag not in _BLOCK:
            buf.append(_inline(node))
            continue
        flush()
        block = _block(node)
        if block.strip():
            parts.append(block)
    flush()
    return sep.join(parts)


def _block(node: _Node) -> str:
    tag = node.tag
    if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
        text = _finish_inline("".join(_inline(c) for c in node.children))
        return f"{'#' * int(tag[1])} {text}" if text else ""
    if tag == "hr":
        return "---"
    if tag == "pre":
        code = next((c for c in node.children if isinstance(c, _Node) and c.tag == "code"), None)
        lang = ""
        for cls in _classes(code or node):
            if cls.startswith("language-"):
                lang = cls[len("language-"):]
        if lang in ("plaintext", "text"):
            lang = ""
        raw = _text_of(code or node).strip("\n")
        fence = "`" * max(3, max((len(m) for m in re.findall(r"`{3,}", raw)), default=0) + 1)
        return f"{fence}{lang}\n{raw}\n{fence}"
    if tag == "blockquote":
        inner = _blocks(node.children)
        kind = next((_CALLOUT_CLASSES[c] for c in _classes(node) if c in _CALLOUT_CLASSES), None)
        if kind:
            return f":::{kind}\n\n{inner}\n\n:::"
        return "\n".join(f"> {line}" if line else ">" for line in inner.split("\n"))
    if tag in ("ul", "ol"):
        return _list(node)
    if tag == "table":
        return _table(node)
    if tag == "figcaption":
        text = _blocks(node.children)
        return f"*{text}*" if text else ""
    if tag in ("summary", "dt"):
        text = _blocks(node.children)
        return f"**{text}**" if text else ""
    if tag == "li":  # stray <li> outside a list
        return _list(_Node("ul", {}), [node])
    return _blocks(node.children)


def _list(node: _Node, items: list | None = None) -> str:
    items = items if items is not None else [
        c for c in node.children if isinstance(c, _Node) and c.tag == "li"]
    ordered = node.tag == "ol"
    try:
        start = int(node.attrs.get("start", "1"))
    except ValueError:
        start = 1
    lines: list[str] = []
    for i, li in enumerate(items):
        marker = f"{start + i}. " if ordered else "- "
        body = _blocks(li.children, sep="\n") or ""
        indent = " " * len(marker)
        first, *rest = body.split("\n") if body else [""]
        lines.append(marker + first)
        lines.extend(indent + line if line else "" for line in rest)
    return "\n".join(lines)


def _table(node: _Node) -> str:
    rows: list[list[str]] = []

    def walk(n: _Node):
        for c in n.children:
            if not isinstance(c, _Node):
                continue
            if c.tag == "tr":
                cells = []
                for cell in c.children:
                    if isinstance(cell, _Node) and cell.tag in ("td", "th"):
                        text = _blocks(cell.children, sep="<br>").replace("  \n", "<br>").replace("\n", " ")
                        cells.append(text.replace("|", "\\|"))
                rows.append(cells)
            elif c.tag in ("thead", "tbody", "tfoot"):
                walk(c)

    walk(node)
    rows = [r for r in rows if r]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join(["---"] * width) + "|"]
    out.extend("| " + " | ".join(r) + " |" for r in rows[1:])
    return "\n".join(out)
