"""Unit tests for the observability of the unclassified agent-loop path.

``_on_run_error`` swallows a genuinely unclassified exception into a localized
``ErrorResponseModel``. Before #1496 that was the one exception path in the
runtime that left no trace at all, so a converted failure was invisible; #1502
made that trace affordable by configuring structlog once at process start.
"""

from __future__ import annotations

import json
import signal
import time
from collections.abc import Iterator
from contextlib import contextmanager
from types import FrameType
from unittest.mock import MagicMock

import pytest
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from structlog import testing

from animichi.agents import error_boundary
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.runtime_models import ErrorResponseModel
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.streaming_function_model import streaming_function_model

# One logged agent-loop error costs 4 ms under the configured chain and 3.1 s
# under structlog's default rich renderer for the stack built below (91 s for a
# full runner stack). The budget sits ~100x above the former and ~6x below the
# latter; the alarm turns a regression into a fast failure instead of a wait.
_LOG_BUDGET_SECONDS = 0.5
_LOG_ALARM_SECONDS = 2.0


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


async def make_deep_agent_run_error() -> RuntimeError:
    """Build an error whose traceback crosses the real pydantic-ai run frames.

    The renderer's cost scales with those frames' source files and locals, so
    the timing below only means something on a genuine agent-run stack.
    """

    def fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError("the model backend misbehaved")

    try:
        await Agent(streaming_function_model(fail)).run("hello")
    except RuntimeError as raised:
        return raised
    raise AssertionError("the agent run was expected to raise")


@contextmanager
def fail_fast_after(seconds: float) -> Iterator[None]:
    """Interrupt the block once *seconds* of wall clock have passed.

    `ITIMER_REAL` and `SIGALRM` are process-wide, so both are handed back on
    the way out: the timer restarts from whatever the caller had left, and the
    handler is restored first so an immediate expiry reaches the right one.
    """

    def on_alarm(_signum: int, _frame: FrameType | None) -> None:
        raise TimeoutError(f"the logged traceback took longer than {seconds}s")

    previous_handler = signal.signal(signal.SIGALRM, on_alarm)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.signal(signal.SIGALRM, previous_handler)
        signal.setitimer(signal.ITIMER_REAL, *previous_timer)


def test_fail_fast_after_hands_back_the_timer_the_caller_had_armed() -> None:
    """`ITIMER_REAL` and `SIGALRM` are process-wide: a caller that already
    armed a real-time timer must get it back, not have it cancelled."""
    outer_handler = signal.signal(signal.SIGALRM, signal.SIG_IGN)
    signal.setitimer(signal.ITIMER_REAL, 30.0)
    try:
        with fail_fast_after(_LOG_ALARM_SECONDS):
            pass
        remaining, _interval = signal.getitimer(signal.ITIMER_REAL)
        restored_handler = signal.getsignal(signal.SIGALRM)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, outer_handler)

    assert remaining > 0
    assert restored_handler is signal.SIG_IGN


async def test_unclassified_run_error_is_logged_before_conversion() -> None:
    error = RuntimeError("the model backend misbehaved")

    with testing.capture_logs() as captured:
        result = await error_boundary._on_run_error(make_run_context(), error=error)

    [event] = captured
    assert event["event"] == "animichi_run_error"
    assert event["error_type"] == "RuntimeError"
    assert event["log_level"] == "error"
    assert isinstance(result.output, ErrorResponseModel)


async def test_run_error_log_renders_the_traceback_as_plain_text(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """pydantic-ai runs this hook after the exception state is cleared, so the
    traceback survives only when the error object is named in ``exc_info=``.
    The process-wide chain renders it through ``format_exc_info``: one plain,
    untruncated string on a JSON line."""
    error = make_raised_runtime_error()

    await error_boundary._on_run_error(make_run_context(), error=error)

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["event"] == "animichi_run_error"
    assert "RuntimeError: the model backend misbehaved" in payload["exception"]
    assert "make_raised_runtime_error" in payload["exception"]


async def test_run_error_log_of_a_deep_agent_stack_stays_within_budget() -> None:
    """The one assertion in this suite that reads a real clock on purpose: the
    defect it guards (issue #1502) is wall-clock cost. Unconfigured, structlog
    hands each agent-run frame to rich, which re-reads and highlights that
    frame's source file and pretty-prints its locals."""
    error = await make_deep_agent_run_error()

    with fail_fast_after(_LOG_ALARM_SECONDS):
        started = time.perf_counter()
        await error_boundary._on_run_error(make_run_context(), error=error)
        elapsed = time.perf_counter() - started

    assert elapsed < _LOG_BUDGET_SECONDS


async def test_reraised_run_error_logs_nothing() -> None:
    with testing.capture_logs() as captured:
        try:
            await error_boundary._on_run_error(
                make_run_context(), error=KeyboardInterrupt()
            )
        except KeyboardInterrupt:
            pass

    assert captured == []
