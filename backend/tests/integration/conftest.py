"""Integration test fixtures — real PostgreSQL via testcontainers."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from testcontainers.postgres import PostgresContainer

from backend.infrastructure.supabase.client import SupabaseClient

pytest_plugins = ("backend.tests.conftest_db",)


@pytest.fixture
async def tc_db(pg_container: PostgresContainer) -> AsyncIterator[SupabaseClient]:
    """A real SupabaseClient connected to the testcontainer PostgreSQL."""
    dsn = pg_container.get_connection_url()
    # Convert psycopg2 DSN to asyncpg format
    dsn = dsn.replace("+psycopg2", "").replace("psycopg2", "")
    client = SupabaseClient(dsn, min_pool_size=1, max_pool_size=5)
    await client.connect()
    yield client
    await client.close()
