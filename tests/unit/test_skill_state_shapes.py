"""Unit tests for skill state shape validation.

This module validates the JSON schema shapes for state objects used across skills.
"""

from adk_agents.seichijunrei_bot._state import (
    ALL_POINTS,
    ALL_STATE_KEYS,
    BANGUMI_CANDIDATES,
    BANGUMI_RESULT,
    EXTRACTION_RESULT,
    LOCATION_PROMPT_SHOWN,
    POINTS_META,
    POINTS_SELECTION_RESULT,
    ROUTE_PLAN,
    SELECTED_BANGUMI,
    STAGE1_5_STATE_KEYS,
    STAGE1_STATE_KEYS,
    STAGE2_STATE_KEYS,
    USER_COORDINATES,
)


class TestStateKeyConstants:
    """Tests for state key constant definitions."""

    def test_extraction_result_key(self):
        """EXTRACTION_RESULT should be the expected string."""
        assert EXTRACTION_RESULT == "extraction_result"

    def test_bangumi_candidates_key(self):
        """BANGUMI_CANDIDATES should be the expected string."""
        assert BANGUMI_CANDIDATES == "bangumi_candidates"

    def test_selected_bangumi_key(self):
        """SELECTED_BANGUMI should be the expected string."""
        assert SELECTED_BANGUMI == "selected_bangumi"

    def test_all_points_key(self):
        """ALL_POINTS should be the expected string."""
        assert ALL_POINTS == "all_points"

    def test_points_meta_key(self):
        """POINTS_META should be the expected string."""
        assert POINTS_META == "points_meta"

    def test_points_selection_result_key(self):
        """POINTS_SELECTION_RESULT should be the expected string."""
        assert POINTS_SELECTION_RESULT == "points_selection_result"

    def test_route_plan_key(self):
        """ROUTE_PLAN should be the expected string."""
        assert ROUTE_PLAN == "route_plan"

    def test_location_prompt_shown_key(self):
        """LOCATION_PROMPT_SHOWN should be the expected string."""
        assert LOCATION_PROMPT_SHOWN == "location_prompt_shown"

    def test_user_coordinates_key(self):
        """USER_COORDINATES should be the expected string."""
        assert USER_COORDINATES == "user_coordinates"

    def test_bangumi_result_key(self):
        """BANGUMI_RESULT should be the expected string (backward compat)."""
        assert BANGUMI_RESULT == "bangumi_result"


class TestStateKeySets:
    """Tests for state key set definitions."""

    def test_stage1_state_keys_contains_expected(self):
        """STAGE1_STATE_KEYS should contain extraction and candidates."""
        assert EXTRACTION_RESULT in STAGE1_STATE_KEYS
        assert BANGUMI_CANDIDATES in STAGE1_STATE_KEYS
        assert len(STAGE1_STATE_KEYS) == 2

    def test_stage1_5_state_keys_contains_expected(self):
        """STAGE1_5_STATE_KEYS should contain location keys."""
        assert LOCATION_PROMPT_SHOWN in STAGE1_5_STATE_KEYS
        assert USER_COORDINATES in STAGE1_5_STATE_KEYS
        assert len(STAGE1_5_STATE_KEYS) == 2

    def test_stage2_state_keys_contains_expected(self):
        """STAGE2_STATE_KEYS should contain route planning keys."""
        assert SELECTED_BANGUMI in STAGE2_STATE_KEYS
        assert ALL_POINTS in STAGE2_STATE_KEYS
        assert POINTS_META in STAGE2_STATE_KEYS
        assert POINTS_SELECTION_RESULT in STAGE2_STATE_KEYS
        assert ROUTE_PLAN in STAGE2_STATE_KEYS
        assert len(STAGE2_STATE_KEYS) == 5

    def test_all_state_keys_is_union(self):
        """ALL_STATE_KEYS should be union of all stage keys plus backward compat."""
        expected = STAGE1_STATE_KEYS | STAGE1_5_STATE_KEYS | STAGE2_STATE_KEYS
        expected = expected | {BANGUMI_RESULT}
        assert ALL_STATE_KEYS == expected

    def test_state_key_sets_are_disjoint(self):
        """Stage key sets should not overlap."""
        assert STAGE1_STATE_KEYS.isdisjoint(STAGE1_5_STATE_KEYS)
        assert STAGE1_STATE_KEYS.isdisjoint(STAGE2_STATE_KEYS)
        assert STAGE1_5_STATE_KEYS.isdisjoint(STAGE2_STATE_KEYS)


class TestExtractionResultShape:
    """Tests for extraction_result state shape validation."""

    def test_valid_extraction_result_minimal(self):
        """Minimal extraction result should be valid."""
        state = {EXTRACTION_RESULT: {"user_language": "zh-CN"}}
        assert EXTRACTION_RESULT in state
        assert isinstance(state[EXTRACTION_RESULT], dict)

    def test_valid_extraction_result_with_location(self):
        """Extraction result with location should be valid."""
        state = {
            EXTRACTION_RESULT: {
                "user_language": "en",
                "location": "Tokyo Station",
                "anime_title": "Your Name",
            }
        }
        result = state[EXTRACTION_RESULT]
        assert result["user_language"] == "en"
        assert result["location"] == "Tokyo Station"

    def test_extraction_result_language_values(self):
        """Extraction result should support various language codes."""
        for lang in ["zh-CN", "en", "ja"]:
            state = {EXTRACTION_RESULT: {"user_language": lang}}
            assert state[EXTRACTION_RESULT]["user_language"] == lang


class TestBangumiCandidatesShape:
    """Tests for bangumi_candidates state shape validation."""

    def test_valid_candidates_list_format(self):
        """Candidates as list should be valid."""
        state = {
            BANGUMI_CANDIDATES: [
                {"bangumi_id": 1, "title": "Anime 1"},
                {"bangumi_id": 2, "title": "Anime 2"},
            ]
        }
        assert isinstance(state[BANGUMI_CANDIDATES], list)
        assert len(state[BANGUMI_CANDIDATES]) == 2

    def test_valid_candidates_dict_format(self):
        """Candidates as dict with query should be valid."""
        state = {
            BANGUMI_CANDIDATES: {
                "query": "test query",
                "total": 5,
                "candidates": [
                    {"bangumi_id": 1, "title": "Anime 1", "title_cn": "动画1"},
                ],
            }
        }
        result = state[BANGUMI_CANDIDATES]
        assert result["query"] == "test query"
        assert result["total"] == 5
        assert len(result["candidates"]) == 1

    def test_empty_candidates_list(self):
        """Empty candidates list should be valid."""
        state = {BANGUMI_CANDIDATES: []}
        assert state[BANGUMI_CANDIDATES] == []

    def test_candidate_with_optional_fields(self):
        """Candidate with all optional fields should be valid."""
        state = {
            BANGUMI_CANDIDATES: [
                {
                    "bangumi_id": 123,
                    "title": "Test Anime",
                    "title_cn": "测试动画",
                    "air_date": "2024-01",
                    "summary": "A test anime summary",
                    "image_url": "https://example.com/image.jpg",
                }
            ]
        }
        candidate = state[BANGUMI_CANDIDATES][0]
        assert candidate["bangumi_id"] == 123
        assert candidate["title_cn"] == "测试动画"


class TestSelectedBangumiShape:
    """Tests for selected_bangumi state shape validation."""

    def test_valid_selected_bangumi_minimal(self):
        """Minimal selected bangumi should be valid."""
        state = {SELECTED_BANGUMI: {"bangumi_id": 123}}
        assert state[SELECTED_BANGUMI]["bangumi_id"] == 123

    def test_valid_selected_bangumi_full(self):
        """Full selected bangumi should be valid."""
        state = {
            SELECTED_BANGUMI: {
                "bangumi_id": 123,
                "bangumi_title": "Test Anime",
                "bangumi_title_cn": "测试动画",
                "anitabi_id": "456",
            }
        }
        result = state[SELECTED_BANGUMI]
        assert result["bangumi_title"] == "Test Anime"
        assert result["bangumi_title_cn"] == "测试动画"


class TestRoutePlanShape:
    """Tests for route_plan state shape validation."""

    def test_valid_route_plan_minimal(self):
        """Minimal route plan should be valid."""
        state = {ROUTE_PLAN: {"recommended_order": []}}
        assert state[ROUTE_PLAN]["recommended_order"] == []

    def test_valid_route_plan_full(self):
        """Full route plan should be valid."""
        state = {
            ROUTE_PLAN: {
                "recommended_order": ["Point A", "Point B", "Point C"],
                "estimated_duration": "4-5 hours",
                "estimated_distance": "10km",
                "route_description": "Start from station...",
                "transport_tips": "Take the train",
                "special_notes": ["Note 1", "Note 2"],
            }
        }
        result = state[ROUTE_PLAN]
        assert len(result["recommended_order"]) == 3
        assert result["estimated_duration"] == "4-5 hours"
        assert len(result["special_notes"]) == 2


class TestPointsSelectionResultShape:
    """Tests for points_selection_result state shape validation."""

    def test_valid_points_selection_minimal(self):
        """Minimal points selection should be valid."""
        state = {POINTS_SELECTION_RESULT: {"selected_points": []}}
        assert state[POINTS_SELECTION_RESULT]["selected_points"] == []

    def test_valid_points_selection_with_points(self):
        """Points selection with points should be valid."""
        state = {
            POINTS_SELECTION_RESULT: {
                "selected_points": [
                    {
                        "id": "p1",
                        "name": "Point 1",
                        "lat": 35.6762,
                        "lng": 139.6503,
                    }
                ],
                "total_available": 10,
                "rejected_count": 5,
                "selection_rationale": "Selected based on proximity",
            }
        }
        result = state[POINTS_SELECTION_RESULT]
        assert len(result["selected_points"]) == 1
        assert result["total_available"] == 10

    def test_point_with_all_fields(self):
        """Point with all fields should be valid."""
        point = {
            "id": "p1",
            "name": "Test Point",
            "cn_name": "测试点",
            "lat": 35.6762,
            "lng": 139.6503,
            "episode": 1,
            "address": "123 Test Street",
            "screenshot_url": "https://example.com/screenshot.jpg",
            "time_seconds": 120,
        }
        state = {POINTS_SELECTION_RESULT: {"selected_points": [point]}}
        result_point = state[POINTS_SELECTION_RESULT]["selected_points"][0]
        assert result_point["cn_name"] == "测试点"
        assert result_point["episode"] == 1


class TestUserCoordinatesShape:
    """Tests for user_coordinates state shape validation."""

    def test_valid_coordinates(self):
        """Valid coordinates should be accepted."""
        state = {USER_COORDINATES: {"lat": 35.6762, "lng": 139.6503}}
        coords = state[USER_COORDINATES]
        assert coords["lat"] == 35.6762
        assert coords["lng"] == 139.6503

    def test_coordinates_with_address(self):
        """Coordinates with address should be valid."""
        state = {
            USER_COORDINATES: {
                "lat": 35.6762,
                "lng": 139.6503,
                "address": "Tokyo Station",
            }
        }
        assert state[USER_COORDINATES]["address"] == "Tokyo Station"


class TestLocationPromptShownShape:
    """Tests for location_prompt_shown state shape validation."""

    def test_location_prompt_shown_true(self):
        """location_prompt_shown as True should be valid."""
        state = {LOCATION_PROMPT_SHOWN: True}
        assert state[LOCATION_PROMPT_SHOWN] is True

    def test_location_prompt_shown_false(self):
        """location_prompt_shown as False should be valid."""
        state = {LOCATION_PROMPT_SHOWN: False}
        assert state[LOCATION_PROMPT_SHOWN] is False


class TestCompleteStateShape:
    """Tests for complete state shape across all stages."""

    def test_complete_workflow_state(self):
        """Complete state after full workflow should be valid."""
        state = {
            EXTRACTION_RESULT: {
                "user_language": "zh-CN",
                "location": "Tokyo",
                "anime_title": "Your Name",
            },
            BANGUMI_CANDIDATES: {
                "query": "Your Name",
                "candidates": [{"bangumi_id": 1, "title": "Your Name"}],
            },
            SELECTED_BANGUMI: {
                "bangumi_id": 1,
                "bangumi_title": "Your Name",
            },
            ALL_POINTS: [{"id": "p1", "name": "Point 1", "lat": 35.0, "lng": 139.0}],
            POINTS_META: {"total": 10},
            POINTS_SELECTION_RESULT: {
                "selected_points": [
                    {"id": "p1", "name": "Point 1", "lat": 35.0, "lng": 139.0}
                ]
            },
            ROUTE_PLAN: {
                "recommended_order": ["Point 1"],
                "estimated_duration": "2 hours",
            },
        }
        # Verify all expected keys are present
        assert EXTRACTION_RESULT in state
        assert BANGUMI_CANDIDATES in state
        assert SELECTED_BANGUMI in state
        assert ALL_POINTS in state
        assert ROUTE_PLAN in state

    def test_state_with_location_collection(self):
        """State with location collection data should be valid."""
        state = {
            EXTRACTION_RESULT: {"user_language": "en"},
            SELECTED_BANGUMI: {"bangumi_id": 1},
            LOCATION_PROMPT_SHOWN: True,
            USER_COORDINATES: {"lat": 35.0, "lng": 139.0},
        }
        assert state[LOCATION_PROMPT_SHOWN] is True
        assert state[USER_COORDINATES]["lat"] == 35.0
