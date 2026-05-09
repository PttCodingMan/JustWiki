import pytest
import asyncio
import os
import tempfile
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import boot_db_context, close_db, init_db
from app.config import settings

from app.auth import create_token, hash_password

# Override DB_PATH for testing
@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    # Use a temporary file for the test database
    fd, temp_path = tempfile.mkstemp()
    os.close(fd)

    settings.DB_PATH = temp_path

    # Initialise the schema in a throwaway loop, then close the pool. Each
    # test function runs in its own pytest-asyncio loop and rebuilds the
    # pool on first use; sharing a pool across loops doesn't work because
    # the asyncio primitives inside it are loop-bound.
    async def _init() -> None:
        async with boot_db_context():
            await init_db()
        await close_db()

    asyncio.run(_init())

    yield

    if os.path.exists(temp_path):
        os.remove(temp_path)


@pytest.fixture(autouse=True)
async def _bound_db_per_test():
    """Bind the writer connection for the test's duration and tear the pool
    down on the way out.

    Many tests call ``await get_db()`` directly outside of an HTTP request
    (helpers that insert rows, assertions that read state). The ConnectionProxy
    needs ``_request_conn`` to be set in the asyncio task for those calls to
    work, so we wrap the entire test in a ``boot_db_context``. Tests still
    issuing HTTP requests via ``client`` go through the request middleware,
    which temporarily swaps the bound connection to a reader for the request
    and restores the writer binding on the way out.

    pytest-asyncio creates a fresh event loop per test function, and the
    pool's asyncio primitives are loop-bound. ``close_db()`` on teardown
    drops the pool so the next test rebuilds it in its own loop.
    """
    async with boot_db_context() as conn:
        try:
            yield conn
        finally:
            await close_db()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def db(_bound_db_per_test):
    # Re-export the writer connection bound by the autouse fixture. Tests
    # that issue `await db.execute(...); await db.commit()` write through
    # the writer; subsequent HTTP requests in the same test go through the
    # middleware and read via a fresh reader connection. Reader sees only
    # *committed* state, so tests that insert via `db` must commit before
    # making an HTTP request that expects to see the row.
    return _bound_db_per_test

@pytest.fixture
async def auth_user(db):
    # Check if test user exists
    rows = await db.execute_fetchall("SELECT * FROM users WHERE username = 'testuser'")
    if not rows:
        pw_hash = hash_password("testpass")
        cursor = await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'editor')",
            ("testuser", pw_hash),
        )
        await db.commit()
        user_id = cursor.lastrowid
        user = {"id": user_id, "username": "testuser", "role": "editor"}
    else:
        user = dict(rows[0])

    token = create_token(user["id"], user["username"], user["role"])
    return {"user": user, "token": token}

@pytest.fixture
async def auth_client(auth_user):
    # Each client fixture gets its own httpx session so Authorization headers
    # don't collide when a test uses both auth_client and admin_client.
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {auth_user['token']}"},
    ) as ac:
        yield ac

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
async def admin_client(admin_user):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    ) as ac:
        yield ac
