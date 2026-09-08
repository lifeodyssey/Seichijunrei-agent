"""Unit tests for the observability of the unclassified agent-loop path.

``_on_run_error`` swallows a genuinely unclassified exception into a localized
``ErrorResponseModel``. Before #1496 that was the one exception path in the
runtime that left no trace at all, so a converted failure was invisible.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic_ai import RunContext
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from structlog import testing

from animichi.agents import error_boundary
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.runtime_models import ErrorResponseModel
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


def make_run_context() -> RunContext[RuntimeDeps]:
    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="q", catalog=MockCatalogClient()
    )
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage())


def make_raised_runtime_error() -> RuntimeError:
    """Build an error that carries a real traceback, as a raised one would."""
    try:
        raise RuntimeError("the model backend misbehaved")
    except RuntimeError as raised:
        return raised


async def test_unclassified_run_error_is_logged_before_conversion() -> None:
    error = RuntimeError("the model backend misbehaved")

    with testing.capture_logs() as captured:
        result = await error_boundary._on_run_error(make_run_context(), error=error)

    [event] = captured
    assert event["event"] == "animichi_run_error"
    assert event["error_type"] == "RuntimeError"
    assert event["log_level"] == "error"
    assert isinstance(result.output, ErrorResponseModel)


async def test_run_error_log_carries_the_formatted_traceback() -> None:
    """pydantic-ai runs this hook after the exception state is cleared, so the
    traceback survives only when the error object is read explicitly. It is
    formatted here rather than handed to `exc_info=`: structlog is unconfigured,
    and its rich renderer costs ~32 s walking the agent-run frames."""
    error = make_raised_runtime_error()

    with testing.capture_logs() as captured:
        await error_boundary._on_run_error(make_run_context(), error=error)

    [event] = captured
    assert "RuntimeError: the model backend misbehaved" in event["traceback"]
    assert "make_raised_runtime_error" in event["traceback"]


async def test_reraised_run_error_logs_nothing() -> None:
    with testing.capture_logs() as captured:
        try:
            await error_boundary._on_run_error(
                make_run_context(), error=KeyboardInterrupt()
            )
        except KeyboardInterrupt:
            pass

    assert captured == []
