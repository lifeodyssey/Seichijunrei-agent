"""Conversation hydration contract tests.

Validates that assistant responses persisted to conversation_messages
can be correctly hydrated back into RuntimeResponse shape by the frontend.

This is critical because:
1. New runtime (pilgrimage_agent) produces different final_output than old pipeline
2. Frontend's hydrateResponseData() expects {intent, success, final_output: {results|route|...}}
3. Old sessions must still render correctly after the runtime migration

All tests use real testcontainer DB + real LLM.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[3] / ".env")

pytest_plugins = ("backend.tests.conftest_db",)


@pytest.fixture(autouse=True)
def setup_test_environment():
    """Override parent conftest's mock settings — integration needs real API keys."""
    yield


@pytest.mark.integration
async def test_persisted_clarify_response_hydrates_correctly(real_db) -> None:
    """Clarify response stored in DB should hydrate with question/candidates."""
    from backend.agents.pilgrimage_runner import run_pilgrimage_agent

    result = await run_pilgrimage_agent(
        text="凉宫",
        db=real_db,
        locale="zh",
    )

    # Simulate what public_api persists
    response_data = {
        "intent": result.intent,
        "success": all(sr.success for sr in result.step_results),
        "final_output": result.final_output,
    }

    # Simulate what frontend's hydrateResponseData does
    final_output = response_data.get("final_output")
    assert final_output is not None
    assert isinstance(final_output, dict)

    # Frontend checks: if "data" key exists, pass through; else wrap final_output as data
    if "data" in final_output:
        hydrated_data = final_output
    else:
        hydrated_data = {**response_data, "data": final_output}

    # The hydrated response must have message
    assert hydrated_data.get("message") or final_output.get("message")

    # If clarify, must have question + status
    if result.intent == "clarify":
        assert final_output.get("status") == "needs_clarification"
        assert final_output.get("question")


@pytest.mark.integration
async def test_persisted_search_response_hydrates_correctly(real_db) -> None:
    """Search response stored in DB should hydrate with results.rows."""
    from backend.agents.pilgrimage_runner import run_pilgrimage_agent

    result = await run_pilgrimage_agent(
        text="君の名は の聖地を教えて",
        db=real_db,
        locale="ja",
    )

    final_output = result.final_output or {}

    if result.intent in ("search_bangumi", "search_nearby"):
        results = final_output.get("results")
        assert results is not None, "search response must have results"
        assert isinstance(results, dict)
        assert "rows" in results
        assert "row_count" in results


@pytest.mark.integration
async def test_persisted_greet_response_hydrates_correctly(real_db) -> None:
    """Greet response stored in DB should hydrate with message."""
    from backend.agents.pilgrimage_runner import run_pilgrimage_agent

    result = await run_pilgrimage_agent(
        text="你好",
        db=real_db,
        locale="zh",
    )

    final_output = result.final_output or {}
    message = final_output.get("message", "")
    assert len(message) > 0, "greet response must have non-empty message"


@pytest.mark.integration
async def test_conversation_messages_api_returns_stored_response(real_db) -> None:
    """GET /v1/conversations/{id}/messages should return persisted messages."""
    import httpx

    from backend.infrastructure.session import InMemorySessionStore
    from backend.interfaces.fastapi_service import create_fastapi_app
    from backend.interfaces.public_api import RuntimeAPI

    runtime_api = RuntimeAPI(real_db, session_store=InMemorySessionStore())
    app = create_fastapi_app(runtime_api=runtime_api, db=real_db)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="https://test"
    ) as client:
        # Send a message to create a session
        resp = await client.post(
            "/v1/runtime",
            json={"text": "你好", "locale": "zh"},
            headers={"X-User-Id": "test-hydration-user", "X-User-Type": "human"},
        )
        assert resp.status_code == 200
        session_id = resp.json().get("session_id")

        if not session_id:
            pytest.skip("No session_id returned (greet_user is ephemeral)")
            return

        # Fetch messages
        msg_resp = await client.get(
            f"/v1/conversations/{session_id}/messages",
            headers={"X-User-Id": "test-hydration-user", "X-User-Type": "human"},
        )
        assert msg_resp.status_code == 200
        messages = msg_resp.json().get("messages", [])
        assert len(messages) >= 1, "should have at least the user message"


@pytest.mark.integration
async def test_conversations_list_api(real_db) -> None:
    """GET /v1/conversations should return conversation list."""
    import httpx

    from backend.infrastructure.session import InMemorySessionStore
    from backend.interfaces.fastapi_service import create_fastapi_app
    from backend.interfaces.public_api import RuntimeAPI

    runtime_api = RuntimeAPI(real_db, session_store=InMemorySessionStore())
    app = create_fastapi_app(runtime_api=runtime_api, db=real_db)

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="https://test"
    ) as client:
        resp = await client.get(
            "/v1/conversations",
            headers={"X-User-Id": "test-hydration-user", "X-User-Type": "human"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Should be a list (possibly empty for fresh testcontainer)
        assert isinstance(data, list) or "conversations" in data
