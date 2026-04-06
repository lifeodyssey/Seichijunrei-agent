"""End-to-end smoke tests for the production API.

These tests call the live HTTP service and require environment variables:
  - SEICHI_API_URL: base URL of the running service (e.g. http://localhost:8080)
  - SEICHI_API_KEY: a valid API key (sk_...) or Supabase JWT

Run with:
  SEICHI_API_URL=http://localhost:8080 SEICHI_API_KEY=sk_xxx \
    pytest backend/tests/integration/test_e2e_smoke.py -v
"""

from __future__ import annotations

import os
from typing import cast

import pytest

_API_URL = os.environ.get("SEICHI_API_URL", "")
_API_KEY = os.environ.get("SEICHI_API_KEY", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _API_URL or not _API_KEY,
        reason="SEICHI_API_URL and SEICHI_API_KEY required for E2E tests",
    ),
]


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_API_KEY}", "Content-Type": "application/json"}


async def _post(path: str, body: dict[str, object]) -> tuple[int, dict[str, object]]:
    """POST JSON to the API and return (status, body)."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{_API_URL}{path}",
            json=body,
            headers=_headers(),
        ) as resp:
            status = resp.status
            data = cast(dict[str, object], await resp.json())
            return status, data


async def _get(path: str) -> tuple[int, object]:
    """GET from the API and return (status, body)."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{_API_URL}{path}",
            headers=_headers(),
        ) as resp:
            status = resp.status
            data = await resp.json()
            return status, data


class TestHealthCheck:
    """Verify the health endpoint is reachable."""

    async def test_healthz_returns_ok(self) -> None:
        import aiohttp

        async with aiohttp.ClientSession() as session:
            async with session.get(f"{_API_URL}/healthz") as resp:
                assert resp.status == 200
                body = await resp.json()
                assert body.get("status") == "ok"


class TestRuntimeEndpoint:
    """Smoke tests for the /v1/runtime POST endpoint."""

    async def test_search_anime_returns_results(self) -> None:
        status, body = await _post(
            "/v1/runtime",
            {"text": "響け！ユーフォニアムの聖地を探して", "locale": "ja"},
        )
        assert status == 200
        assert body.get("success") is True

    async def test_greeting_returns_response(self) -> None:
        status, body = await _post(
            "/v1/runtime",
            {"text": "こんにちは", "locale": "ja"},
        )
        assert status == 200
        assert body.get("success") is True
        assert isinstance(body.get("message"), str)

    async def test_missing_text_returns_error(self) -> None:
        status, _body = await _post("/v1/runtime", {"locale": "ja"})
        assert status in (400, 422)


class TestConversationsEndpoint:
    """Smoke tests for the /v1/conversations GET endpoint."""

    async def test_list_conversations(self) -> None:
        status, body = await _get("/v1/conversations")
        assert status == 200
        assert isinstance(body, list)


class TestFeedbackEndpoint:
    """Smoke test for the /v1/feedback POST endpoint."""

    async def test_submit_feedback(self) -> None:
        status, body = await _post(
            "/v1/feedback",
            {
                "query_text": "test query",
                "intent": "search_bangumi",
                "rating": "good",
            },
        )
        # 200 or 201 depending on implementation
        assert status in (200, 201, 204)
