import pytest
import io
import zipfile

@pytest.mark.asyncio
async def test_backup_and_restore(admin_client, db):
    # 1. Create something to backup
    await admin_client.post("/api/pages", json={
        "title": "Before Backup",
        "content_md": "Before backup content"
    })

    # 2. Get the backup
    response = await admin_client.get("/api/backup")
    assert response.status_code == 200
    backup_zip = response.content

    # 3. Modify something
    await admin_client.post("/api/pages", json={
        "title": "After Backup",
        "content_md": "This should be gone after restore"
    })

    # 4. Restore
    files = {"file": ("backup.zip", backup_zip, "application/zip")}
    response = await admin_client.post("/api/backup/restore", files=files)
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    # 5. Verify restoration
    response = await admin_client.get("/api/pages")
    pages = response.json()["pages"]
    titles = [p["title"] for p in pages]
    assert "Before Backup" in titles
    # "After Backup" should NOT be in titles if restore was successful (full DB replacement)
    # Wait, the welcome page is seeded on init_db, so it might be there.
    # But "After Backup" should be gone.
    assert "After Backup" not in titles
