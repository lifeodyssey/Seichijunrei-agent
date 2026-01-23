"""Infrastructure adapter for the Bangumi gateway port."""

from __future__ import annotations

from application.errors import ExternalServiceError, InvalidInputError
from application.ports import BangumiGateway
from clients.bangumi import BangumiClient
from clients.errors import APIError


class BangumiClientGateway(BangumiGateway):
    """Adapter that creates a fresh BangumiClient per call.

    ADK tool execution may span multiple event loops; creating a new aiohttp client
    per call avoids cross-loop session issues.
    """

    def __init__(self, *, client: BangumiClient | None = None) -> None:
        self._client = client

    async def close(self) -> None:
        """Close the injected client if present."""
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def __aenter__(self) -> BangumiClientGateway:
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Async context manager exit with cleanup."""
        await self.close()

    async def search_subject(
        self, *, keyword: str, subject_type: int, max_results: int
    ) -> list[dict]:
        try:
            if self._client is not None:
                return await self._client.search_subject(
                    keyword=keyword,
                    subject_type=subject_type,
                    max_results=max_results,
                )

            async with BangumiClient() as client:
                return await client.search_subject(
                    keyword=keyword,
                    subject_type=subject_type,
                    max_results=max_results,
                )
        except ValueError as exc:
            raise InvalidInputError(str(exc)) from exc
        except APIError as exc:
            raise ExternalServiceError("bangumi", str(exc)) from exc

    async def get_subject(self, subject_id: int) -> dict:
        try:
            if self._client is not None:
                return await self._client.get_subject(subject_id)

            async with BangumiClient() as client:
                return await client.get_subject(subject_id)
        except ValueError as exc:
            raise InvalidInputError(str(exc)) from exc
        except APIError as exc:
            raise ExternalServiceError("bangumi", str(exc)) from exc
