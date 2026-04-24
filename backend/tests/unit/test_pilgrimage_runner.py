"""Unit tests for pilgrimage_runner helper functions."""

from __future__ import annotations

from backend.agents.pilgrimage_runner import _seed_tool_state, _status_from_payload
from backend.agents.runtime_deps import RuntimeDeps


def test_seed_tool_state_sets_locale() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="test")
    _seed_tool_state(deps, None)
    assert deps.tool_state["locale"] == "zh"


def test_seed_tool_state_with_context() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(db=MagicMock(), locale="ja", query="test")
    context = {
        "last_location": "宇治",
        "origin_lat": 34.886,
        "origin_lng": 135.805,
        "last_search_data": {
            "search_bangumi": {"rows": [], "row_count": 0},
        },
    }
    _seed_tool_state(deps, context)
    assert deps.tool_state["last_location"] == "宇治"
    assert deps.tool_state["origin_lat"] == 34.886
    assert deps.tool_state["origin_lng"] == 135.805
    assert "search_bangumi" in deps.tool_state


def test_seed_tool_state_ignores_non_string_location() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(db=MagicMock(), locale="en", query="test")
    _seed_tool_state(deps, {"last_location": 123})
    assert "last_location" not in deps.tool_state


def test_seed_tool_state_ignores_non_dict_search_data() -> None:
    from unittest.mock import MagicMock

    deps = RuntimeDeps(db=MagicMock(), locale="en", query="test")
    _seed_tool_state(deps, {"last_search_data": "not_a_dict"})
    assert "search_bangumi" not in deps.tool_state


def test_status_from_payload_extracts_status() -> None:
    assert _status_from_payload({"status": "ok"}, fallback="err") == "ok"


def test_status_from_payload_uses_fallback_for_missing() -> None:
    assert _status_from_payload({}, fallback="err") == "err"
    assert _status_from_payload(None, fallback="err") == "err"
    assert _status_from_payload("not_a_dict", fallback="err") == "err"


def test_status_from_payload_uses_fallback_for_empty_string() -> None:
    assert _status_from_payload({"status": ""}, fallback="err") == "err"
