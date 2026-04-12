import pytest
import asyncio
import os
import tempfile
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import init_db, close_db, get_db
from app.config import settings

from app.auth import create_token, hash_password

# Override DB_PATH for testing
@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    # Use a temporary file for the test database
    fd, temp_path = tempfile.mkstemp()
    os.close(fd)
    
    settings.DB_PATH = temp_path
    
    # Run migrations
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(init_db())
    
    yield
    
    # Cleanup
    loop.run_until_complete(close_db())
    if os.path.exists(temp_path):
        os.remove(temp_path)

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

@pytest.fixture
async def db():
    return await get_db()

@pytest.fixture
async def auth_user(db):
    # Check if test user exists
    rows = await db.execute_fetchall("SELECT * FROM users WHERE username = 'testuser'")
    if not rows:
        pw_hash = hash_password("testpass")
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
            ("testuser", pw_hash),
        )
        await db.commit()
        user_id = cursor.lastrowid
        user = {"id": user_id, "username": "testuser", "role": "user"}
    else:
        user = dict(rows[0])
    
    token = create_token(user["id"], user["username"], user["role"])
    return {"user": user, "token": token}

@pytest.fixture
async def auth_client(client, auth_user):
    client.headers.update({"Authorization": f"Bearer {auth_user['token']}"})
    return client

@pytest.fixture
async def admin_user(db):
    rows = await db.execute_fetchall("SELECT * FROM users WHERE role = 'admin' LIMIT 1")
    if not rows:
        pw_hash = hash_password("adminpass")
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
            ("admin", pw_hash),
        )
        await db.commit()
        user_id = cursor.lastrowid
        user = {"id": user_id, "username": "admin", "role": "admin"}
    else:
        user = dict(rows[0])
    
    token = create_token(user["id"], user["username"], user["role"])
    return {"user": user, "token": token}

@pytest.fixture
async def admin_client(client, admin_user):
    client.headers.update({"Authorization": f"Bearer {admin_user['token']}"})
    return client
