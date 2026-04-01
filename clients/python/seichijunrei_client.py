"""Seichijunrei Python client for agent/CLI use.

Usage:
    from clients.python.seichijunrei_client import SeichijunreiClient

    client = SeichijunreiClient(api_key="sk_your_key")
    result = client.search("吹響ユーフォニアムの聖地", locale="ja")
    print(result["message"])

Or from CLI:
    SK=sk_xxx python clients/python/seichijunrei_client.py "吹響の聖地"
"""

from __future__ import annotations

import httpx


class SeichijunreiClient:
    """Synchronous client for the Seichijunrei runtime API."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://seichijunrei.dev",
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def search(
        self, text: str, locale: str = "ja", session_id: str | None = None
    ) -> dict:
        body: dict = {"text": text, "locale": locale}
        if session_id:
            body["session_id"] = session_id
        response = httpx.post(
            f"{self._base_url}/v1/runtime",
            json=body,
            headers=self._headers,
            timeout=self._timeout,
        )
        response.raise_for_status()
        return response.json()

    def feedback(
        self,
        query_text: str,
        rating: str,
        intent: str | None = None,
        comment: str | None = None,
        session_id: str | None = None,
    ) -> str:
        body: dict = {"query_text": query_text, "rating": rating}
        if intent:
            body["intent"] = intent
        if comment:
            body["comment"] = comment
        if session_id:
            body["session_id"] = session_id
        response = httpx.post(
            f"{self._base_url}/v1/feedback",
            json=body,
            headers=self._headers,
            timeout=self._timeout,
        )
        response.raise_for_status()
        return response.json()["feedback_id"]


class AsyncSeichijunreiClient:
    """Async client for use in async agents/skills."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://seichijunrei.dev",
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def search(
        self, text: str, locale: str = "ja", session_id: str | None = None
    ) -> dict:
        body: dict = {"text": text, "locale": locale}
        if session_id:
            body["session_id"] = session_id
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/v1/runtime", json=body, headers=self._headers
            )
            response.raise_for_status()
            return response.json()

    async def feedback(
        self,
        query_text: str,
        rating: str,
        intent: str | None = None,
        comment: str | None = None,
        session_id: str | None = None,
    ) -> str:
        body: dict = {"query_text": query_text, "rating": rating}
        if intent:
            body["intent"] = intent
        if comment:
            body["comment"] = comment
        if session_id:
            body["session_id"] = session_id
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/v1/feedback", json=body, headers=self._headers
            )
            response.raise_for_status()
            return response.json()["feedback_id"]


if __name__ == "__main__":
    import json
    import os
    import sys

    api_key = os.environ.get("SK") or os.environ.get("SEICHIJUNREI_API_KEY")
    if not api_key:
        print("Set SK or SEICHIJUNREI_API_KEY env var", file=sys.stderr)
        sys.exit(1)
    if len(sys.argv) < 2:
        print("Usage: SK=sk_xxx python seichijunrei_client.py <query> [locale]")
        sys.exit(1)

    text = sys.argv[1]
    locale = sys.argv[2] if len(sys.argv) > 2 else "ja"
    base_url = os.environ.get("SEICHIJUNREI_BASE_URL", "https://seichijunrei.dev")
    client = SeichijunreiClient(api_key=api_key, base_url=base_url)
    result = client.search(text, locale=locale)
    print(json.dumps(result, ensure_ascii=False, indent=2))
