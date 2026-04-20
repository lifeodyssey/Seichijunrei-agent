"""Unit tests for the Flyway-style migration runner."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.infrastructure.migrations.runner import MigrationRunner


def _make_connection(applied: list[str] | None = None) -> MagicMock:
    """Build a fake asyncpg connection with configurable applied migrations."""
    conn = MagicMock()
    conn.execute = AsyncMock()
    rows = [{"version": v} for v in (applied or [])]
    conn.fetch = AsyncMock(return_value=rows)
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=tx)
    return conn


def _make_pool(conn: MagicMock) -> MagicMock:
    """Build a fake asyncpg pool that yields the given connection."""
    acquire_ctx = AsyncMock()
    acquire_ctx.__aenter__ = AsyncMock(return_value=conn)
    acquire_ctx.__aexit__ = AsyncMock(return_value=None)
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire_ctx)
    return pool


@pytest.fixture
def migration_dir(tmp_path: Path) -> Path:
    """Return a temp directory with two .sql migration files."""
    (tmp_path / "20260101000000_alpha.sql").write_text("CREATE TABLE alpha (id INT);")
    (tmp_path / "20260101000001_beta.sql").write_text("CREATE TABLE beta (id INT);")
    return tmp_path


# ---------------------------------------------------------------------------
# creates tracking table
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_creates_tracking_table_on_first_run(
    migration_dir: Path,
) -> None:
    conn = _make_connection(applied=[])
    pool = _make_pool(conn)
    runner = MigrationRunner(pool, migration_dir)

    await runner.run()

    executed_sql = [c.args[0] for c in conn.execute.await_args_list]
    assert any(
        "schema_migrations" in sql and "CREATE TABLE" in sql for sql in executed_sql
    )


# ---------------------------------------------------------------------------
# applies pending migrations in order
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_applies_pending_migrations_in_order(
    migration_dir: Path,
) -> None:
    conn = _make_connection(applied=[])
    pool = _make_pool(conn)
    runner = MigrationRunner(pool, migration_dir)

    await runner.run()

    executed_sql = [c.args[0] for c in conn.execute.await_args_list]
    alpha_idx = next(i for i, s in enumerate(executed_sql) if "alpha" in s)
    beta_idx = next(i for i, s in enumerate(executed_sql) if "beta" in s)
    assert alpha_idx < beta_idx


# ---------------------------------------------------------------------------
# skips already-applied migrations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_skips_already_applied_migration(
    migration_dir: Path,
) -> None:
    conn = _make_connection(applied=["20260101000000_alpha.sql"])
    pool = _make_pool(conn)
    runner = MigrationRunner(pool, migration_dir)

    await runner.run()

    executed_sql = [c.args[0] for c in conn.execute.await_args_list]
    assert not any("alpha" in sql for sql in executed_sql)


# ---------------------------------------------------------------------------
# records applied migration in tracking table
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_records_applied_migration_in_tracking_table(
    migration_dir: Path,
) -> None:
    conn = _make_connection(applied=[])
    pool = _make_pool(conn)
    runner = MigrationRunner(pool, migration_dir)

    await runner.run()

    executed_sql = [c.args[0] for c in conn.execute.await_args_list]
    assert any("INSERT INTO schema_migrations" in sql for sql in executed_sql)


# ---------------------------------------------------------------------------
# respects AUTO_MIGRATE=false
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_is_skipped_when_auto_migrate_disabled(
    migration_dir: Path,
) -> None:
    conn = _make_connection(applied=[])
    pool = _make_pool(conn)
    runner = MigrationRunner(pool, migration_dir, enabled=False)

    await runner.run()

    conn.execute.assert_not_awaited()
