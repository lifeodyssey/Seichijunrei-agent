"""Unit tests for eval task wiring of trajectory-only web seams."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import cast

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher
from animichi.tests.eval.null_database import NullDatabase
from animichi.tests.streaming_function_model import streaming_function_model

Task = Callable[[object], Awaitable[AgentResult]]


def test_eval_default_model_is_mimo() -> None:
    from animichi.config.model_aliases import CredentialRef, model_alias_from_spec
    from animichi.tests.eval.eval_harness import DEFAULT_MODEL_ID

    assert DEFAULT_MODEL_ID == "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
    assert (
        model_alias_from_spec(DEFAULT_MODEL_ID).credential_ref
        is CredentialRef.MIMO_API_KEY
    )


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _qa_args() -> Mapping[str, object]:
    return {"message": "ok"}


def _web_driver(query: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "web_search"):
            return ModelResponse(parts=[ToolCallPart("web_search", {"query": query})])
        return ModelResponse(parts=[ToolCallPart("qa_response", _qa_args())])

    return streaming_function_model(respond)


def _translation_driver(title: str, locale: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "translate_anime_title"):
            args = {"title": title, "target_language": locale}
            return ModelResponse(parts=[ToolCallPart("translate_anime_title", args)])
        return ModelResponse(parts=[ToolCallPart("qa_response", _qa_args())])

    return streaming_function_model(respond)


def _tool_return(result: AgentResult, tool_name: str) -> str:
    for message in result.new_messages:
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                return str(part.content)
    raise AssertionError(f"missing tool return: {tool_name}")


def _load_task_factory() -> tuple[type[object], object]:
    from animichi.tests.eval.test_agent_eval import AgentInput, make_agent_task

    return AgentInput, make_agent_task


async def test_make_agent_task_threads_mock_web_searcher() -> None:
    agent_input, make_agent_task = _load_task_factory()
    searcher = MockWebSearcher()
    task = cast(
        Task,
        make_agent_task(
            NullDatabase(),
            MockCatalogClient,
            _web_driver("Uji Sound Euphonium pilgrimage"),
            web_searcher=searcher,
        ),
    )

    result = await task(agent_input(query="宇治 anime pilgrimage", locale="en"))

    assert "響け！ユーフォニアム" in _tool_return(result, "web_search")
    assert searcher.calls == [("search", ("Uji Sound Euphonium pilgrimage",))]


async def test_make_agent_task_threads_mock_title_translator() -> None:
    agent_input, make_agent_task = _load_task_factory()
    translator = MockTitleTranslator()
    task = cast(
        Task,
        make_agent_task(
            NullDatabase(),
            MockCatalogClient,
            _translation_driver("君の名は。", "zh"),
            title_translator=translator,
        ),
    )

    result = await task(agent_input(query="translate title", locale="en"))

    assert "你的名字" in _tool_return(result, "translate_anime_title")
    assert translator.calls == [("translate", ("君の名は。", "zh"))]


async def test_selection_task_dispatches_anime_pending_to_multi_handler() -> None:
    from animichi.tests.eval.agent_eval_task import selection_task
    from animichi.tests.eval.evaluators import AgentInput

    pending = {
        "reason": "anime_ambiguity",
        "candidate_ids": ["115908", "11291"],
        "ordered_candidates": [
            {"id": "115908", "title": "Euphonium"},
            {"id": "11291", "title": "Haruhi"},
        ],
        "revision": 7,
    }
    result = await selection_task(
        AgentInput(
            query="",
            locale="en",
            selected_candidate_ids=["115908", "11291"],
            clarification_id=7,
            seeded_pending=pending,
        )
    )
    assert result.intent == "plan_multi"
    assert [step.tool for step in result.steps] == [
        "search_bangumi",
        "search_bangumi",
        "plan_multi",
    ]


async def test_selection_task_dispatches_place_pending_to_place_handler() -> None:
    from animichi.tests.eval.agent_eval_task import selection_task
    from animichi.tests.eval.evaluators import AgentInput

    pending = {
        "reason": "place_ambiguity",
        "candidate_ids": ["uji", "tokyo"],
        "ordered_candidates": [
            {"id": "uji", "title": "Uji", "lat": 34.8915, "lng": 135.8075},
            {"id": "tokyo", "title": "Tokyo", "lat": 35.68, "lng": 139.76},
        ],
        "revision": 3,
    }
    result = await selection_task(
        AgentInput(
            query="",
            locale="en",
            selected_candidate_ids=["uji"],
            clarification_id=3,
            seeded_pending=pending,
        )
    )
    assert result.intent == "search_nearby"
    assert [step.tool for step in result.steps] == ["search_nearby"]


async def test_agent_task_converts_blank_input_to_blocked_result() -> None:
    """#984 rejects blank input with InvalidInputError; the eval task turns it
    into a graceful blocked AgentResult so the L0 empty_input smoke case is not
    counted as an agent error."""
    from animichi.application.errors import InvalidInputError

    agent_input, make_agent_task = _load_task_factory()
    task = cast(
        Task,
        make_agent_task(NullDatabase(), MockCatalogClient, _web_driver("any")),
    )

    result = await task(agent_input(query="", locale="en"))

    assert result.status == "blocked"
    assert result.intent == "general_qa"
    assert result.success is False
    assert "blocked" in type(result.output).__name__.lower()
    assert InvalidInputError  # import guard
