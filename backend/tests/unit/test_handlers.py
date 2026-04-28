"""Unit tests for backend.agents.handlers (resolve_anime, search_bangumi, answer_question)."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.handlers._base_search import execute_retrieval, resolve_bangumi_id
from backend.agents.handlers._helpers import build_query_payload, optimize_route
from backend.agents.handlers.answer_question import execute, execute_clarify
from backend.agents.handlers.plan_route import execute as execute_plan_route
from backend.agents.handlers.resolve_anime import execute as execute_resolve
from backend.agents.handlers.result import HandlerResult
from backend.agents.handlers.search_bangumi import execute as execute_search
from backend.agents.models import PlanStep, RetrievalRequest, ToolName
from backend.agents.retriever import RetrievalStrategy
from backend.infrastructure.supabase.client import SupabaseClient


def _step(tool: ToolName, params: dict[str, object] | None = None) -> PlanStep:
    return PlanStep(tool=tool, params=params or {})


# ---------------------------------------------------------------------------
# _base_search
# ---------------------------------------------------------------------------


@dataclass
class _FakeResult:
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


class TestBaseSearch:
    async def test_returns_success_dict(self) -> None:
        fake = _FakeResult(success=True, rows=[{"id": "p1"}], row_count=1)
        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake)
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="253")

        result = await execute_retrieval(req, retriever)

        assert result.tool == "search_bangumi"
        assert result.success is True
        assert result.data["row_count"] == 1

    async def test_returns_failure_dict(self) -> None:
        fake = _FakeResult(success=False, rows=[], row_count=0, error="not found")
        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake)
        req = RetrievalRequest(tool="search_nearby", location="Kyoto")

        result = await execute_retrieval(req, retriever)

        assert result.tool == "search_nearby"
        assert result.success is False
        assert result.error == "not found"

    def test_resolve_bangumi_id_from_params(self) -> None:
        result = resolve_bangumi_id({"bangumi_id": "253"}, {})
        assert result == "253"

    def test_resolve_bangumi_id_from_context(self) -> None:
        result = resolve_bangumi_id({}, {"resolve_anime": {"bangumi_id": "999"}})
        assert result == "999"

    def test_resolve_bangumi_id_returns_none_when_missing(self) -> None:
        result = resolve_bangumi_id({}, {})
        assert result is None

    def test_resolve_bangumi_id_params_takes_precedence(self) -> None:
        result = resolve_bangumi_id(
            {"bangumi_id": "111"},
            {"resolve_anime": {"bangumi_id": "999"}},
        )
        assert result == "111"


# ---------------------------------------------------------------------------
# resolve_anime
# ---------------------------------------------------------------------------


def _mock_supabase() -> MagicMock:
    return MagicMock(spec=SupabaseClient)


class TestResolveAnime:
    async def test_db_hit(self) -> None:
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "id": "253",
                    "title": "Eupho",
                    "title_cn": "",
                    "cover_url": "",
                    "city": "",
                    "points_count": 5,
                }
            ]
        )
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value="253")
        db.bangumi.upsert_bangumi_title = AsyncMock()

        mock_gateway = MagicMock()
        mock_gateway.search_subject = AsyncMock(return_value=[])
        step = _step(ToolName.RESOLVE_ANIME, {"title": "Eupho"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result.success is True
        assert result.data["bangumi_id"] == "253"
        assert result.data["title"] == "Eupho"
        assert "candidates" in result.data

    async def test_db_ambiguous(self) -> None:
        """Multiple DB matches should return ambiguous signal."""
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "id": "1",
                    "title": "涼宮ハルヒの憂鬱",
                    "title_cn": "凉宫春日的忧郁",
                    "cover_url": "",
                    "city": "西宮市",
                    "points_count": 12,
                },
                {
                    "id": "2",
                    "title": "涼宮ハルヒの消失",
                    "title_cn": "凉宫春日的消失",
                    "cover_url": "",
                    "city": "西宮市",
                    "points_count": 8,
                },
            ]
        )
        step = _step(ToolName.RESOLVE_ANIME, {"title": "凉宫"})

        # DB already has >1 match → returns ambiguous before hitting API
        result = await execute_resolve(step, {}, db, None)

        assert result.success is True
        assert result.data["ambiguous"] is True
        assert len(result.data["candidates"]) >= 2
        assert result.data["candidates"][0]["title"] == "涼宮ハルヒの憂鬱"

    async def test_api_enrichment_detects_ambiguity(self) -> None:
        """Single DB match + multiple API results → ambiguous."""
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[{"id": "1", "title": "Fate/stay night"}]
        )
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value="1")

        mock_gateway = MagicMock()
        mock_gateway.search_subject = AsyncMock(
            return_value=[
                {"id": "1", "name": "Fate/stay night"},
                {"id": "2", "name": "Fate/Zero"},
                {"id": "3", "name": "Fate/Grand Order"},
            ]
        )
        step = _step(ToolName.RESOLVE_ANIME, {"title": "fate"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result.success is True
        assert result.data["ambiguous"] is True
        assert len(result.data["candidates"]) == 3

    async def test_db_miss_api_hit(self) -> None:
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)
        db.bangumi.upsert_bangumi_title = AsyncMock()

        mock_gateway = MagicMock()
        mock_gateway.search_subject = AsyncMock(
            return_value=[{"id": "999", "name": "NewAnime"}]
        )
        step = _step(ToolName.RESOLVE_ANIME, {"title": "NewAnime"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result.success is True
        assert result.data["bangumi_id"] == "999"
        db.bangumi.upsert_bangumi_title.assert_awaited_once_with("NewAnime", "999")

    async def test_both_miss(self) -> None:
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)

        mock_gateway = MagicMock()
        mock_gateway.search_subject = AsyncMock(return_value=[])
        step = _step(ToolName.RESOLVE_ANIME, {"title": "Unknown"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gateway,
        ):
            result = await execute_resolve(step, {}, db, None)

        assert result.success is False
        assert result.error is not None
        assert "Unknown" in result.error

    async def test_no_title_provided(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result.success is False
        assert result.error == "No title provided"

    async def test_empty_title_string(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {"title": ""})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result.success is False

    async def test_non_string_title(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {"title": 123})
        result = await execute_resolve(step, {}, MagicMock(), None)

        assert result.success is False

    async def test_non_supabase_db_returns_failure(self) -> None:
        step = _step(ToolName.RESOLVE_ANIME, {"title": "Eupho"})
        result = await execute_resolve(step, {}, object(), None)

        assert result.success is False
        assert result.error == "DB not available"


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


class TestResolveAnimeClarifyFastPath:
    """AC: resolve_anime matches title against previous clarify candidates."""

    async def test_exact_match_returns_bangumi_id(self) -> None:
        context: dict[str, object] = {
            "pending_clarify": True,
            "resolve_candidates": [
                {
                    "title": "涼宮ハルヒの憂鬱",
                    "bangumi_id": "100",
                    "cover_url": "",
                    "city": "",
                },
                {
                    "title": "涼宮ハルヒの消失",
                    "bangumi_id": "101",
                    "cover_url": "",
                    "city": "",
                },
            ],
        }
        step = _step(ToolName.RESOLVE_ANIME, {"title": "涼宮ハルヒの憂鬱"})

        result = await execute_resolve(step, context, MagicMock(), None)

        assert result.success is True
        assert result.data["bangumi_id"] == "100"
        assert result.data["title"] == "涼宮ハルヒの憂鬱"

    async def test_no_pending_clarify_skips_fast_path(self) -> None:
        """Without pending_clarify flag, candidates are not checked."""
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)
        db.bangumi.upsert_bangumi_title = AsyncMock()

        context: dict[str, object] = {
            "resolve_candidates": [
                {"title": "涼宮ハルヒの憂鬱", "bangumi_id": "100"},
            ],
        }
        mock_gw = MagicMock()
        mock_gw.search_subject = AsyncMock(return_value=[])
        step = _step(ToolName.RESOLVE_ANIME, {"title": "涼宮ハルヒの憂鬱"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gw,
        ):
            result = await execute_resolve(step, context, db, None)

        # Falls through to normal path (no DB/API match → fail)
        assert result.success is False

    async def test_no_match_falls_through(self) -> None:
        """Title not in candidates → normal resolve path."""
        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)
        db.bangumi.upsert_bangumi_title = AsyncMock()

        context: dict[str, object] = {
            "pending_clarify": True,
            "resolve_candidates": [
                {"title": "涼宮ハルヒの憂鬱", "bangumi_id": "100"},
            ],
        }
        mock_gw = MagicMock()
        mock_gw.search_subject = AsyncMock(return_value=[])
        step = _step(ToolName.RESOLVE_ANIME, {"title": "完全別の作品"})

        with patch(
            "backend.agents.handlers.resolve_anime.BangumiClientGateway",
            return_value=mock_gw,
        ):
            result = await execute_resolve(step, context, db, None)

        # Falls through — not in candidates, no DB/API match
        assert result.success is False

    async def test_case_insensitive_match(self) -> None:
        context: dict[str, object] = {
            "pending_clarify": True,
            "resolve_candidates": [
                {
                    "title": "Your Name",
                    "bangumi_id": "200",
                    "cover_url": "",
                    "city": "",
                },
            ],
        }
        step = _step(ToolName.RESOLVE_ANIME, {"title": "your name"})

        result = await execute_resolve(step, context, MagicMock(), None)

        assert result.success is True
        assert result.data["bangumi_id"] == "200"


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

        assert result.success is True
        assert result.data["row_count"] == 1

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

        assert result.success is True
        assert result.data["row_count"] == 0
        assert result.data["status"] == "empty"

    async def test_no_bangumi_id_fails(self) -> None:
        step = _step(ToolName.SEARCH_BANGUMI, {})
        result = await execute_search(step, {}, MagicMock(), MagicMock())

        assert result.success is False
        assert result.error is not None
        assert "No bangumi_id" in result.error

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

        assert result.success is True


# ---------------------------------------------------------------------------
# answer_question
# ---------------------------------------------------------------------------


class TestAnswerQuestion:
    async def test_returns_correct_shape(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {"answer": "42 is the answer"})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.tool == "answer_question"
        assert result.success is True
        assert result.data["message"] == "42 is the answer"
        assert result.data["status"] == "info"

    async def test_empty_answer(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.success is True
        assert result.data["message"] == ""

    async def test_no_params(self) -> None:
        step = PlanStep(tool=ToolName.ANSWER_QUESTION)
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.success is True


# ---------------------------------------------------------------------------
# plan_route — coordinate origin path
# ---------------------------------------------------------------------------

_SAMPLE_ROWS = [
    {"id": "p1", "name": "Spot A", "latitude": 34.88, "longitude": 135.80},
    {"id": "p2", "name": "Spot B", "latitude": 34.89, "longitude": 135.81},
]


class TestPlanRouteCoordinateOrigin:
    async def test_coordinate_origin_skips_resolve_location(self) -> None:
        """When origin_lat/origin_lng are in context, resolve_location is NOT called."""
        step = _step(ToolName.PLAN_ROUTE, {})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _SAMPLE_ROWS},
            "origin_lat": 34.9,
            "origin_lng": 135.8,
        }

        with patch(
            "backend.agents.handlers.plan_route.resolve_location"
        ) as mock_resolve:
            result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        mock_resolve.assert_not_called()
        assert result.success is True
        assert result.data["cover_url"] is None

    async def test_coordinate_origin_takes_precedence_over_text_origin(self) -> None:
        """Coordinate origin takes precedence when both are present."""
        step = _step(ToolName.PLAN_ROUTE, {"origin": "京都駅"})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _SAMPLE_ROWS},
            "origin_lat": 34.9,
            "origin_lng": 135.8,
        }

        with patch(
            "backend.agents.handlers.plan_route.resolve_location"
        ) as mock_resolve:
            result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        mock_resolve.assert_not_called()
        assert result.success is True

    async def test_text_origin_still_used_when_no_coords(self) -> None:
        """When no coordinate origin, text origin is still resolved (existing path)."""
        step = _step(ToolName.PLAN_ROUTE, {"origin": "宇治駅"})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _SAMPLE_ROWS},
        }

        with patch(
            "backend.agents.handlers.plan_route.resolve_location",
            new=AsyncMock(return_value=None),
        ) as mock_resolve:
            result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        mock_resolve.assert_awaited_once()
        assert result.success is True

    async def test_no_rows_returns_error_regardless_of_coords(self) -> None:
        """No rows → error even when coords are present."""
        step = _step(ToolName.PLAN_ROUTE, {})
        context: dict[str, object] = {
            "origin_lat": 34.9,
            "origin_lng": 135.8,
        }

        result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        assert result.success is False
        assert result.error is not None
        assert "No points to route" in result.error

    async def test_coordinate_origin_passed_as_string_to_optimize_route(self) -> None:
        """Finding 7: coordinate origin is forwarded as 'lat,lng' string, not discarded."""
        from unittest.mock import patch as _patch

        step = _step(ToolName.PLAN_ROUTE, {})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _SAMPLE_ROWS},
            "origin_lat": 34.9,
            "origin_lng": 135.8,
        }

        captured: list[tuple[object, ...]] = []

        def _fake_optimize(
            rows: object,
            params: object,
            origin: object,
            tool_name: str = "plan_route",
        ) -> HandlerResult:
            captured.append((rows, params, origin, tool_name))
            return HandlerResult(
                tool="plan_route",
                success=True,
                data={"ordered_points": []},
            )

        with _patch(
            "backend.agents.handlers.plan_route.optimize_route",
            side_effect=_fake_optimize,
        ):
            await execute_plan_route(step, context, MagicMock(), MagicMock())

        assert len(captured) == 1
        _, _, origin, _ = captured[0]
        assert origin == "34.9,135.8"

    async def test_ambiguous_origin_returns_structured_candidates(self) -> None:
        step = _step(ToolName.PLAN_ROUTE, {"origin": "宇治駅"})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _SAMPLE_ROWS},
        }
        candidates = [
            MagicMock(label="宇治駅（京阪）"),
            MagicMock(label="宇治駅（JR）"),
        ]

        with patch(
            "backend.agents.handlers.plan_route.resolve_location",
            new=AsyncMock(return_value=candidates),
        ):
            result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        assert result.tool == "clarify"
        assert result.data["status"] == "needs_clarification"
        assert result.data["options"] == ["宇治駅（京阪）", "宇治駅（JR）"]
        assert result.data["candidates"][0]["title"] == "宇治駅（京阪）"
        assert "cover_url" in result.data["candidates"][0]


class TestClarify:
    async def test_returns_clarification(self) -> None:
        step = _step(
            ToolName.CLARIFY,
            {"question": "Which one?", "options": ["A", "B"]},
        )
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.tool == "clarify"
        assert result.success is True
        assert result.data["question"] == "Which one?"
        assert result.data["options"] == ["A", "B"]
        assert result.data["status"] == "needs_clarification"
        assert result.data["candidates"][0]["title"] == "A"
        assert result.data["candidates"][1]["title"] == "B"

    async def test_empty_clarify(self) -> None:
        step = _step(ToolName.CLARIFY, {})
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.success is True
        assert result.data["question"] == ""
        assert result.data["options"] == []
        assert result.data["candidates"] == []

    async def test_explicit_candidates_are_preserved(self) -> None:
        step = _step(
            ToolName.CLARIFY,
            {
                "question": "Which one?",
                "options": ["A"],
                "candidates": [
                    {
                        "title": "Custom A",
                        "cover_url": "https://example.com/a.jpg",
                        "spot_count": 3,
                        "city": "Uji",
                    }
                ],
            },
        )
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.data["candidates"][0]["title"] == "Custom A"
        assert result.data["candidates"][0]["spot_count"] == 3


class TestQueryPayload:
    def test_build_query_payload_includes_nearby_groups(self) -> None:
        payload = build_query_payload(
            _FakeResult(
                success=True,
                row_count=2,
                rows=[
                    {
                        "id": "p1",
                        "bangumi_id": "120632",
                        "title": "響け！ユーフォニアム",
                        "cover_url": "https://example.com/eupho.jpg",
                        "distance_m": 100.0,
                    },
                    {
                        "id": "p2",
                        "bangumi_id": "120632",
                        "title": "響け！ユーフォニアム",
                        "cover_url": "https://example.com/eupho.jpg",
                        "distance_m": 250.0,
                    },
                ],
                metadata={"radius_m": 5000},
                strategy=RetrievalStrategy.GEO,
            )
        )

        assert payload["metadata"]["radius_m"] == 5000
        assert payload["nearby_groups"][0]["bangumi_id"] == "120632"
        assert payload["nearby_groups"][0]["points_count"] == 2
        assert payload["nearby_groups"][0]["closest_distance_m"] == pytest.approx(100.0)


class TestOptimizeRoute:
    def test_optimize_route_includes_cover_url(self) -> None:
        result = optimize_route(
            [
                {
                    "id": "p1",
                    "name": "Spot A",
                    "latitude": 34.88,
                    "longitude": 135.80,
                    "cover_url": "https://example.com/cover.jpg",
                },
                {
                    "id": "p2",
                    "name": "Spot B",
                    "latitude": 34.89,
                    "longitude": 135.81,
                },
            ],
            {},
            None,
        )

        assert result.success is True
        assert result.data["cover_url"] == "https://example.com/cover.jpg"


# ---------------------------------------------------------------------------
# _run_handler — SSE error detail
# ---------------------------------------------------------------------------


class TestRunHandlerEmitsErrorDetail:
    """When a handler fails, the SSE step event must include error detail."""

    async def test_emits_error_in_step_data_on_failure(self) -> None:
        from backend.agents.pilgrimage_tools import _run_handler

        emitted: list[tuple[str, str, dict[str, object], str, str]] = []

        async def fake_on_step(
            tool: str,
            status: str,
            data: dict[str, object],
            thought: str = "",
            observation: str = "",
        ) -> None:
            emitted.append((tool, status, data, thought, observation))

        deps = MagicMock()
        deps.on_step = fake_on_step
        deps.tool_state = {}
        deps.steps = []
        deps.retriever = None
        deps.db = MagicMock()

        ctx = MagicMock()
        ctx.deps = deps

        error_msg = "Validation failed: missing bangumi_id"

        async def failing_handler(
            step: object, state: object, db: object, retriever: object
        ) -> HandlerResult:
            return HandlerResult.fail("plan_route", error_msg)

        await _run_handler(
            ctx,
            tool=ToolName.PLAN_ROUTE,
            params={},
            handler=failing_handler,
        )

        failed_events = [
            (t, s, d, th, obs) for t, s, d, th, obs in emitted if s == "failed"
        ]
        assert len(failed_events) == 1

        _, _, data, _, observation = failed_events[0]
        assert data["error"] == error_msg
        assert observation == error_msg

    async def test_emits_error_preserves_partial_data(self) -> None:
        from backend.agents.pilgrimage_tools import _run_handler

        emitted: list[tuple[str, str, dict[str, object], str, str]] = []

        async def fake_on_step(
            tool: str,
            status: str,
            data: dict[str, object],
            thought: str = "",
            observation: str = "",
        ) -> None:
            emitted.append((tool, status, data, thought, observation))

        deps = MagicMock()
        deps.on_step = fake_on_step
        deps.tool_state = {}
        deps.steps = []
        deps.retriever = None
        deps.db = MagicMock()

        ctx = MagicMock()
        ctx.deps = deps

        async def failing_handler_with_data(
            step: object, state: object, db: object, retriever: object
        ) -> HandlerResult:
            return HandlerResult(
                tool="resolve_anime",
                success=False,
                data={"partial": "data"},
                error="Could not resolve",
            )

        await _run_handler(
            ctx,
            tool=ToolName.RESOLVE_ANIME,
            params={"title": "unknown"},
            handler=failing_handler_with_data,
        )

        failed_events = [
            (t, s, d, th, obs) for t, s, d, th, obs in emitted if s == "failed"
        ]
        assert len(failed_events) == 1

        _, _, data, _, observation = failed_events[0]
        assert data["error"] == "Could not resolve"
        assert data["partial"] == "data"
        assert observation == "Could not resolve"


# ---------------------------------------------------------------------------
# plan_route — LLM area splitting (Phase 2)
# ---------------------------------------------------------------------------

_LARGE_SAMPLE_ROWS = [
    {
        "id": f"p{i}",
        "name": f"Spot {i}",
        "latitude": 35.0 + i * 0.01,
        "longitude": 139.0 + i * 0.01,
    }
    for i in range(15)
]


class TestPlanRouteAreaSplitting:
    async def test_uses_area_splitting_for_large_sets(self) -> None:
        from backend.agents.route_area_splitter import AreaGroup, AreaSplitResult

        split_result = AreaSplitResult(
            areas=[
                AreaGroup(
                    name="Area A",
                    station="Station A",
                    point_indices=list(range(8)),
                ),
                AreaGroup(
                    name="Area B",
                    station="Station B",
                    point_indices=list(range(8, 15)),
                ),
            ],
            recommended_order=[0, 1],
        )

        step = _step(ToolName.PLAN_ROUTE, {})
        context: dict[str, object] = {
            "search_bangumi": {"rows": _LARGE_SAMPLE_ROWS},
        }

        with (
            patch(
                "backend.agents.handlers.plan_route.split_into_areas",
                new=AsyncMock(return_value=split_result),
            ),
            patch(
                "backend.agents.handlers.plan_route.resolve_location",
                new=AsyncMock(return_value=None),
            ),
        ):
            result = await execute_plan_route(step, context, MagicMock(), MagicMock())

        assert result.success is True
        assert "areas" in result.data
        assert result.data["source"] == "llm"
        assert result.data["total_areas"] == 2
