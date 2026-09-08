"""The agent eval dataset file, read into pydantic-evals cases.

Split out of ``eval_harness.py`` (#1493): the harness owns the run — which
cases it selects, which evaluators it builds, how it traces — and this module
owns the one thing that happens before any of that, turning a dataset row into
a ``Case`` and its context into the message history the turn replays.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import TypeAlias, cast

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_evals import Case

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.evaluators import AgentExpected, AgentInput

Row: TypeAlias = Mapping[str, object]


def _str_list(row: Row, key: str) -> list[str]:
    raw = row.get(key)
    return [str(item) for item in raw] if isinstance(raw, list) else []


def _context(row: Row) -> Mapping[str, object] | None:
    raw = row.get("context")
    return (
        {str(key): value for key, value in raw.items()}
        if isinstance(raw, Mapping)
        else None
    )


def _selected_ids(row: Row, key: str) -> list[str] | None:
    raw = row.get(key)
    return [str(item) for item in raw] if isinstance(raw, list) else None


def _optional_int(row: Row, key: str) -> int | None:
    value = row.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _mapping(row: Row, key: str) -> Mapping[str, object] | None:
    value = row.get(key)
    return (
        {str(name): item for name, item in value.items()}
        if isinstance(value, Mapping)
        else None
    )


def _padded_text(turn: Mapping[object, object], key: str) -> str:
    text = str(turn.get(key, ""))
    padding = turn.get("padding_chars", 0)
    count = padding if isinstance(padding, int) else 0
    return text + (" Travel planning context remains unchanged." * count)[:count]


def _history_turn(item: object) -> list[ModelMessage]:
    if not isinstance(item, Mapping):
        raise ValueError("Eval message_history turns must be objects.")
    user = ModelRequest(parts=[UserPromptPart(_padded_text(item, "user"))])
    assistant = ModelResponse(parts=[TextPart(_padded_text(item, "assistant"))])
    return [user, assistant]


def message_history(context: Mapping[str, object] | None) -> list[ModelMessage]:
    raw = context.get("message_history") if context is not None else None
    if not isinstance(raw, list):
        return []
    messages: list[ModelMessage] = []
    for item in raw:
        messages.extend(_history_turn(item))
    return messages


def _case(row: Row) -> Case[AgentInput, AgentResult, AgentExpected]:
    return Case(name=str(row["id"]), inputs=_input(row), metadata=_expected(row))


def _input(row: Row) -> AgentInput:
    return AgentInput(
        str(row.get("query", "")),
        str(row.get("locale", "ja")),
        _context(row),
        _selected_ids(row, "selected_point_ids"),
        _selected_ids(row, "selected_candidate_ids"),
        _optional_int(row, "clarification_id"),
        _mapping(row, "seeded_pending"),
    )


def _expected(row: Row) -> AgentExpected:
    return AgentExpected(
        _str_list(row, "acceptable_stages"),
        _str_list(row, "expected_data_keys"),
        row.get("expect_nonempty") is True,
    )


def _row(item: object) -> Row:
    if not isinstance(item, Mapping):
        raise ValueError("Agent eval dataset rows must be objects.")
    return {str(key): value for key, value in item.items()}


def _rows(raw: object) -> list[Row]:
    if not isinstance(raw, list):
        raise ValueError("Agent eval dataset must be a list.")
    return [_row(item) for item in raw]


def load_cases(path: Path) -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw = cast(object, json.loads(path.read_text()))
    return [_case(row) for row in _rows(raw)]
