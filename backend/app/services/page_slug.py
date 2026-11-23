import re
import secrets
from urllib.parse import unquote

PAGE_SLUG_BYTES = 4

_WIKILINK_TARGET_RE = re.compile(r"(!?\[\[)([^\]|]+)((?:\|[^\]]+)?\]\])")
_PAGE_URL_TARGET_RE = re.compile(r"(/(?:public/)?page/)([^\s/?#)\]\"'<>]+)")


def new_page_slug() -> str:
    return secrets.token_hex(PAGE_SLUG_BYTES)


def rewrite_page_slugs(content_md: str, slug_map: dict[str, str]) -> str:
    def replace_wikilink(m: re.Match) -> str:
        old_slug = m.group(2).strip()
        new_slug = slug_map.get(old_slug)
        if not new_slug:
            return m.group(0)
        label_and_close = m.group(3) if m.group(3) != "]]" else f"|{old_slug}]]"
        return f"{m.group(1)}{new_slug}{label_and_close}"

    def replace_page_url(m: re.Match) -> str:
        new_slug = slug_map.get(unquote(m.group(2)))
        return f"{m.group(1)}{new_slug}" if new_slug else m.group(0)

    content_md = _WIKILINK_TARGET_RE.sub(replace_wikilink, content_md)
    return _PAGE_URL_TARGET_RE.sub(replace_page_url, content_md)
