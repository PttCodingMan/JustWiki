import io
import os
import shutil
import sqlite3
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

    db_path = Path(settings.DB_PATH)
    media_dir = Path(settings.MEDIA_DIR)

    # Write DB to a temp file first and validate it. Only once we're sure the
    # candidate opens cleanly and passes integrity_check do we replace the live
    # DB. This protects against partial writes, truncated zips, non-SQLite
    # contents, and corrupt SQLite files.
    tmp_db = db_path.with_suffix(".db.tmp")
    # Clean up any leftover from a previous failed restore.
    if tmp_db.exists():
        try:
            tmp_db.unlink()
        except OSError:
            pass

    try:
        with zf.open("just-wiki.db") as src, open(tmp_db, "wb") as dst:
            shutil.copyfileobj(src, dst)

        # Validate the candidate DB before touching the live one.
        try:
            conn = sqlite3.connect(str(tmp_db))
            try:
                cur = conn.execute("PRAGMA integrity_check")
                result = cur.fetchone()
                if not result or result[0] != "ok":
                    raise HTTPException(
                        status_code=400,
                        detail="Backup database failed integrity check",
                    )
            finally:
                conn.close()
        except sqlite3.DatabaseError:
            raise HTTPException(
                status_code=400,
                detail="Backup file does not contain a valid SQLite database",
            )

        # Flush the WAL back into the main DB file before copying. Without
        # this, the safety copy would miss any committed-but-not-checkpointed
        # transactions and would not be a faithful recovery snapshot.
        live_db = await get_db()
        await live_db.execute("PRAGMA wal_checkpoint(TRUNCATE)")

        # Keep a safety copy of the current DB so an admin can recover by hand
        # if the freshly-initialized connection later refuses the restored
        # file. .pre-restore is intentionally a plain copy, not a rename, so
        # the live file is untouched until the final atomic replace below.
        if db_path.exists():
            safety = db_path.with_suffix(".db.pre-restore")
            try:
                shutil.copy2(db_path, safety)
            except OSError:
                pass

        # Close current DB connection just before swapping files, so the OS
        # handle doesn't hold the old file open during the replace.
        await close_db()

        tmp_db.replace(db_path)
    except HTTPException:
        if tmp_db.exists():
            try:
                tmp_db.unlink()
            except OSError:
                pass
        raise
    except Exception:
        if tmp_db.exists():
            try:
                tmp_db.unlink()
            except OSError:
                pass
        raise

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
