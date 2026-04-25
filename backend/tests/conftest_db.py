"""Testcontainer-based PostgreSQL fixtures for integration and eval tests.

Usage: import this conftest in integration/eval test files that need a real DB.
The pg_container fixture is session-scoped (one container per test run).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import psycopg2
import pytest
from testcontainers.postgres import PostgresContainer


def _docker_available() -> bool:
    """Check if Docker daemon is running."""
    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (OSError, FileNotFoundError):
        return False


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
SEED_FILE = Path(__file__).parent / "fixtures" / "seed.sql"

# Skip extensions that require special installation in plain postgres
SKIP_EXTENSIONS = {"vector"}


def _filter_migration_lines(sql: str) -> str:
    """Remove pgvector-specific lines from migration SQL.

    Line-based: removes CREATE EXTENSION vector, embedding column defs,
    and individual lines containing vector ops. Multi-line statement
    cleanup (e.g. dangling CREATE INDEX) is handled at the statement level.
    """
    lines = sql.split("\n")
    filtered: list[str] = []
    for line in lines:
        stripped = line.strip()
        # Skip CREATE EXTENSION ... vector
        if re.match(r"CREATE EXTENSION.*\bvector\b", stripped, re.IGNORECASE):
            continue
        # Skip embedding vector(...) column definitions
        if re.search(r"\bembedding\s+vector\s*\(", stripped, re.IGNORECASE):
            continue
        filtered.append(line)

    result = "\n".join(filtered)
    # Fix trailing commas before closing paren: "TEXT,\n)" → "TEXT\n)"
    result = re.sub(r",(\s*\))", r"\1", result)
    return result


def _skip_vector_statements(statements: list[str]) -> list[str]:
    """Drop entire SQL statements that depend on pgvector."""
    kept: list[str] = []
    for stmt in statements:
        # Skip any statement referencing vector ops or HNSW
        if re.search(r"vector_(cosine|l2)_ops|USING\s+HNSW", stmt, re.IGNORECASE):
            continue
        # Skip dangling CREATE INDEX that lost its ON clause (from line removal)
        if re.match(
            r"\s*CREATE INDEX.*\n\s*$",
            stmt,
            re.IGNORECASE | re.DOTALL,
        ):
            continue
        kept.append(stmt)
    return kept


def _split_sql_statements(sql: str) -> list[str]:
    """Split SQL into individual statements, respecting $$ blocks."""
    statements: list[str] = []
    current: list[str] = []
    in_dollar_block = False

    for line in sql.split("\n"):
        stripped = line.strip()

        # Track $$ blocks (PL/pgSQL function bodies)
        dollar_count = stripped.count("$$")
        if dollar_count % 2 == 1:
            in_dollar_block = not in_dollar_block

        current.append(line)

        # Statement boundary: semicolon (possibly followed by inline comment)
        # Handles both "CREATE TABLE foo;" and "CREATE EXTENSION ...; -- comment"
        code_part = stripped.split("--")[0].rstrip()
        if not in_dollar_block and code_part.endswith(";"):
            stmt = "\n".join(current).strip()
            if stmt and stmt != ";":
                statements.append(stmt)
            current = []

    # Catch any trailing content
    remainder = "\n".join(current).strip()
    if remainder and remainder != ";":
        statements.append(remainder)

    return statements


def _apply_migrations_sync(dsn: str) -> None:
    """Apply all SQL migrations from supabase/migrations/ in order.

    Each statement is executed individually so that failures in one
    (e.g. missing auth schema, pgvector type) do not block others.
    """
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    for f in migration_files:
        sql = f.read_text()
        sql_filtered = _filter_migration_lines(sql)
        statements = _split_sql_statements(sql_filtered)
        statements = _skip_vector_statements(statements)

        for stmt in statements:
            try:
                cur.execute(stmt)
            except Exception as e:
                # Expected: auth schema refs, Supabase roles, etc.
                print(f"  {f.name}: statement skipped: {e!s:.120}")

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


def _to_psycopg2_dsn(url: str) -> str:
    """Convert testcontainer URL to a plain psycopg2 DSN."""
    return url.replace("postgresql+psycopg2://", "postgresql://")


@pytest.fixture(scope="session")
def pg_container() -> Iterator[PostgresContainer]:
    """Spin up a PostgreSQL 16 container for the test session."""
    if not _docker_available():
        pytest.skip("Docker not available — skipping testcontainer tests")
    with PostgresContainer("postgis/postgis:16-3.4") as pg:
        dsn = _to_psycopg2_dsn(pg.get_connection_url())
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
