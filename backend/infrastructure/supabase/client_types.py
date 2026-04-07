"""Protocol types for asyncpg abstractions.

Shared across client.py and all repository modules.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from types import TracebackType
from typing import Protocol, TypeAlias

Row: TypeAlias = Mapping[str, object]


class AsyncPGTransactionContext(Protocol):
    async def __aenter__(self) -> object: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> object: ...


class AsyncPGConnection(Protocol):
    def transaction(self) -> AsyncPGTransactionContext: ...

    async def executemany(
        self, command: str, args: Sequence[Sequence[object]]
    ) -> object: ...


class AsyncPGAcquireContext(Protocol):
    async def __aenter__(self) -> AsyncPGConnection: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> object: ...


class AsyncPGPool(Protocol):
    async def fetchrow(self, query: str, *args: object) -> Row | None: ...

    async def fetch(self, query: str, *args: object) -> list[Row]: ...

    async def execute(self, query: str, *args: object) -> str | None: ...

    def acquire(self) -> AsyncPGAcquireContext: ...

    async def close(self) -> None: ...


class AsyncPGModule(Protocol):
    async def create_pool(
        self,
        dsn: str,
        *,
        min_size: int,
        max_size: int,
    ) -> AsyncPGPool: ...
