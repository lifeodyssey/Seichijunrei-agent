"""Shared test helpers for public_api test files.

Eliminates duplication of _make_result() and _mock_pipeline across
test_public_api_errors, test_public_api_facade, test_public_api_persistence,
test_public_api_pipeline, test_public_api_session.

Import with: from backend.tests.unit.conftest_public_api import make_result
"""

from __future__ import annotations

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
