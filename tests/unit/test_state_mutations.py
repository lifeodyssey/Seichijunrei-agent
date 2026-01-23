"""Unit tests for A2UI state mutations."""

import pytest

from adk_agents.seichijunrei_bot._state import (
    BANGUMI_CANDIDATES,
    SELECTED_BANGUMI,
)
from interfaces.a2ui_web.state_mutations import (
    go_back_to_candidates,
    remove_selected_point_by_index,
    select_candidate_by_index,
)


class TestSelectCandidateByIndex:
    """Tests for select_candidate_by_index function."""

    def test_select_valid_candidate(self):
        """Test selecting a valid candidate by index."""
        state = {
            BANGUMI_CANDIDATES: {
                "query": "fate",
                "candidates": [
                    {"id": 1, "title": "Fate/Zero", "title_cn": "命运之夜", "air_date": "2011"},
                    {"id": 2, "title": "Fate/Stay Night", "title_cn": "命运之夜", "air_date": "2006"},
                ],
            }
        }

        result = select_candidate_by_index(state, index_1=1)

        assert result is True
        assert SELECTED_BANGUMI in state
        selected = state[SELECTED_BANGUMI]
        assert selected["bangumi_id"] == 1
        assert selected["bangumi_title"] == "命运之夜"
        assert selected["bangumi_title_original"] == "Fate/Zero"
        assert selected["selection_index"] == 1

    def test_select_second_candidate(self):
        """Test selecting the second candidate."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [
                    {"id": 100, "title": "First"},
                    {"id": 200, "title": "Second"},
                    {"id": 300, "title": "Third"},
                ],
            }
        }

        result = select_candidate_by_index(state, index_1=2)

        assert result is True
        assert state[SELECTED_BANGUMI]["bangumi_id"] == 200
        assert state[SELECTED_BANGUMI]["selection_index"] == 2

    def test_select_invalid_index_zero(self):
        """Test that index 0 (1-based) returns False."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "Test"}],
            }
        }

        result = select_candidate_by_index(state, index_1=0)

        assert result is False
        assert SELECTED_BANGUMI not in state

    def test_select_invalid_index_too_high(self):
        """Test that index beyond candidates returns False."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "Test"}],
            }
        }

        result = select_candidate_by_index(state, index_1=5)

        assert result is False
        assert SELECTED_BANGUMI not in state

    def test_select_negative_index(self):
        """Test that negative index returns False."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "Test"}],
            }
        }

        result = select_candidate_by_index(state, index_1=-1)

        assert result is False

    def test_select_without_candidates_data(self):
        """Test selection fails when no candidates in state."""
        state = {}

        result = select_candidate_by_index(state, index_1=1)

        assert result is False
        assert SELECTED_BANGUMI not in state

    def test_select_with_empty_candidates(self):
        """Test selection fails with empty candidates list."""
        state = {BANGUMI_CANDIDATES: {"candidates": []}}

        result = select_candidate_by_index(state, index_1=1)

        assert result is False

    def test_select_clears_stage2_state(self):
        """Test that selection clears existing Stage 2 state."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "New Selection"}],
            },
            SELECTED_BANGUMI: {"bangumi_id": 999, "bangumi_title": "Old"},
            "all_points": [{"name": "Point A"}],
            "points_meta": {"count": 1},
            "points_selection_result": {"selected_points": []},
            "route_plan": {"stops": []},
        }

        result = select_candidate_by_index(state, index_1=1)

        assert result is True
        assert state[SELECTED_BANGUMI]["bangumi_id"] == 1
        # Stage 2 keys should be cleared
        assert "all_points" not in state
        assert "points_meta" not in state
        assert "points_selection_result" not in state
        assert "route_plan" not in state

    def test_select_with_alternative_field_names(self):
        """Test selection handles different candidate field naming."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [
                    {"bangumi_id": 123, "name": "Alt Name", "name_cn": "中文名"},
                ],
            }
        }

        result = select_candidate_by_index(state, index_1=1)

        assert result is True
        assert state[SELECTED_BANGUMI]["bangumi_id"] == 123
        assert state[SELECTED_BANGUMI]["bangumi_title"] == "中文名"
        assert state[SELECTED_BANGUMI]["bangumi_title_original"] == "Alt Name"


class TestRemoveSelectedPointByIndex:
    """Tests for remove_selected_point_by_index function."""

    def test_remove_valid_point(self):
        """Test removing a valid point."""
        state = {
            "points_selection_result": {
                "selected_points": [
                    {"name": "Point A"},
                    {"name": "Point B"},
                    {"name": "Point C"},
                ],
                "total_available": 5,
                "selection_rationale": "Initial selection",
            },
            "extraction_result": {"location": "Tokyo"},
            "selected_bangumi": {"bangumi_title": "Test Anime"},
        }

        result = remove_selected_point_by_index(state, index_0=1)

        assert result is True
        selected = state["points_selection_result"]["selected_points"]
        assert len(selected) == 2
        assert selected[0]["name"] == "Point A"
        assert selected[1]["name"] == "Point C"

    def test_remove_invalid_index(self):
        """Test removing with invalid index returns False."""
        state = {
            "points_selection_result": {
                "selected_points": [{"name": "Point A"}],
            }
        }

        result = remove_selected_point_by_index(state, index_0=5)

        assert result is False

    def test_remove_without_points_selection(self):
        """Test removal fails without points_selection_result."""
        state = {}

        result = remove_selected_point_by_index(state, index_0=0)

        assert result is False


class TestGoBackToCandidates:
    """Tests for go_back_to_candidates function."""

    def test_go_back_clears_selection(self):
        """Test that go_back clears selected_bangumi and Stage 2 state."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "Test"}],
            },
            SELECTED_BANGUMI: {"bangumi_id": 1, "bangumi_title": "Test"},
            "all_points": [{"name": "Point A"}],
            "points_meta": {"count": 1},
            "points_selection_result": {"selected_points": []},
            "route_plan": {"stops": []},
        }

        result = go_back_to_candidates(state)

        assert result is True
        assert SELECTED_BANGUMI not in state
        assert "all_points" not in state
        assert "points_meta" not in state
        assert "points_selection_result" not in state
        assert "route_plan" not in state
        # Candidates should remain
        assert BANGUMI_CANDIDATES in state

    def test_go_back_fails_without_candidates(self):
        """Test that go_back fails when no candidates exist."""
        state = {
            SELECTED_BANGUMI: {"bangumi_id": 1},
        }

        result = go_back_to_candidates(state)

        assert result is False
        # Selection should not be cleared if back failed
        assert SELECTED_BANGUMI in state

    def test_go_back_fails_with_empty_candidates(self):
        """Test that go_back fails with empty candidates list."""
        state = {
            BANGUMI_CANDIDATES: {"candidates": []},
            SELECTED_BANGUMI: {"bangumi_id": 1},
        }

        result = go_back_to_candidates(state)

        assert result is False

    def test_go_back_preserves_extraction_result(self):
        """Test that go_back preserves Stage 1 state like extraction_result."""
        state = {
            "extraction_result": {"location": "Tokyo", "anime": "Test"},
            BANGUMI_CANDIDATES: {
                "candidates": [{"id": 1, "title": "Test"}],
            },
            SELECTED_BANGUMI: {"bangumi_id": 1},
            "route_plan": {"stops": []},
        }

        result = go_back_to_candidates(state)

        assert result is True
        # Extraction should remain
        assert state["extraction_result"]["location"] == "Tokyo"
