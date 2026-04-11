import uuid
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import FileResponse
from app.schemas import MediaResponse
from app.auth import get_current_user
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/api/media", tags=["media"])

ALLOWED_TYPES = {
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
    "application/pdf", "text/plain", "text/markdown",
}

MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/upload", response_model=MediaResponse, status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    ext = Path(file.filename or "file").suffix
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = Path(settings.MEDIA_DIR) / filename

    content = await file.read()
    size = len(content)
    if size > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024*1024)} MB")
    filepath.write_bytes(content)

    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO media (filename, original_name, filepath, mime_type, size_bytes, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (filename, file.filename, str(filepath), file.content_type, size, user["id"]),
    )
    await db.commit()

    return {
        "id": cursor.lastrowid,
        "filename": filename,
        "original_name": file.filename or "",
        "filepath": str(filepath),
        "mime_type": file.content_type or "",
        "size_bytes": size,
        "uploaded_by": user["id"],
        "url": f"/api/media/{filename}",
    }


@router.get("/{filename}")
async def get_media(filename: str):
    media_dir = Path(settings.MEDIA_DIR).resolve()
    filepath = (media_dir / filename).resolve()

    # Prevent path traversal: resolved path must be inside MEDIA_DIR
    if not str(filepath).startswith(str(media_dir) + "/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)
