import re

# Index-side: FTS5 trigram tokenizer slides a 3-char window over the raw text,
# so we don't need to pre-segment. Kept as a no-op for callers/tests that import it.
def segment(text: str) -> str:
    """Index-side identity. The FTS5 trigram tokenizer handles CJK on its own."""
    return text


# ── Query-side tokenization ────────────────────────────────────────────────
#
# The trigram tokenizer indexes overlapping 3-char windows. A naive query like
# `q_seg.split()` produces a single token for whitespace-less CJK questions,
# which then becomes one FTS5 phrase requiring the *entire* question string to
# appear contiguously in the page — so natural-language CJK questions miss
# pages that only contain individual keywords.
#
# Fix: build the FTS query from the same kind of trigrams the index uses.
# CJK runs are sliced into overlapping 3-grams; ASCII words ≥3 chars are kept
# as phrases. Everything is ORed so any matching trigram counts.
#
# For queries where FTS still finds nothing (e.g. "我們的志工是誰?" against a
# page that only contains the bigram "志工" without any matching 3-gram), we
# expose a richer LIKE-fallback word list: original whitespace tokens plus
# 2-char windows of every CJK run. The router tries FTS first, then LIKE.

_CJK_RE = re.compile(
    "["
    "぀-ゟ"      # Hiragana
    "゠-ヿ"      # Katakana
    "㐀-䶿"      # CJK Extension A
    "一-鿿"      # CJK Unified Ideographs
    "가-힯"      # Hangul Syllables
    "豈-﫿"      # CJK Compatibility Ideographs
    "]+"
)
_WORD_RE = re.compile(r"[A-Za-z0-9]+")

# Trigram tokenizer requires ≥3 chars per token. Mirrored here so callers
# don't depend on router-private constants.
TRIGRAM_MIN_LEN = 3


def _escape_fts_phrase(s: str) -> str:
    return s.replace('"', '""')


# ── LIKE fallback escaping ─────────────────────────────────────────────────
#
# When FTS misses we fall back to LIKE patterns. SQLite LIKE treats `%` and
# `_` as wildcards; we escape them with a backslash and tell SQLite about it
# via `ESCAPE '\\'`. The escape character itself must also be escaped.

LIKE_ESCAPE = "\\"


def escape_like(s: str) -> str:
    """Escape `%`, `_`, and `\\` so the value is matched literally by LIKE."""
    return (
        s.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )


def build_fts_query(question: str) -> str | None:
    """Build an FTS5 MATCH expression that aligns with the trigram index.

    Returns None when the question yields no usable tokens (e.g. only 1–2 char
    CJK or short ASCII), signalling that callers should skip FTS and use the
    LIKE fallback directly.
    """
    parts: list[str] = []
    seen: set[str] = set()

    def add(tok: str) -> None:
        if tok and tok not in seen:
            seen.add(tok)
            parts.append(f'"{_escape_fts_phrase(tok)}"')

    for m in _CJK_RE.finditer(question):
        run = m.group()
        # Empty range when len(run) < TRIGRAM_MIN_LEN — short runs are skipped
        # here and picked up by build_like_words for the LIKE fallback.
        for i in range(len(run) - TRIGRAM_MIN_LEN + 1):
            add(run[i : i + TRIGRAM_MIN_LEN])

    for m in _WORD_RE.finditer(question):
        w = m.group()
        if len(w) >= TRIGRAM_MIN_LEN:
            add(w)

    return " OR ".join(parts) if parts else None


def build_like_words(question: str) -> list[str]:
    """Words for the LIKE fallback.

    Includes original whitespace-split tokens (preserves user-intended
    boundaries — e.g. "80%" stays intact so the LIKE escape treats it
    literally) plus 2-char windows of every CJK run, so natural-language
    CJK questions still hit pages where keywords appear as 2-char terms.
    """
    out: list[str] = []
    seen: set[str] = set()

    def add(w: str) -> None:
        if w and w not in seen:
            seen.add(w)
            out.append(w)

    for w in question.split():
        add(w)

    for m in _CJK_RE.finditer(question):
        run = m.group()
        if len(run) == 1:
            add(run)
        else:
            for i in range(len(run) - 1):
                add(run[i : i + 2])

    return out


# ── Index maintenance ──────────────────────────────────────────────────────


async def rebuild_search_index(db, page_id: int, title: str, content_md: str):
    """Update the FTS5 search index for a page."""
    title_seg = segment(title)
    content_seg = segment(content_md)

    await db.execute(
        "DELETE FROM search_index WHERE page_id = ?", (str(page_id),)
    )
    await db.execute(
        "INSERT INTO search_index (page_id, title, content_segmented) VALUES (?, ?, ?)",
        (str(page_id), title_seg, content_seg),
    )


async def remove_from_search_index(db, page_id: int):
    """Remove a page from the search index."""
    await db.execute(
        "DELETE FROM search_index WHERE page_id = ?", (str(page_id),)
    )
