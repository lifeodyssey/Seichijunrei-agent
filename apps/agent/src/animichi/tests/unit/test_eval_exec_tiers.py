"""Unit tests for eval execution tier helpers."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_evals import Case, Dataset

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import SearchResponseModel
from animichi.tests.eval.exec_tiers import (
    cap_cases,
    is_fullstack,
    read_max_cases,
    results_filename,
)
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.null_database import NullDatabase
from animichi.tests.eval.results_payload import CaseRow, ResultsPayload
from animichi.tests.streaming_function_model import streaming_function_model

EvalTaskFactory = Callable[[object, Callable[[], MockCatalogClient], object], object]


def test_cap_cases_none_returns_original_list() -> None:
    cases = list(range(10))

    result = cap_cases(cases, None)

    assert result is cases


def test_cap_cases_cap_at_or_above_length_returns_original_list() -> None:
    cases = list(range(3))

    result = cap_cases(cases, 3)

    assert result is cases


def test_cap_cases_even_stride_is_deterministic() -> None:
    cases = list(range(10))

    first = cap_cases(cases, 3)
    second = cap_cases(cases, 3)

    assert first == [0, 4, 9]
    assert second == first


def test_env_parsing(monkeypatch) -> None:
    monkeypatch.delenv("EVAL_MAX_CASES", raising=False)
    monkeypatch.delenv("EVAL_FULLSTACK", raising=False)
    assert read_max_cases() is None
    assert not is_fullstack()

    monkeypatch.setenv("EVAL_MAX_CASES", "0")
    monkeypatch.setenv("EVAL_FULLSTACK", "1")
    assert read_max_cases() is None
    assert is_fullstack()

    monkeypatch.setenv("EVAL_MAX_CASES", "7")
    assert read_max_cases() == 7


def test_results_payload_and_filename() -> None:
    payload = ResultsPayload(
        model="openai:model@https://example.test/v1",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=2,
        evaluated_count=1,
        errored_count=1,
        scores={"IntentMatch": 1.0},
        cases=[CaseRow(id="A1", scores={"IntentMatch": 1.0})],
    )

    assert payload.repeat == 1
    assert payload.retries == 0
    assert payload.dataset == "agent_eval_v3"
    assert payload.tier == "trajectory"
    assert results_filename("agent", payload.model) == (
        "agent_openai-model-https---example.test-v1.json"
    )


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        getattr(part, "tool_name", None) == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _search_driver(title: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": title})]
            )
        if not _returned(messages, "search_bangumi"):
            return ModelResponse(
                parts=[ToolCallPart("search_bangumi", {"bangumi_id": "160209"})]
            )
        return ModelResponse(parts=[ToolCallPart("search_response", _search_args())])

    return streaming_function_model(respond)


def _search_args():
    return {"message": "見つかりました。"}


def _clear_imported_env(before: set[str]) -> None:
    for key in set(os.environ) - before:
        os.environ.pop(key, None)


def _load_eval_task() -> tuple[type[object], EvalTaskFactory]:
    before = set(os.environ)
    from animichi.tests.eval.test_agent_eval import AgentInput, make_agent_task

    _clear_imported_env(before)
    return AgentInput, make_agent_task


async def test_trajectory_task_is_db_free() -> None:
    agent_input, make_agent_task = _load_eval_task()
    task = make_agent_task(
        NullDatabase(), MockCatalogClient, _search_driver("君の名は。")
    )

    result = await task(agent_input(query="君の名は。の聖地", locale="ja"))

    assert isinstance(result, AgentResult)
    assert isinstance(result.output, SearchResponseModel)


@dataclass
class _RetryInput:
    name: str
    should_raise: bool = False


class _SingleAttemptTask:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def run(self, inputs: _RetryInput) -> str:
        self.calls.append(inputs.name)
        if inputs.should_raise:
            raise RuntimeError("single attempt")
        return inputs.name


def _no_retry_dataset() -> Dataset[_RetryInput, str, None]:
    return Dataset(
        name="no_retry",
        cases=[
            Case(name="ok", inputs=_RetryInput("ok")),
            Case(name="boom", inputs=_RetryInput("boom", should_raise=True)),
        ],
    )


async def test_dataset_shape_has_no_hidden_task_retry() -> None:
    task = _SingleAttemptTask()

    report = await _no_retry_dataset().evaluate(
        task.run,
        name="no_retry",
        max_concurrency=1,
    )

    assert len(report.failures) == 1
    assert task.calls == ["ok", "boom"]
