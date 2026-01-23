"""Unit tests for skill state contract validation."""

import pytest

from adk_agents.seichijunrei_bot._state import (
    ALL_POINTS,
    BANGUMI_CANDIDATES,
    EXTRACTION_RESULT,
    POINTS_META,
    POINTS_SELECTION_RESULT,
    ROUTE_PLAN,
    SELECTED_BANGUMI,
)
from adk_agents.seichijunrei_bot.skills import (
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
