import io
import os
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.config import settings
from app.database import get_db, close_db, init_db

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("")
async def create_backup(user=Depends(require_admin)):
    """Create a .zip backup containing the DB and media files."""
    db_path = Path(settings.DB_PATH)
    media_dir = Path(settings.MEDIA_DIR)

    if not db_path.exists():
        raise HTTPException(status_code=500, detail="Database file not found")

    # Flush WAL to main db before backup
    db = await get_db()
    await db.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add database
        zf.write(db_path, "just-wiki.db")

        # Add media files
        if media_dir.exists():
            for fpath in media_dir.iterdir():
                if fpath.is_file():
                    zf.write(fpath, f"media/{fpath.name}")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=just-wiki-backup.zip"},
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    user=Depends(require_admin),
):
    """Restore from a .zip backup. Replaces DB and media."""
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip")

    content = await file.read()
    max_restore_size = 500 * 1024 * 1024  # 500 MB
    if len(content) > max_restore_size:
        raise HTTPException(status_code=413, detail="Backup file too large (max 500 MB)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid zip file")

    names = zf.namelist()
    if "just-wiki.db" not in names:
        raise HTTPException(status_code=400, detail="Zip must contain just-wiki.db")

    # Close current DB connection
    await close_db()

    db_path = Path(settings.DB_PATH)
    media_dir = Path(settings.MEDIA_DIR)

    # Write DB file atomically: write to temp first, then rename
    tmp_db = db_path.with_suffix(".db.tmp")
    with zf.open("just-wiki.db") as src, open(tmp_db, "wb") as dst:
        shutil.copyfileobj(src, dst)
    tmp_db.replace(db_path)

    # Restore media files (with Zip Slip protection)
    media_dir.mkdir(parents=True, exist_ok=True)
    resolved_media = media_dir.resolve()
    for name in names:
        if name.startswith("media/") and not name.endswith("/"):
            fname = name.split("/", 1)[1]
            target = (media_dir / fname).resolve()
            # Prevent path traversal: target must stay within media_dir
            if not str(target).startswith(str(resolved_media) + "/"):
                continue  # skip malicious entries silently
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)

    zf.close()

    # Re-initialize DB connection
    await init_db()

    return {"status": "ok", "message": "Backup restored successfully"}
