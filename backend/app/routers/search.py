import html
import json
import re
from fastapi import APIRouter, Depends, Query
from app.auth import get_current_user
from app.database import get_db
from app.services.acl import list_readable_page_ids
from app.services.search import LIKE_ESCAPE, build_fts_query, build_like_words, escape_like

router = APIRouter(prefix="/api/search", tags=["search"])


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
            SELECT DISTINCT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count, p.page_type
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
            SELECT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count, p.page_type
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
        f"p.title LIKE ? ESCAPE '{LIKE_ESCAPE}' "
        f"OR p.content_md LIKE ? ESCAPE '{LIKE_ESCAPE}'"
        for _ in words
    )
    like_clauses = f"({like_clauses})"
    like_params = []
    for w in words:
        pattern = f"%{escape_like(w)}%"
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
            SELECT DISTINCT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count, p.page_type
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
            SELECT p.id, p.slug, p.title, p.content_md, p.updated_at, p.view_count, p.page_type
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

    fts_query = build_fts_query(q)
    like_words = build_like_words(q)
    if fts_query is None and not like_words:
        return {"results": [], "total": 0, "page": page, "per_page": per_page}

    readable = await list_readable_page_ids(db, user)
    if not readable:
        return {"results": [], "total": 0, "page": page, "per_page": per_page}
    readable_json = json.dumps(list(readable))

    rows: list = []
    total = 0
    if fts_query is not None:
        rows, total = await _search_fts(
            db, fts_query, tag, readable_json, per_page, offset
        )
    # FTS may legitimately return zero rows when the question's trigrams don't
    # overlap any indexed page (typical for natural-language CJK questions).
    # Fall back to LIKE — slower but matches keywords as substrings.
    if total == 0 and like_words:
        rows, total = await _search_like(
            db, like_words, tag, readable_json, per_page, offset
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
            "page_type": row["page_type"],
        })

    return {"results": results, "total": total, "page": page, "per_page": per_page}
