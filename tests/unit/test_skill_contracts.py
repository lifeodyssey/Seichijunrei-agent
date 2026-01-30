"""Unit tests for skill state contract validation."""

import pytest

from adk_agents.seichijunrei_bot._state import (
    ALL_POINTS,
    BANGUMI_CANDIDATES,
    EXTRACTION_RESULT,
    ROUTE_PLAN,
    SELECTED_BANGUMI,
)
from adk_agents.seichijunrei_bot.skills import (
    SKILLS,
    SKILLS_BY_ID,
    SKILLS_BY_NAME,
    STAGE1_5_LOCATION_COLLECTION,
    STAGE1_BANGUMI_SEARCH,
    STAGE2_ROUTE_PLANNING,
    StateContractError,
    get_skill_for_state,
    validate_skill_contract,
)


class TestSkillStateContract:
    """Tests for Skill state contract validation."""

    def test_stage1_has_no_required_keys(self):
        """Stage 1 skill should have no required keys."""
        assert STAGE1_BANGUMI_SEARCH.required_state_keys == frozenset()

    def test_stage2_requires_bangumi_candidates(self):
        """Stage 2 skill should require BANGUMI_CANDIDATES."""
        assert BANGUMI_CANDIDATES in STAGE2_ROUTE_PLANNING.required_state_keys

    def test_stage1_provides_stage1_keys(self):
        """Stage 1 should provide extraction and candidates."""
        assert EXTRACTION_RESULT in STAGE1_BANGUMI_SEARCH.provided_state_keys
        assert BANGUMI_CANDIDATES in STAGE1_BANGUMI_SEARCH.provided_state_keys

    def test_stage2_provides_stage2_keys(self):
        """Stage 2 should provide route planning keys."""
        assert SELECTED_BANGUMI in STAGE2_ROUTE_PLANNING.provided_state_keys
        assert ALL_POINTS in STAGE2_ROUTE_PLANNING.provided_state_keys
        assert ROUTE_PLAN in STAGE2_ROUTE_PLANNING.provided_state_keys

    def test_validate_preconditions_passes_with_required_keys(self):
        """Precondition validation passes when required keys present."""
        state = {BANGUMI_CANDIDATES: [{"id": 1, "name": "Test"}]}
        # Should not raise
        STAGE2_ROUTE_PLANNING.validate_preconditions(state)

    def test_validate_preconditions_fails_without_required_keys(self):
        """Precondition validation fails when required keys missing."""
        state = {}
        with pytest.raises(StateContractError) as exc_info:
            STAGE2_ROUTE_PLANNING.validate_preconditions(state)
        assert "Missing required state keys" in str(exc_info.value)
        assert "bangumi_candidates" in str(exc_info.value)

    def test_validate_postconditions_warns_on_missing_keys(self):
        """Postcondition validation warns when provided keys missing."""
        state = {EXTRACTION_RESULT: "test"}  # Missing BANGUMI_CANDIDATES
        # Should not raise, only log warning
        STAGE1_BANGUMI_SEARCH.validate_postconditions(state)

    def test_apply_reset_removes_keys(self):
        """apply_reset should remove reset_state_keys from state."""
        state = {
            BANGUMI_CANDIDATES: [{"id": 1}],
            EXTRACTION_RESULT: "test",
            SELECTED_BANGUMI: {"id": 1},
        }
        STAGE2_ROUTE_PLANNING.apply_reset(state)
        # Stage 2 reset keys should be removed
        assert SELECTED_BANGUMI not in state
        # Stage 1 keys should remain
        assert BANGUMI_CANDIDATES in state


class TestGetSkillForState:
    """Tests for get_skill_for_state function."""

    def test_empty_state_returns_stage1(self):
        """Empty state should return stage 1 skill."""
        skill = get_skill_for_state({})
        assert skill == STAGE1_BANGUMI_SEARCH

    def test_with_candidates_returns_stage2(self):
        """State with candidates should return stage 2 skill."""
        state = {BANGUMI_CANDIDATES: [{"id": 1, "name": "Test Anime"}]}
        skill = get_skill_for_state(state)
        assert skill == STAGE2_ROUTE_PLANNING

    def test_with_empty_candidates_returns_stage1(self):
        """State with empty candidates list should return stage 1."""
        state = {BANGUMI_CANDIDATES: []}
        skill = get_skill_for_state(state)
        assert skill == STAGE1_BANGUMI_SEARCH


class TestValidateSkillContract:
    """Tests for validate_skill_contract function."""

    def test_pre_phase_validates_preconditions(self):
        """'pre' phase should validate preconditions."""
        state = {}
        with pytest.raises(StateContractError):
            validate_skill_contract(STAGE2_ROUTE_PLANNING, state, phase="pre")

    def test_post_phase_validates_postconditions(self):
        """'post' phase should validate postconditions."""
        state = {EXTRACTION_RESULT: "test", BANGUMI_CANDIDATES: []}
        # Should not raise
        validate_skill_contract(STAGE1_BANGUMI_SEARCH, state, phase="post")

    def test_invalid_phase_raises_value_error(self):
        """Invalid phase should raise ValueError."""
        with pytest.raises(ValueError, match="Invalid phase"):
            validate_skill_contract(STAGE1_BANGUMI_SEARCH, {}, phase="invalid")


class TestSkillRegistry:
    """Tests for skill registry and lookup."""

    def test_skills_tuple_contains_all_skills(self):
        """SKILLS tuple should contain all defined skills."""
        assert STAGE1_BANGUMI_SEARCH in SKILLS
        assert STAGE1_5_LOCATION_COLLECTION in SKILLS
        assert STAGE2_ROUTE_PLANNING in SKILLS
        assert len(SKILLS) == 3

    def test_skills_by_id_lookup(self):
        """SKILLS_BY_ID should allow lookup by skill_id."""
        assert SKILLS_BY_ID["bangumi_search"] == STAGE1_BANGUMI_SEARCH
        assert SKILLS_BY_ID["location_collection"] == STAGE1_5_LOCATION_COLLECTION
        assert SKILLS_BY_ID["route_planning"] == STAGE2_ROUTE_PLANNING

    def test_skills_by_name_lookup(self):
        """SKILLS_BY_NAME should allow lookup by agent name."""
        # Access via the agent's name property
        assert SKILLS_BY_NAME[STAGE1_BANGUMI_SEARCH.name] == STAGE1_BANGUMI_SEARCH
        assert (
            SKILLS_BY_NAME[STAGE1_5_LOCATION_COLLECTION.name]
            == STAGE1_5_LOCATION_COLLECTION
        )
        assert SKILLS_BY_NAME[STAGE2_ROUTE_PLANNING.name] == STAGE2_ROUTE_PLANNING

    def test_skill_has_agent(self):
        """Each skill should have an associated agent."""
        for skill in SKILLS:
            assert skill.agent is not None
            assert hasattr(skill.agent, "name")

    def test_skill_id_is_unique(self):
        """All skill IDs should be unique."""
        skill_ids = [s.skill_id for s in SKILLS]
        assert len(skill_ids) == len(set(skill_ids))


class TestSkillContractConsistency:
    """Tests for consistency across skill contracts."""

    def test_stage1_reset_clears_all_state(self):
        """Stage 1 reset should clear all state for fresh start."""
        from adk_agents.seichijunrei_bot._state import ALL_STATE_KEYS

        # Stage 1 reset keys should include all state keys
        assert STAGE1_BANGUMI_SEARCH.reset_state_keys == frozenset(ALL_STATE_KEYS)

    def test_stage2_reset_only_clears_stage2_state(self):
        """Stage 2 reset should only clear Stage 2 state keys."""
        from adk_agents.seichijunrei_bot._state import STAGE2_STATE_KEYS

        assert STAGE2_ROUTE_PLANNING.reset_state_keys == frozenset(STAGE2_STATE_KEYS)

    def test_provided_keys_are_superset_of_reset_keys_for_stage2(self):
        """Stage 2 provided keys should match reset keys."""
        # When a skill provides keys, its reset should clear the same keys
        assert (
            STAGE2_ROUTE_PLANNING.provided_state_keys
            == STAGE2_ROUTE_PLANNING.reset_state_keys
        )

    def test_stage2_dependency_chain(self):
        """Stage 2 requires keys that Stage 1 provides."""
        # Stage 2 requires BANGUMI_CANDIDATES
        # Stage 1 provides BANGUMI_CANDIDATES
        assert STAGE2_ROUTE_PLANNING.required_state_keys.issubset(
            STAGE1_BANGUMI_SEARCH.provided_state_keys
        )


class TestSkillStateMachineEdgeCases:
    """Tests for edge cases in state-based skill selection."""

    def test_with_candidates_dict_structure_returns_stage2(self):
        """State with dict candidates structure should return stage 2."""
        state = {BANGUMI_CANDIDATES: {"query": "test", "candidates": [{"id": 1}]}}
        # The get_skill_for_state checks for truthy value
        skill = get_skill_for_state(state)
        assert skill == STAGE2_ROUTE_PLANNING

    def test_with_none_candidates_returns_stage1(self):
        """State with None candidates should return stage 1."""
        state = {BANGUMI_CANDIDATES: None}
        skill = get_skill_for_state(state)
        assert skill == STAGE1_BANGUMI_SEARCH

    def test_with_partial_state_returns_stage1(self):
        """State with only extraction but no candidates returns stage 1."""
        state = {EXTRACTION_RESULT: {"location": "Tokyo"}}
        skill = get_skill_for_state(state)
        assert skill == STAGE1_BANGUMI_SEARCH


class TestStage1_5LocationCollection:
    """Tests for Stage 1.5 Location Collection skill."""

    def test_stage1_5_requires_selected_bangumi(self):
        """Stage 1.5 skill should require SELECTED_BANGUMI."""
        assert SELECTED_BANGUMI in STAGE1_5_LOCATION_COLLECTION.required_state_keys

    def test_stage1_5_provides_location_keys(self):
        """Stage 1.5 should provide location collection keys."""
        from adk_agents.seichijunrei_bot._state import (
            LOCATION_PROMPT_SHOWN,
            USER_COORDINATES,
        )

        assert LOCATION_PROMPT_SHOWN in STAGE1_5_LOCATION_COLLECTION.provided_state_keys
        assert USER_COORDINATES in STAGE1_5_LOCATION_COLLECTION.provided_state_keys

    def test_stage1_5_reset_clears_location_state(self):
        """Stage 1.5 reset should clear location state keys."""
        from adk_agents.seichijunrei_bot._state import STAGE1_5_STATE_KEYS

        assert STAGE1_5_LOCATION_COLLECTION.reset_state_keys == frozenset(
            STAGE1_5_STATE_KEYS
        )

    def test_stage1_5_validate_preconditions_fails_without_selected_bangumi(self):
        """Stage 1.5 precondition validation fails without selected_bangumi."""
        state = {}
        with pytest.raises(StateContractError) as exc_info:
            STAGE1_5_LOCATION_COLLECTION.validate_preconditions(state)
        assert "Missing required state keys" in str(exc_info.value)
        assert "selected_bangumi" in str(exc_info.value)

    def test_stage1_5_validate_preconditions_passes_with_selected_bangumi(self):
        """Stage 1.5 precondition validation passes with selected_bangumi."""
        state = {SELECTED_BANGUMI: {"bangumi_id": 123, "title": "Test"}}
        # Should not raise
        STAGE1_5_LOCATION_COLLECTION.validate_preconditions(state)


class TestSkillResetBehavior:
    """Tests for skill reset behavior."""

    def test_stage1_reset_clears_all_keys(self):
        """Stage 1 reset should clear all state keys."""
        from adk_agents.seichijunrei_bot._state import (
            ALL_POINTS,
            LOCATION_PROMPT_SHOWN,
            POINTS_META,
            POINTS_SELECTION_RESULT,
            USER_COORDINATES,
        )

        state = {
            EXTRACTION_RESULT: {"location": "Tokyo"},
            BANGUMI_CANDIDATES: [{"id": 1}],
            SELECTED_BANGUMI: {"id": 1},
            ALL_POINTS: [{"name": "Point A"}],
            POINTS_META: {"total": 10},
            POINTS_SELECTION_RESULT: {"selected_points": []},
            ROUTE_PLAN: {"recommended_order": []},
            LOCATION_PROMPT_SHOWN: True,
            USER_COORDINATES: {"lat": 35.0, "lng": 139.0},
        }
        STAGE1_BANGUMI_SEARCH.apply_reset(state)
        # All keys should be removed
        assert len(state) == 0

    def test_stage2_reset_preserves_stage1_keys(self):
        """Stage 2 reset should preserve Stage 1 keys."""
        from adk_agents.seichijunrei_bot._state import ALL_POINTS, POINTS_META

        state = {
            EXTRACTION_RESULT: {"location": "Tokyo"},
            BANGUMI_CANDIDATES: [{"id": 1}],
            SELECTED_BANGUMI: {"id": 1},
            ALL_POINTS: [{"name": "Point A"}],
            POINTS_META: {"total": 10},
            ROUTE_PLAN: {"recommended_order": []},
        }
        STAGE2_ROUTE_PLANNING.apply_reset(state)
        # Stage 1 keys should remain
        assert EXTRACTION_RESULT in state
        assert BANGUMI_CANDIDATES in state
        # Stage 2 keys should be removed
        assert SELECTED_BANGUMI not in state
        assert ALL_POINTS not in state
        assert ROUTE_PLAN not in state

    def test_stage1_5_reset_preserves_other_keys(self):
        """Stage 1.5 reset should preserve non-location keys."""
        from adk_agents.seichijunrei_bot._state import (
            LOCATION_PROMPT_SHOWN,
            USER_COORDINATES,
        )

        state = {
            EXTRACTION_RESULT: {"location": "Tokyo"},
            BANGUMI_CANDIDATES: [{"id": 1}],
            SELECTED_BANGUMI: {"id": 1},
            LOCATION_PROMPT_SHOWN: True,
            USER_COORDINATES: {"lat": 35.0, "lng": 139.0},
        }
        STAGE1_5_LOCATION_COLLECTION.apply_reset(state)
        # Non-location keys should remain
        assert EXTRACTION_RESULT in state
        assert BANGUMI_CANDIDATES in state
        assert SELECTED_BANGUMI in state
        # Location keys should be removed
        assert LOCATION_PROMPT_SHOWN not in state
        assert USER_COORDINATES not in state

    def test_reset_on_empty_state_is_safe(self):
        """Reset on empty state should not raise."""
        state = {}
        STAGE1_BANGUMI_SEARCH.apply_reset(state)
        assert state == {}

        STAGE2_ROUTE_PLANNING.apply_reset(state)
        assert state == {}

        STAGE1_5_LOCATION_COLLECTION.apply_reset(state)
        assert state == {}


class TestSkillNameProperty:
    """Tests for skill name property."""

    def test_skill_name_matches_agent_name(self):
        """Skill name property should return agent name."""
        for skill in SKILLS:
            assert skill.name == skill.agent.name

    def test_skill_names_are_strings(self):
        """All skill names should be non-empty strings."""
        for skill in SKILLS:
            assert isinstance(skill.name, str)
            assert len(skill.name) > 0


class TestStateContractErrorDetails:
    """Tests for StateContractError exception details."""

    def test_error_contains_skill_id(self):
        """StateContractError should contain skill_id."""
        error = StateContractError("test_skill", "test message")
        assert error.skill_id == "test_skill"
        assert "test_skill" in str(error)

    def test_error_contains_message(self):
        """StateContractError should contain the message."""
        error = StateContractError("test_skill", "custom error message")
        assert "custom error message" in str(error)

    def test_error_format(self):
        """StateContractError should have proper format."""
        error = StateContractError("my_skill", "something went wrong")
        assert (
            str(error)
            == "State contract error in skill 'my_skill': something went wrong"
        )
