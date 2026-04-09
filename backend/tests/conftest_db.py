"""Testcontainer-based PostgreSQL fixtures for integration and eval tests.

Usage: import this conftest in integration/eval test files that need a real DB.
The pg_container fixture is session-scoped (one container per test run).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import psycopg2
import pytest
from testcontainers.postgres import PostgresContainer

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
SEED_FILE = Path(__file__).parent / "fixtures" / "seed.sql"

# Skip extensions that require special installation in plain postgres
SKIP_EXTENSIONS = {"postgis", "vector"}


def _apply_migrations_sync(dsn: str) -> None:
    """Apply all SQL migrations from supabase/migrations/ in order."""
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    for f in migration_files:
        sql = f.read_text()
        # Skip CREATE EXTENSION for unsupported extensions in plain postgres
        lines = sql.split("\n")
        filtered: list[str] = []
        for line in lines:
            skip = False
            for ext in SKIP_EXTENSIONS:
                if f"CREATE EXTENSION" in line and ext in line:
                    skip = True
                    break
            if not skip:
                filtered.append(line)
        sql_filtered = "\n".join(filtered)

        try:
            cur.execute(sql_filtered)
        except Exception as e:
            # Some migrations may reference Supabase-specific schemas
            print(f"Migration {f.name} skipped: {e}")

    cur.close()
    conn.close()


def _seed_data_sync(dsn: str) -> None:
    """Seed test data from fixtures/seed.sql."""
    if not SEED_FILE.exists():
        return
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(SEED_FILE.read_text())
    cur.close()
    conn.close()


@pytest.fixture(scope="session")
def pg_container() -> Iterator[PostgresContainer]:
    """Spin up a PostgreSQL 16 container for the test session."""
    with PostgresContainer("postgres:16-alpine") as pg:
        dsn = pg.get_connection_url()
        _apply_migrations_sync(dsn)
        _seed_data_sync(dsn)
        yield pg


@pytest.fixture
async def db_pool(pg_container: PostgresContainer) -> AsyncIterator[asyncpg.Pool]:
    """Create an asyncpg connection pool to the testcontainer."""
    dsn = pg_container.get_connection_url()
    # Convert psycopg2 DSN to asyncpg format
    dsn = dsn.replace("+psycopg2", "").replace("psycopg2", "")
    pool = await asyncpg.create_pool(dsn)
    assert pool is not None
    yield pool
    await pool.close()
