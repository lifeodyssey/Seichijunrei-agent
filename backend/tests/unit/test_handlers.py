"""Unit tests for backend.agents.handlers (resolve_anime, search_bangumi, answer_question)."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

from backend.agents.handlers.answer_question import execute, execute_clarify
from backend.agents.handlers.resolve_anime import execute as execute_resolve
from backend.agents.handlers.search_bangumi import execute as execute_search
from backend.agents.models import PlanStep, ToolName


def _step(tool: ToolName, params: dict[str, object] | None = None) -> PlanStep:
    return PlanStep(tool=tool, params=params or {})


# ---------------------------------------------------------------------------
# resolve_anime
# ---------------------------------------------------------------------------


class TestResolveAnime:
    async def test_db_hit(self) -> None:
        db = MagicMock()
        db.find_bangumi_by_title = AsyncMock(return_value="253")
        step = _step(ToolName.RESOLVE_ANIME, {"title": "Eupho"})

        result = await execute_resolve(step, {}, db, None)

        assert result["success"] is True
        assert result["data"]["bangumi_id"] == "253"
        assert result["data"]["title"] == "Eupho"
        db.find_bangumi_by_title.assert_awaited_once_with("Eupho")

    async def test_db_miss_api_hit(self) -> None:
        db = MagicMock()
        db.find_bangumi_by_title = AsyncMock(return_value=None)
        db.upsert_bangumi_title = AsyncMock()

        mock_gateway = MagicMock()
        mock_gateway.search_by_title = AsyncMock(return_value="999")

        step = _step(ToolName.RESOLVE_ANIME, {"title": "NewAnime"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result["success"] is True
        assert result["data"]["bangumi_id"] == "999"
        db.upsert_bangumi_title.assert_awaited_once_with("NewAnime", "999")

    async def test_both_miss(self) -> None:
        db = MagicMock()
        db.find_bangumi_by_title = AsyncMock(return_value=None)

        mock_gateway = MagicMock()
        mock_gateway.search_by_title = AsyncMock(return_value=None)

        step = _step(ToolName.RESOLVE_ANIME, {"title": "Unknown"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result["success"] is False
        assert "error" in result
        assert "Unknown" in result["error"]

    async def test_no_title_provided(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result["success"] is False
        assert result["error"] == "No title provided"

    async def test_empty_title_string(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {"title": ""})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result["success"] is False

    async def test_non_string_title(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {"title": 123})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result["success"] is False


# ---------------------------------------------------------------------------
# search_bangumi
# ---------------------------------------------------------------------------


@dataclass
class FakeRetrievalResult:
    success: bool
    rows: list[dict[str, object]]
    row_count: int
    error: str | None = None
    metadata: dict[str, object] | None = None
    strategy: object = None

    def __post_init__(self) -> None:
        if self.metadata is None:
            self.metadata = {}
        if self.strategy is None:
            from backend.agents.retriever import RetrievalStrategy

            self.strategy = RetrievalStrategy.SQL


class TestSearchBangumi:
    async def test_returns_results(self) -> None:
        fake_result = FakeRetrievalResult(
            success=True,
            rows=[{"id": "p1", "bangumi_id": "253"}],
            row_count=1,
        )
        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_result)

        step = _step(ToolName.SEARCH_BANGUMI, {"bangumi_id": "253"})
        result = await execute_search(step, {}, MagicMock(), retriever)

        assert result["success"] is True
        assert result["data"]["row_count"] == 1

    async def test_returns_empty(self) -> None:
        fake_result = FakeRetrievalResult(
            success=True,
            rows=[],
            row_count=0,
        )
        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_result)

        step = _step(ToolName.SEARCH_BANGUMI, {"bangumi_id": "999"})
        result = await execute_search(step, {}, MagicMock(), retriever)

        assert result["success"] is True
        assert result["data"]["row_count"] == 0
        assert result["data"]["status"] == "empty"

    async def test_no_bangumi_id_fails(self) -> None:
        step = _step(ToolName.SEARCH_BANGUMI, {})
        result = await execute_search(step, {}, MagicMock(), MagicMock())

        assert result["success"] is False
        assert "No bangumi_id" in result["error"]

    async def test_inherits_bangumi_id_from_context(self) -> None:
        fake_result = FakeRetrievalResult(
            success=True,
            rows=[{"id": "p1"}],
            row_count=1,
        )
        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_result)

        context = {"resolve_anime": {"bangumi_id": "253"}}
        step = _step(ToolName.SEARCH_BANGUMI, {})
        result = await execute_search(step, context, MagicMock(), retriever)

        assert result["success"] is True


# ---------------------------------------------------------------------------
# answer_question
# ---------------------------------------------------------------------------


class TestAnswerQuestion:
    async def test_returns_correct_shape(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {"answer": "42 is the answer"})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result["tool"] == "answer_question"
        assert result["success"] is True
        assert result["data"]["message"] == "42 is the answer"
        assert result["data"]["status"] == "info"

    async def test_empty_answer(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result["success"] is True
        assert result["data"]["message"] == ""

    async def test_no_params(self) -> None:
        step = PlanStep(tool=ToolName.ANSWER_QUESTION)
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result["success"] is True


class TestClarify:
    async def test_returns_clarification(self) -> None:
        step = _step(
            ToolName.CLARIFY,
            {"question": "Which one?", "options": ["A", "B"]},
        )
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result["tool"] == "clarify"
        assert result["success"] is True
        assert result["data"]["question"] == "Which one?"
        assert result["data"]["options"] == ["A", "B"]
        assert result["data"]["status"] == "needs_clarification"

    async def test_empty_clarify(self) -> None:
        step = _step(ToolName.CLARIFY, {})
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result["success"] is True
        assert result["data"]["question"] == ""
        assert result["data"]["options"] == []
