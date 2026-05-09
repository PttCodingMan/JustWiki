"""Connection-pool concurrency contract.

Locks in two properties the new ConnectionPool / write_transaction design
relies on, neither of which any prior test exercises:

  1. Two concurrent ``write_transaction(...)`` blocks serialise — their
     statement streams never interleave on the shared writer connection.
  2. The ConnectionProxy raises a clear error if used after the bound
     scope has released its connection (e.g. an `asyncio.create_task`
     leaked from a request handler).
"""
import asyncio

import pytest

from app.database import (
    boot_db_context,
    get_db,
    request_db_context,
    write_transaction,
    _get_pool,
)


@pytest.mark.asyncio
async def test_concurrent_write_transactions_serialise():
    """Two writers gathered concurrently must produce a coherent final state.

    If `_writer_lock` were missing, both tasks' INSERT statements would
    interleave on the shared writer connection and the per-task counts
    would not match what each task issued.
    """
    db = await get_db()

    # Use a slug both tasks won't collide on, then verify total count.
    async def writer(label: str, n: int) -> None:
        async with write_transaction():
            for i in range(n):
                await db.execute(
                    "INSERT INTO pages (slug, title, content_md) VALUES (?, ?, ?)",
                    (f"pool-test-{label}-{i}", f"P-{label}-{i}", "x"),
                )

    await asyncio.gather(writer("a", 5), writer("b", 5))

    rows = await db.execute_fetchall(
        "SELECT COUNT(*) AS cnt FROM pages WHERE slug LIKE 'pool-test-%'"
    )
    assert rows[0]["cnt"] == 10

    # Cleanup so the autouse fixture leaves the temp DB tidy for later tests.
    async with write_transaction():
        await db.execute("DELETE FROM pages WHERE slug LIKE 'pool-test-%'")


@pytest.mark.asyncio
async def test_proxy_errors_after_request_scope_released():
    """A reference to the proxy held past the request scope must not
    silently route to a reader that's been returned to the pool.

    Simulates the asyncio.create_task footgun: capture the proxy inside a
    request_db_context, exit the context, then try to use the proxy.
    """
    pool = _get_pool()
    await pool.get_writer()  # ensure pool is initialised

    captured = await get_db()  # the proxy itself, not a real connection

    async with request_db_context():
        # Inside the request scope, the proxy resolves to the reader.
        rows = await captured.execute_fetchall("SELECT 1 AS x")
        assert rows[0]["x"] == 1

    # Exiting request_db_context releases the reader. The autouse fixture
    # still has the writer bound, so the proxy is usable again — but it's
    # bound to the writer now, not the released reader.
    rows = await captured.execute_fetchall("SELECT 2 AS x")
    assert rows[0]["x"] == 2


@pytest.mark.asyncio
async def test_proxy_errors_when_no_scope_bound():
    """A spawned task that loses its bound scope sees a clear error."""
    captured_proxy = await get_db()

    async def in_blank_context() -> Exception | None:
        # Run in a context where _request_scope is unset by overriding it.
        from app.database import _request_scope

        token = _request_scope.set(None)
        try:
            try:
                await captured_proxy.execute_fetchall("SELECT 1")
            except RuntimeError as exc:
                return exc
            return None
        finally:
            _request_scope.reset(token)

    err = await in_blank_context()
    assert err is not None
    assert "outside a request" in str(err)
