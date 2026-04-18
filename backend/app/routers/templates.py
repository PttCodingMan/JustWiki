import aiosqlite
from fastapi import APIRouter, HTTPException, Depends
from app.schemas import TemplateCreate, TemplateUpdate, TemplateResponse
from app.auth import get_current_user, require_admin
from app.database import get_db

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=list[TemplateResponse])
async def list_templates(user=Depends(get_current_user)):
    db = await get_db()
    rows = await db.execute_fetchall("SELECT * FROM templates ORDER BY name")
    return [dict(r) for r in rows]


@router.post("", response_model=TemplateResponse, status_code=201)
async def create_template(body: TemplateCreate, user=Depends(require_admin)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO templates (name, description, content_md, created_by) VALUES (?, ?, ?, ?)",
            (body.name, body.description, body.content_md, user["id"]),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    rows = await db.execute_fetchall(
        "SELECT * FROM templates WHERE id = ?", (cursor.lastrowid,)
    )
    return dict(rows[0])


@router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: int, body: TemplateUpdate, user=Depends(require_admin)
):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM templates WHERE id = ?", (template_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")

    current = dict(rows[0])
    name = body.name if body.name is not None else current["name"]
    desc = body.description if body.description is not None else current["description"]
    content = body.content_md if body.content_md is not None else current["content_md"]

    try:
        await db.execute(
            "UPDATE templates SET name = ?, description = ?, content_md = ? WHERE id = ?",
            (name, desc, content, template_id),
        )
        await db.commit()
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    rows = await db.execute_fetchall(
        "SELECT * FROM templates WHERE id = ?", (template_id,)
    )
    return dict(rows[0])


@router.delete("/{template_id}")
async def delete_template(template_id: int, user=Depends(require_admin)):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id FROM templates WHERE id = ?", (template_id,)
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    await db.commit()
    return {"ok": True}
