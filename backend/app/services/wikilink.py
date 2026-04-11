import re

# Match [[slug]] or [[slug|display text]] — but NOT ![[slug]] (transclusion)
WIKILINK_RE = re.compile(r'(?<!!)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]')

# Match ![[slug]] (transclusion)
TRANSCLUSION_RE = re.compile(r'!\[\[([^\]|]+)\]\]')


def extract_wikilink_slugs(content_md: str) -> set[str]:
    """Extract all referenced slugs from wikilinks and transclusions in markdown."""
    slugs = set()
    for m in WIKILINK_RE.finditer(content_md):
        slugs.add(m.group(1).strip())
    for m in TRANSCLUSION_RE.finditer(content_md):
        slugs.add(m.group(1).strip())
    return slugs


async def parse_and_update_backlinks(db, source_page_id: int, content_md: str):
    """Parse wikilinks from content and update the backlinks table."""
    slugs = extract_wikilink_slugs(content_md)

    # Remove old backlinks from this source
    await db.execute("DELETE FROM backlinks WHERE source_page_id = ?", (source_page_id,))

    if not slugs:
        return

    # Resolve slugs to page IDs
    placeholders = ",".join("?" for _ in slugs)
    rows = await db.execute_fetchall(
        f"SELECT id, slug FROM pages WHERE slug IN ({placeholders})",
        list(slugs),
    )

    for row in rows:
        target_id = row["id"]
        if target_id != source_page_id:  # no self-links
            await db.execute(
                "INSERT OR IGNORE INTO backlinks (source_page_id, target_page_id) VALUES (?, ?)",
                (source_page_id, target_id),
            )


async def resolve_transclusion(db, slug: str, depth: int = 0) -> str | None:
    """Resolve a transclusion by fetching the target page content.
    Limits recursion to prevent infinite loops."""
    if depth > 3:
        return "*[Transclusion depth limit reached]*"

    rows = await db.execute_fetchall(
        "SELECT content_md FROM pages WHERE slug = ?", (slug,)
    )
    if not rows:
        return None
    return rows[0]["content_md"]
