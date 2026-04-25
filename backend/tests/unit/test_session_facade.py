"""Unit tests for backend.interfaces.session_facade."""

from __future__ import annotations

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.runtime_models import (
    QADataModel,
    QAResponseModel,
    ResultsMetaModel,
    SearchDataModel,
    SearchResponseModel,
)
from backend.interfaces.schemas import PublicAPIRequest
from backend.interfaces.session_facade import (
    SessionUpdate,
    as_str_or_none,
    build_context_block,
    build_session_summary,
    build_updated_session_state,
    extract_context_delta,
    normalize_session_state,
)


def _make_agent_result(
    intent: str = "search_bangumi",
    steps: list[StepRecord] | None = None,
    message: str = "",
) -> AgentResult:
    """Build a minimal AgentResult for session_facade tests."""
    if intent in ("search_bangumi", "search_nearby"):
        output = SearchResponseModel(
            intent=intent,
            message=message,
            data=SearchDataModel(results=ResultsMetaModel()),
        )
    else:
        output = QAResponseModel(
            intent="general_qa",
            message=message,
            data=QADataModel(message=message),
        )
    return AgentResult(output=output, steps=steps or [], tool_state={})


class TestNormalizeSessionState:
    def test_none_returns_defaults(self) -> None:
        state = normalize_session_state(None)

        assert state["interactions"] == []
        assert state["route_history"] == []
        assert state["last_intent"] is None
        assert state["last_status"] is None
        assert state["last_message"] == ""
        assert state["summary"] is None
        assert "updated_at" in state

    def test_empty_dict_returns_defaults(self) -> None:
        state = normalize_session_state({})

        assert state["interactions"] == []
        assert state["route_history"] == []

    def test_populated_state_preserves_values(self) -> None:
        existing = {
            "interactions": [{"text": "hello"}],
            "route_history": [{"id": "r1"}],
            "last_intent": "search_bangumi",
            "last_status": "ok",
            "last_message": "found",
            "summary": "user searched",
        }
        state = normalize_session_state(existing)

        assert len(state["interactions"]) == 1  # type: ignore[arg-type]
        assert len(state["route_history"]) == 1  # type: ignore[arg-type]
        assert state["last_intent"] == "search_bangumi"
        assert state["summary"] == "user searched"

    def test_non_list_interactions_coerced_to_empty(self) -> None:
        state = normalize_session_state({"interactions": "not-a-list"})
        assert state["interactions"] == []

    def test_non_list_route_history_coerced_to_empty(self) -> None:
        state = normalize_session_state({"route_history": 42})
        assert state["route_history"] == []

    def test_blank_summary_coerced_to_none(self) -> None:
        state = normalize_session_state({"summary": "   "})
        assert state["summary"] is None


class TestSessionUpdate:
    def test_defaults(self) -> None:
        request = PublicAPIRequest(text="hi")
        update = SessionUpdate(
            request=request,
            response_intent="greet_user",
            response_status="ok",
            response_success=True,
        )

        assert update.response_message == ""
        assert update.context_delta is None

    def test_frozen(self) -> None:
        from dataclasses import FrozenInstanceError

        import pytest

        request = PublicAPIRequest(text="hi")
        update = SessionUpdate(
            request=request,
            response_intent="greet_user",
            response_status="ok",
            response_success=True,
        )
        with pytest.raises(FrozenInstanceError):
            update.response_intent = "changed"  # type: ignore[misc]


class TestBuildUpdatedSessionState:
    def test_appends_interaction(self) -> None:
        prev = normalize_session_state(None)
        update = SessionUpdate(
            request=PublicAPIRequest(text="test query"),
            response_intent="search_bangumi",
            response_status="ok",
            response_success=True,
            response_message="found 3",
        )

        updated = build_updated_session_state(prev, update)

        interactions = updated["interactions"]
        assert isinstance(interactions, list)
        assert len(interactions) == 1
        assert interactions[0]["text"] == "test query"
        assert interactions[0]["intent"] == "search_bangumi"
        assert updated["last_intent"] == "search_bangumi"
        assert updated["last_status"] == "ok"
        assert updated["last_message"] == "found 3"

    def test_appends_multiple_interactions(self) -> None:
        prev = normalize_session_state(None)

        state = build_updated_session_state(
            prev,
            SessionUpdate(
                request=PublicAPIRequest(text="first"),
                response_intent="search_bangumi",
                response_status="ok",
                response_success=True,
            ),
        )
        state = build_updated_session_state(
            state,
            SessionUpdate(
                request=PublicAPIRequest(text="second"),
                response_intent="plan_route",
                response_status="ok",
                response_success=True,
            ),
        )

        interactions = state["interactions"]
        assert isinstance(interactions, list)
        assert len(interactions) == 2
        assert state["last_intent"] == "plan_route"

    def test_includes_context_delta(self) -> None:
        prev = normalize_session_state(None)
        delta = {"bangumi_id": "253", "anime_title": "test anime"}
        update = SessionUpdate(
            request=PublicAPIRequest(text="test"),
            response_intent="search_bangumi",
            response_status="ok",
            response_success=True,
            context_delta=delta,
        )

        updated = build_updated_session_state(prev, update)

        interactions = updated["interactions"]
        assert isinstance(interactions, list)
        assert interactions[0]["context_delta"] == delta


class TestBuildSessionSummary:
    def test_correct_counts(self) -> None:
        state = {
            "interactions": [{"text": "a"}, {"text": "b"}],
            "route_history": [{"id": "r1"}],
            "last_intent": "search_bangumi",
            "last_status": "ok",
            "last_message": "found",
        }
        summary = build_session_summary(state)

        assert summary["interaction_count"] == 2
        assert summary["route_history_count"] == 1
        assert summary["last_intent"] == "search_bangumi"
        assert summary["last_status"] == "ok"
        assert summary["last_message"] == "found"

    def test_empty_state(self) -> None:
        summary = build_session_summary({"interactions": [], "route_history": []})

        assert summary["interaction_count"] == 0
        assert summary["route_history_count"] == 0
        assert summary["last_intent"] is None

    def test_non_list_interactions(self) -> None:
        summary = build_session_summary({"interactions": "bad", "route_history": None})

        assert summary["interaction_count"] == 0
        assert summary["route_history_count"] == 0


class TestBuildContextBlock:
    def test_extracts_bangumi_and_location(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "search",
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "Eupho",
                        "location": "Uji",
                    },
                }
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None
        assert block["current_bangumi_id"] == "253"
        assert block["current_anime_title"] == "Eupho"
        assert block["last_location"] == "Uji"
        assert "253" in block["visited_bangumi_ids"]

    def test_returns_none_when_empty(self) -> None:
        state = {"interactions": [], "last_intent": None}
        assert build_context_block(state) is None

    def test_includes_summary_even_without_interactions(self) -> None:
        state = {"interactions": [], "summary": "previous session"}
        block = build_context_block(state)

        assert block is not None
        assert block["summary"] == "previous session"
        assert block["current_bangumi_id"] is None

    def test_merges_user_memory(self) -> None:
        state = {
            "interactions": [
                {"context_delta": {"bangumi_id": "253", "anime_title": "Eupho"}}
            ],
            "last_intent": "search_bangumi",
        }
        user_memory = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "Your Name", "last_at": "2026-03-01"},
            ]
        }
        block = build_context_block(state, user_memory=user_memory)

        assert block is not None
        assert "105" in block["visited_bangumi_ids"]
        assert "253" in block["visited_bangumi_ids"]

    def test_most_recent_from_user_memory_when_no_session_context(self) -> None:
        state = {"interactions": []}
        user_memory = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "Your Name", "last_at": "2026-03-01"},
                {"bangumi_id": "200", "title": "Newer", "last_at": "2026-04-01"},
            ]
        }
        block = build_context_block(state, user_memory=user_memory)

        assert block is not None
        assert block["current_bangumi_id"] == "200"
        assert block["current_anime_title"] == "Newer"


class TestExtractContextDelta:
    def test_from_resolve_anime(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="resolve_anime",
                    success=True,
                    params={"title": "Eupho"},
                    data={"bangumi_id": "253", "title": "Eupho"},
                )
            ],
        )

        delta = extract_context_delta(result)
        assert delta["bangumi_id"] == "253"
        assert delta["anime_title"] == "Eupho"

    def test_from_search_nearby(self) -> None:
        result = _make_agent_result(
            intent="search_nearby",
            steps=[
                StepRecord(
                    tool="search_nearby",
                    success=True,
                    params={"location": "Uji"},
                    data={"rows": []},
                )
            ],
        )

        delta = extract_context_delta(result)
        assert delta["location"] == "Uji"

    def test_empty_on_failure(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="resolve_anime",
                    success=False,
                    params={"title": "x"},
                    error="not found",
                )
            ],
        )

        delta = extract_context_delta(result)
        assert delta == {}

    def test_fallback_to_search_bangumi_rows(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="search_bangumi",
                    success=True,
                    params={"bangumi_id": "99"},
                    data={
                        "rows": [{"bangumi_id": "99", "title": "From Rows"}],
                        "row_count": 1,
                    },
                )
            ],
        )

        delta = extract_context_delta(result)
        assert delta["bangumi_id"] == "99"
        assert delta["anime_title"] == "From Rows"


class TestExtractContextDeltaSearchData:
    """AC: extract_context_delta persists last_search_data after search_bangumi."""

    def test_search_bangumi_success_includes_last_search_data(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="search_bangumi",
                    success=True,
                    params={"bangumi_id": "99"},
                    data={
                        "rows": [{"bangumi_id": "99", "title": "Eupho"}],
                        "row_count": 1,
                    },
                )
            ],
        )

        delta = extract_context_delta(result)
        assert "last_search_data" in delta
        search_data = delta["last_search_data"]
        assert isinstance(search_data, dict)
        assert search_data["rows"] == [{"bangumi_id": "99", "title": "Eupho"}]
        assert search_data["row_count"] == 1

    def test_no_search_bangumi_step_has_no_last_search_data(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="resolve_anime",
                    success=True,
                    params={"title": "Eupho"},
                    data={"bangumi_id": "99", "title": "Eupho"},
                )
            ],
        )

        delta = extract_context_delta(result)
        assert "last_search_data" not in delta

    def test_search_bangumi_failure_has_no_last_search_data(self) -> None:
        result = _make_agent_result(
            intent="search_bangumi",
            steps=[
                StepRecord(
                    tool="search_bangumi",
                    success=False,
                    params={"bangumi_id": "99"},
                    error="DB error",
                )
            ],
        )

        delta = extract_context_delta(result)
        assert "last_search_data" not in delta


class TestBuildContextBlockSearchData:
    """AC: build_context_block reconstructs last_search_data from interactions."""

    def test_reconstructs_last_search_data_from_most_recent_interaction(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "search eupho",
                    "context_delta": {
                        "bangumi_id": "99",
                        "last_search_data": {
                            "rows": [{"bangumi_id": "99", "title": "Eupho"}],
                            "row_count": 1,
                        },
                    },
                }
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None
        assert "last_search_data" in block
        search_data = block["last_search_data"]
        assert isinstance(search_data, dict)
        assert search_data["row_count"] == 1

    def test_uses_most_recent_interaction_with_search_data(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "first search",
                    "context_delta": {
                        "bangumi_id": "50",
                        "last_search_data": {
                            "rows": [{"bangumi_id": "50"}],
                            "row_count": 1,
                        },
                    },
                },
                {
                    "text": "second search",
                    "context_delta": {
                        "bangumi_id": "99",
                        "last_search_data": {
                            "rows": [{"bangumi_id": "99"}],
                            "row_count": 5,
                        },
                    },
                },
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None
        search_data = block["last_search_data"]
        assert isinstance(search_data, dict)
        assert search_data["row_count"] == 5

    def test_no_interactions_returns_none(self) -> None:
        state: dict[str, object] = {"interactions": []}
        block = build_context_block(state)
        assert block is None

    def test_no_search_data_in_interactions_has_no_key(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "search",
                    "context_delta": {"bangumi_id": "99", "anime_title": "Eupho"},
                }
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None
        assert "last_search_data" not in block

    def test_malformed_last_search_data_ignored_gracefully(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "search",
                    "context_delta": {
                        "bangumi_id": "99",
                        "last_search_data": "not-a-dict",
                    },
                }
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None
        assert "last_search_data" not in block

    def test_search_bangumi_only_no_resolve_anime_returns_non_none(self) -> None:
        """Correctness: last_search_data alone is sufficient to return a context block.

        Scenario: resolve_anime failed (or was not emitted) so no bangumi_id/
        location/summary is present, but search_bangumi succeeded and stored
        last_search_data.  The early-return guard must NOT fire.
        """
        state = {
            "interactions": [
                {
                    "text": "search eupho",
                    "context_delta": {
                        "last_search_data": {
                            "rows": [{"bangumi_id": "99", "title": "Eupho"}],
                            "row_count": 1,
                        },
                    },
                }
            ],
            "last_intent": "search_bangumi",
        }
        block = build_context_block(state)

        assert block is not None, (
            "build_context_block must not return None when last_search_data is populated"
        )
        assert "last_search_data" in block
        search_data = block["last_search_data"]
        assert isinstance(search_data, dict)
        assert search_data["row_count"] == 1
        assert block["current_bangumi_id"] is None


class TestAsStrOrNone:
    def test_none_returns_none(self) -> None:
        assert as_str_or_none(None) is None

    def test_empty_string_returns_none(self) -> None:
        assert as_str_or_none("") is None

    def test_whitespace_returns_none(self) -> None:
        assert as_str_or_none("   ") is None

    def test_valid_string_returns_stripped(self) -> None:
        assert as_str_or_none("  hello  ") == "hello"

    def test_integer_coerced(self) -> None:
        assert as_str_or_none(42) == "42"

    def test_zero_returns_string(self) -> None:
        assert as_str_or_none(0) == "0"
