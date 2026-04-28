"""Shared test helpers for public_api test files.

Eliminates duplication of make_result() and mock_pipeline_agent across
test_public_api_errors, test_public_api_facade, test_public_api_persistence,
test_public_api_pipeline, test_public_api_session.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.runtime_models import (
    ClarifyDataModel,
    ClarifyResponseModel,
    GreetingResponseModel,
    QADataModel,
    QAResponseModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    RuntimeStageOutput,
    SearchDataModel,
    SearchResponseModel,
)


def _build_output(
    intent: str,
    message: str,
    data: dict[str, object] | None,
) -> RuntimeStageOutput:
    """Build a typed output model from intent + flat data dict."""
    data = data or {}
    if intent == "clarify":
        return ClarifyResponseModel(
            intent="clarify",
            message=message,
            data=ClarifyDataModel(
                status="needs_clarification",
                question=str(data.get("question", message)),
                options=data.get("options", []),
            ),
        )
    if intent in ("search_bangumi", "search_nearby"):
        results = data.get("results", {})
        results_meta = (
            ResultsMetaModel.model_validate(results)
            if isinstance(results, dict)
            else ResultsMetaModel()
        )
        return SearchResponseModel(
            intent=intent,
            message=message,
            data=SearchDataModel(results=results_meta),
        )
    if intent in ("plan_route", "plan_selected"):
        route = data.get("route", {})
        route_model = (
            RouteModel.model_validate(route)
            if isinstance(route, dict)
            else RouteModel()
        )
        return RouteResponseModel(
            intent=intent,
            message=message,
            data=RouteDataModel(route=route_model),
        )
    if intent == "greet_user":
        return GreetingResponseModel(
            intent="greet_user",
            message=message,
            data=QADataModel(message=message),
        )
    # general_qa / answer_question fallback
    return QAResponseModel(
        intent="general_qa",
        message=message,
        data=QADataModel(message=message),
    )


def make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    message: str = "該当する巡礼地が見つかりませんでした。",
    data: dict[str, object] | None = None,
    steps: list[StepRecord] | None = None,
    tool_state: dict[str, object] | None = None,
) -> AgentResult:
    """Build a fake AgentResult for tests that mock the runtime agent."""
    if data is None:
        data = {"results": {"rows": [], "row_count": 0}}
    output = _build_output(intent, message, data)
    return AgentResult(
        output=output,
        steps=steps or [],
        tool_state=tool_state or {},
    )


def make_fake_agent(
    result_fn: Callable[..., AgentResult] | None = None,
) -> Callable[..., Awaitable[AgentResult]]:
    """Return a fake run_pilgrimage_agent coroutine for monkeypatching."""

    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: object | None = None,
    ) -> AgentResult:
        _ = (text, db, model, context, message_history, on_step)
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
