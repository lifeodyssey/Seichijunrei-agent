"""Unit tests for inline tool logic in pilgrimage_tools.

After collapsing trivial handlers, greet_user, general_qa, search_bangumi,
and search_nearby execute their logic directly inside the tool registration
(same pattern as clarify) instead of delegating to a handler module.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

# ---------------------------------------------------------------------------
# Helpers — fake RuntimeDeps-like object for tool tests
# ---------------------------------------------------------------------------


def _make_deps(
    *,
    tool_state: dict[str, object] | None = None,
    on_step: object | None = "auto",
) -> MagicMock:
    """Build a minimal deps mock that satisfies _emit_step / _record_step."""
    deps = MagicMock()
    deps.tool_state = tool_state if tool_state is not None else {}
    deps.steps = []
    deps.retriever = None
    deps.db = MagicMock()

    emitted: list[tuple[str, str, dict[str, object], str, str]] = []

    async def fake_on_step(
        tool: str,
        status: str,
        data: dict[str, object],
        thought: str = "",
        observation: str = "",
    ) -> None:
        emitted.append((tool, status, data, thought, observation))

    if on_step == "auto":
        deps.on_step = fake_on_step
    else:
        deps.on_step = on_step
    deps._emitted = emitted
    return deps


def _make_ctx(deps: MagicMock) -> MagicMock:
    ctx = MagicMock()
    ctx.deps = deps
    return ctx


# ---------------------------------------------------------------------------
# Slice 1: greet_user inline
# ---------------------------------------------------------------------------


class TestGreetUserInline:
    """greet_user tool returns ephemeral greeting without handler module."""

    async def test_returns_message_and_info_status(self) -> None:
        from backend.agents.pilgrimage_tools import greet_user

        deps = _make_deps()
        ctx = _make_ctx(deps)

        result = await greet_user(ctx, message="Hello!")

        assert result == {"message": "Hello!", "status": "info"}

    async def test_records_step(self) -> None:
        from backend.agents.pilgrimage_tools import greet_user

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await greet_user(ctx, message="Hi")

        assert len(deps.steps) == 1
        step = deps.steps[0]
        assert step.tool == "greet_user"
        assert step.success is True
        assert step.params == {"message": "Hi"}
        assert step.data == {"message": "Hi", "status": "info"}

    async def test_updates_tool_state(self) -> None:
        from backend.agents.pilgrimage_tools import greet_user

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await greet_user(ctx, message="Hey")

        assert deps.tool_state["greet_user"] == {"message": "Hey", "status": "info"}

    async def test_emits_running_and_done_steps(self) -> None:
        from backend.agents.pilgrimage_tools import greet_user

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await greet_user(ctx, message="Yo")

        emitted = deps._emitted
        assert len(emitted) == 2
        assert emitted[0][0] == "greet_user"
        assert emitted[0][1] == "running"
        assert emitted[1][0] == "greet_user"
        assert emitted[1][1] == "done"
        assert emitted[1][2] == {"message": "Yo", "status": "info"}

    async def test_works_without_on_step(self) -> None:
        from backend.agents.pilgrimage_tools import greet_user

        deps = _make_deps(on_step=None)
        ctx = _make_ctx(deps)

        result = await greet_user(ctx, message="Silent")

        assert result == {"message": "Silent", "status": "info"}


# ---------------------------------------------------------------------------
# Slice 2: general_qa inline
# ---------------------------------------------------------------------------


class TestGeneralQAInline:
    """general_qa tool returns QA answer without handler module."""

    async def test_returns_answer_and_info_status(self) -> None:
        from backend.agents.pilgrimage_tools import general_qa

        deps = _make_deps()
        ctx = _make_ctx(deps)

        result = await general_qa(ctx, answer="Be respectful at shrines.")

        assert result == {"message": "Be respectful at shrines.", "status": "info"}

    async def test_records_step(self) -> None:
        from backend.agents.pilgrimage_tools import general_qa

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await general_qa(ctx, answer="Tip: bring a camera")

        assert len(deps.steps) == 1
        step = deps.steps[0]
        assert step.tool == "answer_question"
        assert step.success is True
        assert step.params == {"answer": "Tip: bring a camera"}
        assert step.data == {"message": "Tip: bring a camera", "status": "info"}

    async def test_updates_tool_state(self) -> None:
        from backend.agents.pilgrimage_tools import general_qa

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await general_qa(ctx, answer="Visit early morning.")

        assert deps.tool_state["answer_question"] == {
            "message": "Visit early morning.",
            "status": "info",
        }

    async def test_emits_running_and_done_steps(self) -> None:
        from backend.agents.pilgrimage_tools import general_qa

        deps = _make_deps()
        ctx = _make_ctx(deps)

        await general_qa(ctx, answer="Answer")

        emitted = deps._emitted
        assert len(emitted) == 2
        assert emitted[0][1] == "running"
        assert emitted[1][1] == "done"


# ---------------------------------------------------------------------------
# Slice 3: search_bangumi inline
# ---------------------------------------------------------------------------


class TestSearchBangumiInline:
    """search_bangumi tool inlines handler logic (resolve_bangumi_id + retrieval)."""

    async def test_calls_retriever_with_bangumi_id(self) -> None:
        from backend.agents.pilgrimage_tools import search_bangumi

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="sql")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps(tool_state={"resolve_anime": {"bangumi_id": "253"}})
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        result = await search_bangumi(ctx, bangumi_id="253")

        assert isinstance(result, dict)
        # Should have called the retriever
        retriever.execute.assert_awaited_once()

    async def test_records_step_on_success(self) -> None:
        from backend.agents.pilgrimage_tools import search_bangumi

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="sql")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps(tool_state={})
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_bangumi(ctx, bangumi_id="253")

        assert len(deps.steps) == 1
        step = deps.steps[0]
        assert step.tool == "search_bangumi"
        assert step.success is True

    async def test_updates_tool_state_on_success(self) -> None:
        from backend.agents.pilgrimage_tools import search_bangumi

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="sql")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps(tool_state={})
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_bangumi(ctx, bangumi_id="253")

        assert "search_bangumi" in deps.tool_state

    async def test_emits_running_and_done_sse(self) -> None:
        from backend.agents.pilgrimage_tools import search_bangumi

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="sql")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps(tool_state={})
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_bangumi(ctx, bangumi_id="253")

        emitted = deps._emitted
        statuses = [e[1] for e in emitted]
        assert "running" in statuses
        assert "done" in statuses


# ---------------------------------------------------------------------------
# Slice 4: search_nearby inline
# ---------------------------------------------------------------------------


class TestSearchNearbyInline:
    """search_nearby tool inlines handler logic (build request + retrieval)."""

    async def test_calls_retriever_with_location(self) -> None:
        from backend.agents.pilgrimage_tools import search_nearby

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1", "distance_m": 100}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {"radius_m": 5000}
        fake_retrieval.strategy = MagicMock(value="geo")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps()
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        result = await search_nearby(ctx, location="宇治駅", radius=0)

        assert isinstance(result, dict)
        retriever.execute.assert_awaited_once()

    async def test_records_step_on_success(self) -> None:
        from backend.agents.pilgrimage_tools import search_nearby

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="geo")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps()
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_nearby(ctx, location="Kyoto", radius=0)

        assert len(deps.steps) == 1
        step = deps.steps[0]
        assert step.tool == "search_nearby"
        assert step.success is True

    async def test_updates_tool_state_on_success(self) -> None:
        from backend.agents.pilgrimage_tools import search_nearby

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="geo")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps()
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_nearby(ctx, location="Kyoto", radius=0)

        assert "search_nearby" in deps.tool_state

    async def test_emits_sse_events(self) -> None:
        from backend.agents.pilgrimage_tools import search_nearby

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = [{"id": "p1"}]
        fake_retrieval.row_count = 1
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="geo")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps()
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_nearby(ctx, location="Tokyo", radius=3000)

        emitted = deps._emitted
        statuses = [e[1] for e in emitted]
        assert "running" in statuses
        assert "done" in statuses

    async def test_passes_radius_to_retriever(self) -> None:
        from backend.agents.pilgrimage_tools import search_nearby

        fake_retrieval = MagicMock()
        fake_retrieval.success = True
        fake_retrieval.rows = []
        fake_retrieval.row_count = 0
        fake_retrieval.metadata = {}
        fake_retrieval.strategy = MagicMock(value="geo")

        retriever = MagicMock()
        retriever.execute = AsyncMock(return_value=fake_retrieval)

        deps = _make_deps()
        deps.retriever = retriever
        ctx = _make_ctx(deps)

        await search_nearby(ctx, location="Akihabara", radius=3000)

        call_args = retriever.execute.call_args[0][0]
        assert call_args.radius == 3000
        assert call_args.location == "Akihabara"
