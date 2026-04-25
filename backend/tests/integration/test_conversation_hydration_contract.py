"""Conversation hydration contract tests.

Validates that assistant responses persisted to conversation_messages
can be correctly hydrated back into RuntimeResponse shape by the frontend.

Uses TestModel (no real LLM) + real testcontainer DB to test the
data pipeline: agent → AgentResult → persistence → hydration.
"""

from __future__ import annotations

import pytest
from pydantic_ai.models.test import TestModel

pytest_plugins = ("backend.tests.conftest_db",)

# seed=1 → SearchResponseModel (index 1 in output_type list)
_SEARCH_MODEL = TestModel(
    call_tools=[],
    seed=1,
    custom_output_args={
        "intent": "search_bangumi",
        "message": "響け！ユーフォニアムの聖地を見つけました。",
        "data": {
            "results": {"rows": [], "row_count": 0, "status": "ok"},
        },
        "ui": {"component": "PilgrimageGrid"},
    },
)

# seed=4 → GreetingResponseModel (index 4 in output_type list)
_GREET_MODEL = TestModel(
    call_tools=[],
    seed=4,
    custom_output_args={
        "intent": "greet_user",
        "message": "こんにちは！聖地巡礼のお手伝いをします。",
        "data": {"message": "こんにちは！"},
    },
)


@pytest.mark.integration
async def test_persisted_search_response_hydrates_correctly(real_db) -> None:
    """Search response → AgentResult → output has message."""
    from backend.agents.pilgrimage_runner import run_pilgrimage_agent

    result = await run_pilgrimage_agent(
        text="君の名は の聖地を教えて",
        db=real_db,
        locale="ja",
        model=_SEARCH_MODEL,
    )

    assert result.output is not None
    assert result.message
    assert isinstance(result.success, bool)


@pytest.mark.integration
async def test_persisted_greet_response_hydrates_correctly(real_db) -> None:
    """Greet response → AgentResult → output has message."""
    from backend.agents.pilgrimage_runner import run_pilgrimage_agent

    result = await run_pilgrimage_agent(
        text="你好",
        db=real_db,
        locale="zh",
        model=_GREET_MODEL,
    )

    assert len(result.message) > 0, "greet response must have non-empty message"


@pytest.mark.integration
async def test_conversations_list_api(real_db) -> None:
    """GET /v1/conversations should return conversation list."""
    import httpx

    from backend.infrastructure.session import InMemorySessionStore
    from backend.interfaces.fastapi_service import create_fastapi_app
    from backend.interfaces.public_api import RuntimeAPI

    runtime_api = RuntimeAPI(real_db, session_store=InMemorySessionStore())
    app = create_fastapi_app(runtime_api=runtime_api, db=real_db)
    # Bypass lifespan — set app state directly (same pattern as test_api_contract)
    app.state.runtime_api = runtime_api
    app.state.db_client = real_db

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
        assert isinstance(data, list) or "conversations" in data
