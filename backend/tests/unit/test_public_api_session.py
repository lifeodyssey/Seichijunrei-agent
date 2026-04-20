"""Unit tests for session state, context extraction, and compact logic."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import (
    _build_context_block,
)


def _make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    steps: list[PlanStep] | None = None,
    final_output: dict | None = None,
) -> PipelineResult:
    """Build a fake PipelineResult for tests that mock run_pipeline."""
    plan = ExecutionPlan(
        reasoning="test",
        locale=locale,
        steps=steps
        or [PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "123"})],
    )
    result = PipelineResult(intent=intent, plan=plan)
    result.final_output = final_output or {
        "success": True,
        "status": "empty",
        "message": "該当する巡礼地が見つかりませんでした。",
        "results": {"rows": [], "row_count": 0},
    }
    return result


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    """Mock run_pipeline — the ReActPlannerAgent requires an LLM."""

    async def _fake(text, db, *, model=None, locale="ja", context=None, on_step=None):
        return _make_result(locale=locale)

    monkeypatch.setattr("backend.interfaces.public_api.run_pipeline", _fake)


class TestContextExtraction:
    def test_extract_context_delta_from_resolve_anime(self) -> None:
        result = _make_result(
            steps=[
                PlanStep(
                    tool=ToolName.RESOLVE_ANIME,
                    params={"title": "響け！ユーフォニアム"},
                )
            ]
        )
        result.step_results = [
            StepResult(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": "253", "title": "響け！ユーフォニアム"},
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta["bangumi_id"] == "253"
        assert delta["anime_title"] == "響け！ユーフォニアム"
        assert delta.get("location") is None

    def test_extract_context_delta_from_search_nearby(self) -> None:
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治"})],
            reasoning="test",
            locale="ja",
        )
        result = PipelineResult(intent="search_nearby", plan=plan)
        result.step_results = [
            StepResult(
                tool="search_nearby",
                success=True,
                data={"rows": []},
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta["location"] == "宇治"
        assert delta.get("bangumi_id") is None

    def test_extract_context_delta_empty_on_failure(self) -> None:
        result = _make_result()
        result.step_results = [
            StepResult(
                tool="resolve_anime",
                success=False,
                error="not found",
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta == {}

    def test_build_context_block_from_interactions(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "京吹",
                    "intent": "search_bangumi",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:00:00",
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け！ユーフォニアム",
                        "location": None,
                    },
                },
                {
                    "text": "附近",
                    "intent": "search_nearby",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:01:00",
                    "context_delta": {
                        "bangumi_id": None,
                        "anime_title": None,
                        "location": "宇治",
                    },
                },
            ],
            "last_intent": "search_nearby",
        }

        from backend.interfaces.public_api import _build_context_block

        block = _build_context_block(state)
        assert block["current_bangumi_id"] == "253"
        assert block["current_anime_title"] == "響け！ユーフォニアム"
        assert block["last_location"] == "宇治"
        assert block["last_intent"] == "search_nearby"
        assert "253" in block["visited_bangumi_ids"]

    def test_build_context_block_returns_none_when_empty(self) -> None:
        from backend.interfaces.public_api import _build_context_block

        assert _build_context_block({"interactions": [], "last_intent": None}) is None


class TestCompact:
    async def test_compact_replaces_old_interactions_with_summary(self) -> None:
        from backend.interfaces.public_api import _compact_session_interactions

        store = InMemorySessionStore()
        session_id = "sess-compact"
        interactions = [
            {
                "text": f"query {index}",
                "intent": "search_bangumi",
                "status": "ok",
                "success": True,
                "created_at": "2026-04-01T00:00:00Z",
                "context_delta": {},
            }
            for index in range(8)
        ]
        state = {
            "interactions": interactions,
            "route_history": [],
            "last_intent": "search_bangumi",
            "last_status": "ok",
            "last_message": "",
            "summary": None,
            "updated_at": "2026-04-01T00:00:00Z",
        }

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(
            return_value=MagicMock(output="ユーザーは複数のアニメ聖地を検索しました。")
        )

        with patch(
            "backend.interfaces.session_facade.create_agent", return_value=mock_agent
        ):
            await _compact_session_interactions(session_id, state, store)

        saved = await store.get(session_id)
        assert saved is not None
        assert len(saved["interactions"]) == 2
        assert saved["summary"] == "ユーザーは複数のアニメ聖地を検索しました。"

    async def test_compact_skips_when_fewer_than_8(self) -> None:
        from backend.interfaces.public_api import _compact_session_interactions

        store = InMemorySessionStore()
        state = {
            "interactions": [
                {
                    "text": "q",
                    "intent": "search_bangumi",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:00:00Z",
                    "context_delta": {},
                }
            ]
            * 5,
            "summary": None,
        }

        with patch("backend.interfaces.session_facade.create_agent") as create_agent:
            await _compact_session_interactions("sess-short", state, store)

        create_agent.assert_not_called()

    def test_build_context_block_includes_summary(self) -> None:
        state = {
            "interactions": [
                {
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け",
                        "location": "宇治",
                    }
                }
            ],
            "summary": "ユーザーは京吹の聖地を検索しました。",
        }

        block = _build_context_block(state)

        assert block is not None
        assert block["summary"] == "ユーザーは京吹の聖地を検索しました。"

    def test_build_context_block_returns_summary_only_context(self) -> None:
        block = _build_context_block({"interactions": [], "summary": "old summary"})

        assert block == {
            "current_bangumi_id": None,
            "current_anime_title": None,
            "last_location": None,
            "last_intent": None,
            "visited_bangumi_ids": [],
            "summary": "old summary",
        }


class TestBuildContextBlockWithUserMemory:
    def test_merges_cross_session_visited_ids(self):
        session_state = {
            "interactions": [
                {
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け",
                        "location": None,
                    }
                }
            ],
            "last_intent": "search_bangumi",
        }
        user_memory = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "君の名は", "last_at": "2026-03-01"},
                {"bangumi_id": "253", "title": "響け", "last_at": "2026-04-01"},
            ]
        }

        block = _build_context_block(session_state, user_memory=user_memory)

        assert block is not None
        assert "105" in block["visited_bangumi_ids"]
        assert block["visited_bangumi_ids"].count("253") == 1

    def test_returns_none_when_no_context_and_no_user_memory(self):
        assert _build_context_block({"interactions": []}, user_memory=None) is None
