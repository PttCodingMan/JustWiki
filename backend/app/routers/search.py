import html
import json
import re
from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import get_db
from app.services.acl import list_readable_page_ids
from app.services.search import segment

router = APIRouter(prefix="/api/search", tags=["search"])

# FTS5 trigram requires ≥3-char terms; shorter ones fall back to LIKE.
_TRIGRAM_MIN_LEN = 3
# LIKE wildcards that need escaping so user input like "100%" is treated literally.
_LIKE_ESCAPE = "\\"


def _escape_like(s: str) -> str:
    return (
        s.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )


def _escape_fts_phrase(s: str) -> str:
    # FTS5 phrase syntax escapes an embedded " by doubling it.
    return s.replace('"', '""')


def make_snippet(text: str, query: str, max_len: int = 200) -> str:
    """Extract a snippet around the first match and wrap matches in <mark>."""
    query_words = [w for w in query.split() if w]
    if not query_words:
        return text[:max_len]

    # Find the first matching position
    lower_text = text.lower()
    best_pos = len(text)
    for w in query_words:
        pos = lower_text.find(w.lower())
        if pos != -1 and pos < best_pos:
            best_pos = pos

    if best_pos == len(text):
        best_pos = 0

    start = max(0, best_pos - 60)
    end = min(len(text), start + max_len)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    # Escape first so the snippet is safe to render as HTML, then highlight.
    snippet = html.escape(snippet)
    for w in query_words:
        if w:
            pattern = re.compile(re.escape(html.escape(w)), re.IGNORECASE)
            snippet = pattern.sub(lambda m: f"<mark>{m.group()}</mark>", snippet)

    return snippet


async def _search_fts(db, fts_query, tag, readable_json, per_page, offset):
    """Full-text search via FTS5 MATCH (trigram or unicode61)."""
    if tag:
        count_sql = """
            SELECT COUNT(DISTINCT p.id) as cnt
            FROM search_index
            JOIN pages p ON CAST(search_index.page_id AS INTEGER) = p.id
            JOIN page_tags pt ON pt.page_id = p.id
            JOIN tags t ON t.id = pt.tag_id
            WHERE search_index MATCH ? AND t.name = ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
        """
        count_rows = await db.execute_fetchall(count_sql, [fts_query, tag, readable_json])
        total = count_rows[0]["cnt"]

        search_sql = """
            SELECT DISTINCT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count
            FROM search_index
            JOIN pages p ON CAST(search_index.page_id AS INTEGER) = p.id
            JOIN page_tags pt ON pt.page_id = p.id
            JOIN tags t ON t.id = pt.tag_id
            WHERE search_index MATCH ? AND t.name = ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
            ORDER BY search_index.rank
            LIMIT ? OFFSET ?
        """
        rows = await db.execute_fetchall(
            search_sql, [fts_query, tag, readable_json, per_page, offset]
        )
    else:
        count_sql = """
            SELECT COUNT(*) as cnt
            FROM search_index
            JOIN pages p ON CAST(search_index.page_id AS INTEGER) = p.id
            WHERE search_index MATCH ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
        """
        count_rows = await db.execute_fetchall(count_sql, [fts_query, readable_json])
        total = count_rows[0]["cnt"]

        search_sql = """
            SELECT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count
            FROM search_index
            JOIN pages p ON CAST(search_index.page_id AS INTEGER) = p.id
            WHERE search_index MATCH ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
            ORDER BY search_index.rank
            LIMIT ? OFFSET ?
        """
        rows = await db.execute_fetchall(
            search_sql, [fts_query, readable_json, per_page, offset]
        )
    return rows, total


async def _search_like(db, words, tag, readable_json, per_page, offset):
    """LIKE-based fallback for queries shorter than 3 characters.

    Matches any term (OR semantics) to stay consistent with the FTS path.
    `%` and `_` in user input are escaped so they are treated literally.
    """
    like_clauses = " OR ".join(
        f"p.title LIKE ? ESCAPE '{_LIKE_ESCAPE}' "
        f"OR p.content_md LIKE ? ESCAPE '{_LIKE_ESCAPE}'"
        for _ in words
    )
    like_clauses = f"({like_clauses})"
    like_params = []
    for w in words:
        pattern = f"%{_escape_like(w)}%"
        like_params.extend([pattern, pattern])

    if tag:
        count_sql = f"""
            SELECT COUNT(DISTINCT p.id) as cnt
            FROM pages p
            JOIN page_tags pt ON pt.page_id = p.id
            JOIN tags t ON t.id = pt.tag_id
            WHERE {like_clauses} AND t.name = ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
        """
        count_rows = await db.execute_fetchall(
            count_sql, like_params + [tag, readable_json]
        )
        total = count_rows[0]["cnt"]

        search_sql = f"""
            SELECT DISTINCT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count
            FROM pages p
            JOIN page_tags pt ON pt.page_id = p.id
            JOIN tags t ON t.id = pt.tag_id
            WHERE {like_clauses} AND t.name = ? AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
            ORDER BY p.updated_at DESC
            LIMIT ? OFFSET ?
        """
        rows = await db.execute_fetchall(
            search_sql, like_params + [tag, readable_json, per_page, offset]
        )
    else:
        count_sql = f"""
            SELECT COUNT(*) as cnt
            FROM pages p
            WHERE {like_clauses} AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
        """
        count_rows = await db.execute_fetchall(
            count_sql, like_params + [readable_json]
        )
        total = count_rows[0]["cnt"]

        search_sql = f"""
            SELECT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count
            FROM pages p
            WHERE {like_clauses} AND p.deleted_at IS NULL
              AND p.id IN (SELECT value FROM json_each(?))
            ORDER BY p.updated_at DESC
            LIMIT ? OFFSET ?
        """
        rows = await db.execute_fetchall(
            search_sql, like_params + [readable_json, per_page, offset]
        )
    return rows, total


@router.get("")
async def search_pages(
    q: str = Query(..., min_length=1),
    tag: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    db = await get_db()
    offset = (page - 1) * per_page

    # Segment query for FTS5
    q_seg = segment(q)
    words = [w for w in q_seg.split() if w]
    if not words:
        return {"results": [], "total": 0, "page": page, "per_page": per_page}

    readable = await list_readable_page_ids(db, user)
    if not readable:
        return {"results": [], "total": 0, "page": page, "per_page": per_page}
    readable_json = json.dumps(list(readable))

    # FTS5 trigram tokenizer needs at least 3 characters per term.
    # For shorter queries (common in CJK), fall back to LIKE.
    use_fts = all(len(w) >= _TRIGRAM_MIN_LEN for w in words)

    if use_fts:
        fts_query = " OR ".join(f'"{_escape_fts_phrase(w)}"' for w in words)
        rows, total = await _search_fts(
            db, fts_query, tag, readable_json, per_page, offset
        )
    else:
        rows, total = await _search_like(
            db, words, tag, readable_json, per_page, offset
        )

    results = []
    for r in rows:
        row = dict(r)
        results.append({
            "id": row["id"],
            "slug": row["slug"],
            "title": row["title"],
            "snippet": make_snippet(row["content_md"], q),
            "updated_at": row["updated_at"],
            "view_count": row["view_count"],
        })

    return {"results": results, "total": total, "page": page, "per_page": per_page}
