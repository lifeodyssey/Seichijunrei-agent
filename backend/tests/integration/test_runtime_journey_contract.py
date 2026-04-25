"""Runtime journey contract tests.

Tests that the runtime endpoint returns correct stage contracts for
frontend journey rendering. Uses httpx.AsyncClient with ASGITransport
to avoid TestClient event loop conflicts with asyncpg.

Endpoints under test:
  POST /v1/runtime
  GET  /v1/bangumi/popular
  GET  /v1/routes
  GET  /v1/conversations/{session_id}/messages
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.runtime_models import (
    ClarifyCandidateModel,
    ClarifyDataModel,
    ClarifyResponseModel,
    GreetingResponseModel,
    QADataModel,
)
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import RuntimeAPI

_HEADERS = {"X-User-Id": "test-contract", "X-User-Type": "human"}


def _make_clarify_result() -> AgentResult:
    output = ClarifyResponseModel(
        intent="clarify",
        message="你是指哪部凉宫？",
        data=ClarifyDataModel(
            status="needs_clarification",
            question="你是指哪部凉宫？",
            options=["凉宫春日的忧郁", "凉宫春日的消失"],
            candidates=[
                ClarifyCandidateModel(
                    title="凉宫春日的忧郁", spot_count=2, city="西宫"
                ),
                ClarifyCandidateModel(
                    title="凉宫春日的消失", spot_count=1, city="西宫"
                ),
            ],
        ),
    )
    return AgentResult(
        output=output,
        steps=[StepRecord(tool="clarify", success=True)],
        tool_state={},
    )


def _make_greet_result() -> AgentResult:
    output = GreetingResponseModel(
        intent="greet_user",
        message="你好！我可以帮你找动漫圣地。",
        data=QADataModel(message="你好！我可以帮你找动漫圣地。"),
    )
    return AgentResult(
        output=output,
        steps=[StepRecord(tool="greet_user", success=True)],
        tool_state={},
    )


def _build_app(tc_db: object) -> httpx.AsyncClient:
    """Build an async test client with mocked pipeline."""
    from backend.interfaces.fastapi_service import create_fastapi_app

    async def _fake_agent(**kwargs: object) -> AgentResult:
        text = str(kwargs.get("text", ""))
        if "凉宫" in text or "涼宮" in text:
            return _make_clarify_result()
        return _make_greet_result()

    runtime_api = RuntimeAPI(tc_db, session_store=InMemorySessionStore())
    app = create_fastapi_app(runtime_api=runtime_api, db=tc_db)
    app.state.runtime_api = runtime_api
    app.state.db_client = tc_db

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="https://test"), _fake_agent


@pytest.fixture
async def async_client(tc_db):
    client, fake_agent = _build_app(tc_db)
    with patch(
        "backend.interfaces.public_api.run_pilgrimage_agent",
        side_effect=fake_agent,
    ):
        async with client:
            yield client


# ── Clarify contract ──────────────────────────────────────────────────


@pytest.mark.integration
async def test_runtime_clarify_response_has_full_contract(async_client):
    resp = await async_client.post(
        "/v1/runtime", json={"text": "凉宫", "locale": "zh"}, headers=_HEADERS
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["intent"] == "clarify"
    assert payload["message"]
    assert payload["status"] == "needs_clarification"
    data = payload["data"]
    assert "question" in data
    assert "options" in data
    assert "candidates" in data
    assert isinstance(data["candidates"], list)


@pytest.mark.integration
async def test_runtime_clarify_candidate_has_required_fields(async_client):
    resp = await async_client.post(
        "/v1/runtime", json={"text": "涼宮", "locale": "zh"}, headers=_HEADERS
    )
    candidates = resp.json()["data"].get("candidates", [])
    assert len(candidates) >= 1
    c = candidates[0]
    assert "title" in c
    assert "cover_url" in c
    assert "spot_count" in c
    assert "city" in c


# ── Popular bangumi ───────────────────────────────────────────────────


@pytest.mark.integration
async def test_popular_bangumi_has_cover_and_titles(async_client):
    resp = await async_client.get("/v1/bangumi/popular", headers=_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "bangumi" in data
    if not data["bangumi"]:
        pytest.skip("No popular bangumi in testcontainer seed")
    item = data["bangumi"][0]
    assert "title" in item
    assert "cover_url" in item


# ── Routes ────────────────────────────────────────────────────────────


@pytest.mark.integration
async def test_route_history_loads(async_client):
    resp = await async_client.get("/v1/routes", headers=_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "routes" in data
    assert isinstance(data["routes"], list)


# ── Message quality ───────────────────────────────────────────────────


@pytest.mark.integration
async def test_message_is_not_static_template(async_client):
    resp = await async_client.post(
        "/v1/runtime", json={"text": "你好", "locale": "zh"}, headers=_HEADERS
    )
    msg = resp.json().get("message", "")
    assert msg, "message must be non-empty"
    static_patterns = [
        "該当する巡礼地が見つかりませんでした",
        "没有找到相关的巡礼地",
    ]
    assert msg not in static_patterns
