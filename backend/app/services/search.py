def segment(text: str) -> str:
    """Return text as-is; FTS5 unicode61 handles CJK character tokenization."""
    return text


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
