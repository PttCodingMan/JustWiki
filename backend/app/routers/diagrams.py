from fastapi import APIRouter, Depends, HTTPException
from app.schemas import (
    DiagramCreate,
    DiagramListItem,
    DiagramUpdate,
    DiagramResponse,
)
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.services.diagram_ref import extract_diagram_ids

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])


@router.get("", response_model=list[DiagramListItem])
async def list_diagrams(user=Depends(get_current_user)):
    """List every diagram with reference counts and linked pages.

    References are computed on-demand by scanning `pages.content_md` for
    `::drawio[id]` directives. Soft-deleted pages still count as references so
    that restoring a page cannot resurrect a dangling pointer — this diverges
    from `media_references` (which only counts live pages) on purpose.
    """
    db = await get_db()
    rows = await db.execute_fetchall(
        """SELECT d.id, d.name, d.page_id, d.created_by, d.created_at, d.updated_at,
                  CASE WHEN d.svg_cache IS NOT NULL AND d.svg_cache != ''
                       THEN 1 ELSE 0 END AS has_svg,
                  CASE WHEN u.display_name IS NOT NULL AND u.display_name != ''
                       THEN u.display_name ELSE u.username END AS created_by_name
           FROM diagrams d
           LEFT JOIN users u ON u.id = d.created_by
           ORDER BY d.updated_at DESC, d.id DESC"""
    )

    # Narrow the candidate set in SQL so we don't pull every page body into
    # Python on every list call. `::drawio` is only used inside the directive
    # (normal or Milkdown-escaped), so a LIKE prefilter is safe.
    page_rows = await db.execute_fetchall(
        """SELECT id, slug, title, content_md, deleted_at
           FROM pages
           WHERE content_md LIKE '%::drawio%'"""
    )
    refs_by_diagram: dict[int, list[dict]] = {}
    for pr in page_rows:
        for did in extract_diagram_ids(pr["content_md"] or ""):
            refs_by_diagram.setdefault(did, []).append(
                {
                    "id": pr["id"],
                    "slug": pr["slug"],
                    "title": pr["title"],
                    "deleted": pr["deleted_at"] is not None,
                }
            )

    items: list[dict] = []
    for r in rows:
        item = dict(r)
        item["has_svg"] = bool(item["has_svg"])
        refs = refs_by_diagram.get(item["id"], [])
        item["referenced_pages"] = refs
        item["reference_count"] = len(refs)
        items.append(item)
    return items


@router.get("/page/{page_id}")
async def list_page_diagrams(page_id: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE page_id = ? ORDER BY created_at", (page_id,)
    )
    return [dict(r) for r in rows]


@router.post("", response_model=DiagramResponse, status_code=201)
async def create_diagram(
    body: DiagramCreate,
    user=Depends(get_current_user),
):
    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO diagrams (name, xml_data, page_id, created_by, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        (body.name, body.xml_data, body.page_id, user["id"]),
    )
    await db.commit()
    row = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE id = ?", (cursor.lastrowid,)
    )
    d = row[0]
    return dict(d)


@router.get("/{diagram_id}", response_model=DiagramResponse)
async def get_diagram(diagram_id: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE id = ?", (diagram_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Diagram not found")
    return dict(rows[0])


@router.put("/{diagram_id}", response_model=DiagramResponse)
async def update_diagram(
    diagram_id: int,
    body: DiagramUpdate,
    user=Depends(get_current_user),
):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE id = ?", (diagram_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Diagram not found")

    updates = []
    values = []
    # Use model_fields_set so an explicit null page_id clears the association —
    # `is not None` would silently drop it.
    set_fields = body.model_fields_set
    for field in ("name", "xml_data", "svg_cache", "page_id"):
        if field in set_fields:
            updates.append(f"{field} = ?")
            values.append(getattr(body, field))

    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        values.append(diagram_id)
        await db.execute(
            f"UPDATE diagrams SET {', '.join(updates)} WHERE id = ?", values
        )
        await db.commit()

    rows = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE id = ?", (diagram_id,)
    )
    return dict(rows[0])


@router.delete("/{diagram_id}", status_code=204)
async def delete_diagram(diagram_id: int, user=Depends(require_admin)):
    """Delete a diagram. Refuses if any page (live or trashed) still references it."""
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM diagrams WHERE id = ?", (diagram_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Diagram not found")

    page_rows = await db.execute_fetchall(
        "SELECT content_md FROM pages WHERE content_md LIKE '%::drawio%'"
    )
    for pr in page_rows:
        if diagram_id in extract_diagram_ids(pr["content_md"] or ""):
            raise HTTPException(
                status_code=409,
                detail="Diagram is referenced by one or more pages and cannot be deleted",
            )

    await db.execute("DELETE FROM diagrams WHERE id = ?", (diagram_id,))
    await db.commit()


@router.get("/{diagram_id}/svg")
async def get_diagram_svg(diagram_id: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT svg_cache FROM diagrams WHERE id = ?", (diagram_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Diagram not found")
    svg = rows[0]["svg_cache"]
    if not svg:
        raise HTTPException(status_code=404, detail="No SVG cache available")
    from fastapi.responses import Response
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
            "X-Content-Type-Options": "nosniff",
        },
    )
