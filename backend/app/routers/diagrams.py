from fastapi import APIRouter, Depends, HTTPException
from app.schemas import DiagramCreate, DiagramUpdate, DiagramResponse
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])


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
    for field in ("name", "xml_data", "svg_cache", "page_id"):
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field} = ?")
            values.append(val)

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
async def delete_diagram(diagram_id: int, user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM diagrams WHERE id = ?", (diagram_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Diagram not found")
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
