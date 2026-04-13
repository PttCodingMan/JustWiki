import re

# Match /api/media/{filename} inside markdown image tags, plain URLs, or HTML attrs.
# Filename is whatever isn't a quote, paren, whitespace, or closing bracket.
MEDIA_URL_RE = re.compile(r'/api/media/([^\s"\'()<>\]]+)')


def extract_media_filenames(content_md: str) -> set[str]:
    """Extract all referenced media filenames from markdown content."""
    return {m.group(1) for m in MEDIA_URL_RE.finditer(content_md or "")}


async def parse_and_update_media_refs(db, page_id: int, content_md: str):
    """Parse media URLs from content and update the media_references table."""
    filenames = extract_media_filenames(content_md)

    await db.execute("DELETE FROM media_references WHERE page_id = ?", (page_id,))

    if not filenames:
        return

    placeholders = ",".join("?" for _ in filenames)
    rows = await db.execute_fetchall(
        f"SELECT id FROM media WHERE filename IN ({placeholders})",
        list(filenames),
    )

    for row in rows:
        await db.execute(
            "INSERT OR IGNORE INTO media_references (page_id, media_id) VALUES (?, ?)",
            (page_id, row["id"]),
        )
