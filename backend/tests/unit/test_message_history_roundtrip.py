"""Integration test: message_history serialize -> store -> deserialize -> use."""

from __future__ import annotations

from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_core import to_jsonable_python

from backend.interfaces.session_facade import build_message_history


def _build_session_with_messages(new_messages: list[ModelMessage]) -> dict[str, object]:
    serialized = list(to_jsonable_python(new_messages))
    return {
        "interactions": [
            {
                "text": "test",
                "intent": "clarify",
                "status": "ok",
                "success": True,
                "context_delta": {},
                "new_messages": serialized,
            }
        ],
    }


class TestMessageHistoryRoundtrip:
    def test_serialize_deserialize_preserves_user_message(self) -> None:
        original: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="hello")]),
            ModelResponse(parts=[TextPart(content="hi there")]),
        ]
        serialized = list(to_jsonable_python(original))
        deserialized = ModelMessagesTypeAdapter.validate_python(serialized)
        assert len(deserialized) == 2
        assert isinstance(deserialized[0], ModelRequest)
        assert isinstance(deserialized[1], ModelResponse)

    def test_serialize_deserialize_preserves_tool_pair(self) -> None:
        original: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="search haruhi")]),
            ModelResponse(
                parts=[
                    ToolCallPart(
                        tool_name="resolve_anime",
                        args='{"title":"haruhi"}',
                        tool_call_id="c1",
                    )
                ]
            ),
            ModelRequest(
                parts=[
                    ToolReturnPart(
                        tool_name="resolve_anime",
                        content='{"bangumi_id":"485"}',
                        tool_call_id="c1",
                    )
                ]
            ),
            ModelResponse(parts=[TextPart(content="Found it!")]),
        ]
        serialized = list(to_jsonable_python(original))
        deserialized = ModelMessagesTypeAdapter.validate_python(serialized)
        assert len(deserialized) == 4
        resp = deserialized[1]
        assert isinstance(resp, ModelResponse)
        assert any(isinstance(p, ToolCallPart) for p in resp.parts)
        req = deserialized[2]
        assert isinstance(req, ModelRequest)
        assert any(isinstance(p, ToolReturnPart) for p in req.parts)

    def test_build_message_history_from_session(self) -> None:
        messages: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="q1")]),
            ModelResponse(parts=[TextPart(content="a1")]),
        ]
        session = _build_session_with_messages(messages)
        history = build_message_history(session)
        assert len(history) == 2

    def test_empty_session_returns_empty(self) -> None:
        assert build_message_history({"interactions": []}) == []

    def test_old_session_without_new_messages(self) -> None:
        session: dict[str, object] = {
            "interactions": [{"text": "old", "intent": "search", "context_delta": {}}]
        }
        assert build_message_history(session) == []

    def test_multiple_interactions_accumulate(self) -> None:
        turn1: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="q1")]),
            ModelResponse(parts=[TextPart(content="a1")]),
        ]
        turn2: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="q2")]),
            ModelResponse(parts=[TextPart(content="a2")]),
        ]
        session: dict[str, object] = {
            "interactions": [
                {
                    "text": "q1",
                    "intent": "clarify",
                    "context_delta": {},
                    "new_messages": list(to_jsonable_python(turn1)),
                },
                {
                    "text": "q2",
                    "intent": "search",
                    "context_delta": {},
                    "new_messages": list(to_jsonable_python(turn2)),
                },
            ]
        }
        history = build_message_history(session)
        assert len(history) == 4
