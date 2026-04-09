"""Eval-specific fixtures — imports testcontainer DB from conftest_db."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest_db import db_pool as db_pool  # noqa: F401
from backend.tests.conftest_db import pg_container as pg_container  # noqa: F401

if TYPE_CHECKING:
    import asyncpg

    from backend.infrastructure.supabase.client import SupabaseClient


def _docker_available() -> bool:
    """Check whether Docker daemon is reachable (fast fail)."""
    import shutil
    import subprocess

    if shutil.which("docker") is None:
        return False
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


@pytest.fixture
async def real_db(db_pool: asyncpg.Pool) -> AsyncIterator[SupabaseClient]:  # noqa: F811
    """Build a SupabaseClient wired to the testcontainer pool."""
    from backend.infrastructure.supabase.client import SupabaseClient

    client = SupabaseClient.__new__(SupabaseClient)
    # Bypass __init__ / connect — inject pool directly.
    client._dsn = ""
    client._min_pool_size = 1
    client._max_pool_size = 2
    client._pool = db_pool  # type: ignore[assignment]
    client._bangumi = None
    client._points = None
    client._session = None
    client._feedback = None
    client._user_memory = None
    client._routes = None
    client._messages = None
    # _ensure_repos will lazy-init from _pool on first method call.
    yield client
    # Pool lifecycle managed by db_pool fixture — nothing to close here.
