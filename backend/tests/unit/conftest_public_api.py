"""Shared test helpers for public_api test files.

Eliminates duplication of make_result() and mock_pipeline_agent across
test_public_api_errors, test_public_api_facade, test_public_api_persistence,
test_public_api_pipeline, test_public_api_session.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName


def make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    steps: list[PlanStep] | None = None,
    final_output: dict[str, object] | None = None,
) -> PipelineResult:
    """Build a fake PipelineResult for tests that mock the runtime agent."""
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


def make_fake_agent(
    result_fn: Callable[..., PipelineResult] | None = None,
) -> Callable[..., Awaitable[PipelineResult]]:
    """Return a fake run_pilgrimage_agent coroutine for monkeypatching."""

    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        on_step: object | None = None,
    ) -> PipelineResult:
        _ = (text, db, model, context, on_step)
        if result_fn is not None:
            return result_fn(locale=locale)
        return make_result(locale=locale)

    return _fake


async def _fake_generate_title(**kwargs: object) -> str:
    """Fake title generator for unit tests."""
    first_query = kwargs.get("first_query", "")
    return str(first_query)[:15] if isinstance(first_query, str) else "test"


def install_mock_pipeline(monkeypatch: object) -> None:
    """Monkeypatch run_pilgrimage_agent and generate_and_save_title."""
    setattr_fn = monkeypatch.setattr
    setattr_fn(
        "backend.interfaces.public_api.run_pilgrimage_agent",
        make_fake_agent(),
    )
    # TODO: re-enable when conversation history title generation is wired back
    # setattr_fn(
    #     "backend.interfaces.persistence.generate_and_save_title",
    #     _fake_generate_title,
    # )
    # setattr_fn(
    #     "backend.interfaces.persistence._spawn_background",
    #     lambda coro: ...,
    # )
