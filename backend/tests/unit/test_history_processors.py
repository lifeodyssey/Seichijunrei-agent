"""Unit tests for history processor functions in pilgrimage_agent."""

from __future__ import annotations

from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)


def _make_request_with_tool_return(
    tool_name: str, content: str, tool_call_id: str = "call_1"
) -> ModelRequest:
    """Build a ModelRequest containing a single ToolReturnPart."""
    return ModelRequest(
        parts=[
            ToolReturnPart(
                tool_name=tool_name, content=content, tool_call_id=tool_call_id
            )
        ]
    )


def _make_user_request(text: str = "hello") -> ModelRequest:
    return ModelRequest(parts=[UserPromptPart(content=text)])


def _make_response(text: str = "ok") -> ModelResponse:
    return ModelResponse(parts=[TextPart(content=text)])


def _make_tool_call_response(
    tool_name: str = "search", tool_call_id: str = "call_1"
) -> ModelResponse:
    return ModelResponse(
        parts=[ToolCallPart(tool_name=tool_name, args="", tool_call_id=tool_call_id)]
    )


class TestCompactToolResults:
    def test_no_op_under_threshold(self) -> None:
        from backend.agents.pilgrimage_agent import _compact_tool_results

        messages: list[ModelMessage] = [
            _make_user_request("q1"),
            _make_response("a1"),
            _make_user_request("q2"),
            _make_response("a2"),
            _make_user_request("q3"),
            _make_response("a3"),
        ]
        result = _compact_tool_results(messages)
        assert result == messages
        assert len(result) == 6

    def test_compresses_old_tool_returns(self) -> None:
        from backend.agents.pilgrimage_agent import _compact_tool_results

        long_content = "x" * 300
        messages: list[ModelMessage] = [
            _make_request_with_tool_return("resolve_anime", long_content, "c1"),
            _make_response("resolved"),
            _make_request_with_tool_return("search_bangumi", long_content, "c2"),
            _make_response("found results"),
            _make_user_request("q3"),
            _make_response("a3"),
            _make_user_request("q4"),
            _make_response("a4"),
            _make_user_request("q5"),
            _make_response("a5"),
            _make_user_request("recent"),
            _make_response("recent answer"),
        ]
        result = _compact_tool_results(messages)

        assert len(result) == len(messages)
        # Old tool returns (before cutoff) should be compressed
        first_msg = result[0]
        assert isinstance(first_msg, ModelRequest)
        part = first_msg.parts[0]
        assert isinstance(part, ToolReturnPart)
        assert "[resolve_anime: completed]" in str(part.content)

        # Recent messages (last 4) should be unchanged
        last_msg = result[-1]
        assert isinstance(last_msg, ModelResponse)


class TestSlidingWindow:
    def test_no_op_under_threshold(self) -> None:
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [_make_user_request(f"q{i}") for i in range(8)]
        result = _sliding_window(messages)
        assert len(result) == 8

    def test_truncates_over_threshold(self) -> None:
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [_make_user_request(f"q{i}") for i in range(15)]
        result = _sliding_window(messages)
        assert len(result) == 10
        # Should keep the last 10
        last_msg = result[-1]
        assert isinstance(last_msg, ModelRequest)
        first_part = last_msg.parts[0]
        assert isinstance(first_part, UserPromptPart)
        assert first_part.content == "q14"
