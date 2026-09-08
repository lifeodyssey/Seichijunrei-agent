"""Offline construction tests for the CodeMode rematch arms."""

from __future__ import annotations

import sys
from typing import NoReturn

import pytest
import structlog
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.profiles import ModelProfile
from pydantic_ai_harness import CodeMode
from pydantic_evals import Case
from pydantic_monty import Monty, MontyRepl

from animichi.agents import animichi_agent as production_module
from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.spikes.codemode import rematch
from animichi.spikes.codemode.agent import (
    CODEMODE_TEACHING_ADDENDUM,
    RAW_TOOL_NAMES,
    Arm,
    build_rematch_arm,
)
from animichi.spikes.codemode.rematch import stratified_cases
from animichi.tests.eval.evaluators import AgentExpected, AgentInput
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.null_database import NullDatabase
from animichi.utils.logger import configure_structlog

_QA_OUTPUT = {"message": "offline"}


def _function_model(observed: dict[str, str]) -> FunctionModel:
    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        observed.update(
            {tool.name: tool.description or "" for tool in info.function_tools}
        )
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    return FunctionModel(
        respond, profile=ModelProfile(supported_native_tools=frozenset())
    )


def _deps() -> RuntimeDeps:
    return RuntimeDeps(NullDatabase(), "ja", "hello", MockCatalogClient())


def _case(case_id: str) -> Case[AgentInput, AgentResult, AgentExpected]:
    inputs = AgentInput("query", "en")
    expected = AgentExpected(["general_qa"])
    return Case(name=case_id, inputs=inputs, metadata=expected)


async def _surface(arm: Arm) -> tuple[dict[str, str], dict[str, object]]:
    observed: dict[str, str] = {}
    agent = build_rematch_arm(arm)
    await agent.run("hello", deps=_deps(), model=_function_model(observed))
    return observed, agent.output_json_schema()


def test_codemode_imports_and_constructs_with_monty_repl() -> None:
    """Keep the locked Harness/Monty CodeMode combination importable."""
    capability = CodeMode(tools=RAW_TOOL_NAMES, dynamic_catalog=False)

    assert MontyRepl is not None
    assert capability.tools == RAW_TOOL_NAMES
    assert capability.dynamic_catalog is False


async def test_rematch_arms_share_contract_and_only_codemode_wraps_tools() -> None:
    production_names = tuple(
        production_module.build_animichi_agent()._function_toolset.tools
    )
    before = tuple(production_module.animichi_agent._function_toolset.tools)

    control, control_schema = await _surface("control")
    taught, taught_schema = await _surface("codemode-taught")

    assert tuple(control) == production_names == RAW_TOOL_NAMES
    assert set(taught) == {"run_code"}
    assert all(name in taught["run_code"] for name in RAW_TOOL_NAMES)
    assert control_schema == taught_schema
    assert tuple(production_module.animichi_agent._function_toolset.tools) == before


def test_stratified_sampler_is_sorted_deterministic_and_family_preserving() -> None:
    cases = [
        _case(name)
        for name in ["B_zh_002", "A_en_003", "A_ja_001", "B_en_001", "A_zh_002"]
    ]

    first = stratified_cases(cases, 4)
    second = stratified_cases(list(reversed(cases)), 4)

    assert [str(case.name) for case in first] == [
        "A_en_003",
        "A_ja_001",
        "B_en_001",
        "B_zh_002",
    ]
    assert [str(case.name) for case in second] == [str(case.name) for case in first]
    assert {str(case.name).split("_", 1)[0] for case in first} == {"A", "B"}


def test_teaching_addendum_pins_whole_script_example_and_monty_limits() -> None:
    lesson = CODEMODE_TEACHING_ADDENDUM
    example = lesson.split("```python\n", 1)[1].split("\n```", 1)[0]

    Monty(example)
    assert "ONE `run_code` call" in lesson
    assert all(
        name in lesson for name in ("resolve_anime", "search_bangumi", "plan_route")
    )
    assert "except Exception" in lesson
    assert "class definitions are forbidden" in lesson
    assert "third-party imports are forbidden" in lesson
    assert (
        "`sys`, `typing`, `asyncio`, `math`, `json`, `re`, `datetime`, `os`, "
        "and `pathlib`" in lesson
    )


async def test_rematch_main_configures_structlog_before_evaluating(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The spike runner is a process start of its own, with neither the app
    factory nor the pytest conftest behind it, so it would otherwise render
    the runtime's `exc_info=` logs through rich for a whole arm (#1502)."""
    configured: list[bool] = []

    async def stop_before_the_report_is_written(*_args: object) -> NoReturn:
        configured.append(structlog.is_configured())
        raise RuntimeError("stop before the spike writes its report")

    monkeypatch.setattr(rematch, "_evaluate", stop_before_the_report_is_written)
    monkeypatch.setattr(sys, "argv", ["rematch", "--arm", "control"])
    structlog.reset_defaults()
    try:
        with pytest.raises(RuntimeError, match="stop before"):
            await rematch.main()
    finally:
        configure_structlog()

    assert configured == [True]
