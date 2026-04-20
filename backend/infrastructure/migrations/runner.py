"""Flyway-style migration runner — executes pending SQL migrations on startup."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import structlog

from backend.infrastructure.supabase.client_types import (
    AsyncPGPool,
    MigrationConnection,
)

logger = structlog.get_logger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
)
"""

_FETCH_APPLIED_SQL = "SELECT version FROM schema_migrations ORDER BY version"

_RECORD_SQL = "INSERT INTO schema_migrations (version) VALUES ($1)"


class MigrationRunner:
    """Applies pending SQL migrations in version order."""

    def __init__(
        self,
        pool: AsyncPGPool,
        migration_dir: Path,
        *,
        enabled: bool = True,
    ) -> None:
        self._pool = pool
        self._migration_dir = migration_dir
        self._enabled = enabled

    async def run(self) -> None:
        """Apply all pending migrations. No-op when disabled."""
        if not self._enabled:
            return
        async with self._pool.acquire() as raw_conn:
            conn = cast(MigrationConnection, raw_conn)
            await conn.execute(_CREATE_TABLE_SQL)
            applied = await _fetch_applied(conn)
            pending = _resolve_pending(self._migration_dir, applied)
            for version, sql in pending:
                await _apply(conn, version, sql)


async def _fetch_applied(conn: MigrationConnection) -> set[str]:
    rows = await conn.fetch(_FETCH_APPLIED_SQL)
    return {str(row["version"]) for row in rows}


def _resolve_pending(migration_dir: Path, applied: set[str]) -> list[tuple[str, str]]:
    return [
        (f.name, f.read_text())
        for f in sorted(migration_dir.glob("*.sql"))
        if f.name not in applied
    ]


async def _apply(conn: MigrationConnection, version: str, sql: str) -> None:
    async with conn.transaction():
        await conn.execute(sql)
        await conn.execute(_RECORD_SQL, version)
    logger.info("migration_applied", version=version)
