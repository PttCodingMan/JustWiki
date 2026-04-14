import pytest

from app import __version__
from app.routers import dashboard as dashboard_module


@pytest.mark.asyncio
async def test_stats_requires_auth(client):
    res = await client.get("/api/dashboard/stats")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_stats_requires_admin(auth_client):
    res = await auth_client.get("/api/dashboard/stats")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_stats_shape(admin_client):
    res = await admin_client.get("/api/dashboard/stats")
    assert res.status_code == 200
    data = res.json()

    expected_top_level = {
        "storage",
        "page_count",
        "user_count",
        "app_version",
        "latest_version",
        "check_updates_enabled",
        "python_version",
        "sqlite_version",
    }
    assert expected_top_level <= set(data.keys())

    expected_storage = {"disk_total_bytes", "disk_used_bytes", "db_size_bytes", "media_size_bytes"}
    assert expected_storage <= set(data["storage"].keys())

    assert data["app_version"] == __version__
    assert isinstance(data["storage"]["db_size_bytes"], int) and data["storage"]["db_size_bytes"] >= 0
    assert isinstance(data["storage"]["media_size_bytes"], int) and data["storage"]["media_size_bytes"] >= 0
    # shutil.disk_usage is stdlib and always available — these should be ints.
    assert isinstance(data["storage"]["disk_total_bytes"], int)
    assert isinstance(data["storage"]["disk_used_bytes"], int)
    assert data["storage"]["disk_total_bytes"] > 0
    assert data["page_count"] >= 0
    assert data["user_count"] >= 1
    assert data["check_updates_enabled"] is False
    assert data["latest_version"] is None


@pytest.mark.asyncio
async def test_latest_version_cache(admin_client, monkeypatch):
    """When CHECK_UPDATES=True the remote lookup is called; cache prevents a second hit."""
    from app.config import settings

    call_count = {"n": 0}

    async def fake_fetch():
        call_count["n"] += 1
        return "9.9.9"

    monkeypatch.setattr(dashboard_module, "_fetch_latest_version", fake_fetch)
    monkeypatch.setattr(dashboard_module, "_LATEST_VERSION_CACHE", None)
    monkeypatch.setattr(settings, "CHECK_UPDATES", True)

    res1 = await admin_client.get("/api/dashboard/stats")
    res2 = await admin_client.get("/api/dashboard/stats")
    assert res1.status_code == 200
    assert res2.status_code == 200
    assert res1.json()["latest_version"] == "9.9.9"
    assert res2.json()["latest_version"] == "9.9.9"
    assert call_count["n"] == 1
