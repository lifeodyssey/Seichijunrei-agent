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
        from backend.agents.pilgrimage_agent import (
            COMPACT_THRESHOLD,
            _compact_tool_results,
        )

        long_content = "x" * 300
        # Build enough messages to exceed COMPACT_THRESHOLD
        messages: list[ModelMessage] = [
            _make_request_with_tool_return("resolve_anime", long_content, "c1"),
            _make_response("resolved"),
            _make_request_with_tool_return("search_bangumi", long_content, "c2"),
            _make_response("found results"),
        ]
        # Pad with user turns to exceed threshold
        for i in range(COMPACT_THRESHOLD):
            messages.append(_make_user_request(f"q{i}"))
            messages.append(_make_response(f"a{i}"))

        assert len(messages) > COMPACT_THRESHOLD
        result = _compact_tool_results(messages)

        assert len(result) == len(messages)
        # Old tool returns (before cutoff) should be compressed
        first_msg = result[0]
        assert isinstance(first_msg, ModelRequest)
        part = first_msg.parts[0]
        assert isinstance(part, ToolReturnPart)
        assert "[resolve_anime: completed]" in str(part.content)

        # Recent messages (last _KEEP_RECENT) should be unchanged
        last_msg = result[-1]
        assert isinstance(last_msg, ModelResponse)


class TestSlidingWindow:
    def test_no_op_under_threshold(self) -> None:
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [_make_user_request(f"q{i}") for i in range(8)]
        result = _sliding_window(messages)
        assert len(result) == 8

    def test_truncates_over_threshold(self) -> None:
        from backend.agents.pilgrimage_agent import COMPACT_THRESHOLD, _sliding_window

        count = COMPACT_THRESHOLD + 20
        messages: list[ModelMessage] = [
            _make_user_request(f"q{i}") for i in range(count)
        ]
        result = _sliding_window(messages)
        assert len(result) <= COMPACT_THRESHOLD
        last_msg = result[-1]
        assert isinstance(last_msg, ModelRequest)
        first_part = last_msg.parts[0]
        assert isinstance(first_part, UserPromptPart)
        assert first_part.content == f"q{count - 1}"


class TestSlidingWindowPairPreservation:
    def test_preserves_tool_call_return_pair(self) -> None:
        """Sliding window must not orphan a ToolReturnPart from its ToolCallPart."""
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [
            _make_user_request("q1"),
            _make_response("a1"),
            _make_user_request("q2"),
            _make_tool_call_response("search_bangumi", "call_1"),
            _make_request_with_tool_return("search_bangumi", "results", "call_1"),
            _make_response("found 76 spots"),
            _make_user_request("q3"),
            _make_response("a3"),
            _make_user_request("q4"),
            _make_response("a4"),
            _make_user_request("q5"),
            _make_response("a5"),
            _make_user_request("q6"),
            _make_response("a6"),
        ]
        result = _sliding_window(messages)

        for i, msg in enumerate(result):
            if not isinstance(msg, ModelRequest):
                continue
            for part in msg.parts:
                if not isinstance(part, ToolReturnPart):
                    continue
                found_call = any(
                    isinstance(prev, ModelResponse)
                    and any(
                        isinstance(pp, ToolCallPart)
                        and pp.tool_call_id == part.tool_call_id
                        for pp in prev.parts
                    )
                    for prev in result[:i]
                )
                assert found_call, (
                    f"ToolReturnPart '{part.tool_name}' at index {i} "
                    f"has no preceding ToolCallPart with id '{part.tool_call_id}'"
                )

    def test_cuts_on_user_turn_boundary(self) -> None:
        """Window should start at a UserPromptPart, not mid-turn."""
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [
            _make_user_request("old1"),
            _make_tool_call_response("resolve_anime", "c1"),
            _make_request_with_tool_return("resolve_anime", "data", "c1"),
            _make_response("resolved"),
            _make_user_request("old2"),
            _make_response("a2"),
            _make_user_request("recent1"),
            _make_response("r1"),
            _make_user_request("recent2"),
            _make_response("r2"),
            _make_user_request("recent3"),
            _make_response("r3"),
        ]
        result = _sliding_window(messages)

        first = result[0]
        assert isinstance(first, ModelRequest)
        assert any(isinstance(p, UserPromptPart) for p in first.parts)


class TestCompressRequestPreservesFields:
    def test_preserves_instructions_field(self) -> None:
        from backend.agents.pilgrimage_agent import _compress_request

        original = ModelRequest(
            parts=[
                ToolReturnPart(tool_name="search", content="x" * 300, tool_call_id="c1")
            ],
            instructions="You are a helpful assistant.",
        )
        compressed = _compress_request(original)
        assert compressed.instructions == "You are a helpful assistant."
        part = compressed.parts[0]
        assert isinstance(part, ToolReturnPart)
        assert "[search: completed]" in str(part.content)
