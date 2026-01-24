"""Unit tests for Planner schemas.

Tests verify:
- PlannerDecision schema validation
- Gemini API compatibility (no additionalProperties)
- Field constraints and defaults
"""

import pytest
from pydantic import ValidationError

from adk_agents.seichijunrei_bot._planner import PlannerDecision


class TestPlannerDecisionSchema:
    """Tests for PlannerDecision Pydantic model."""

    def test_valid_bangumi_search_decision(self):
        """Valid bangumi_search decision should be accepted."""
        decision = PlannerDecision(
            skill_id="bangumi_search",
            parameters={"query": "Your Name", "location": "Tokyo"},
            reasoning="User is asking about an anime title",
            confidence=0.95,
        )
        assert decision.skill_id == "bangumi_search"
        assert decision.parameters["query"] == "Your Name"
        assert decision.confidence == 0.95
        assert decision.requires_clarification is False
        assert decision.clarification_prompt is None

    def test_valid_route_planning_decision(self):
        """Valid route_planning decision should be accepted."""
        decision = PlannerDecision(
            skill_id="route_planning",
            parameters={"selection": "1"},
            reasoning="User selected option 1 from candidates",
            confidence=0.9,
        )
        assert decision.skill_id == "route_planning"
        assert decision.parameters["selection"] == "1"

    def test_valid_reset_decision(self):
        """Valid reset decision should be accepted."""
        decision = PlannerDecision(
            skill_id="reset",
            parameters={},
            reasoning="User wants to start over",
            confidence=1.0,
        )
        assert decision.skill_id == "reset"
        assert decision.parameters == {}

    def test_valid_unknown_with_clarification(self):
        """Unknown decision with clarification should be accepted."""
        decision = PlannerDecision(
            skill_id="unknown",
            parameters={},
            reasoning="Cannot determine user intent",
            confidence=0.3,
            requires_clarification=True,
            clarification_prompt="Could you please specify the anime title?",
        )
        assert decision.skill_id == "unknown"
        assert decision.requires_clarification is True
        assert decision.clarification_prompt is not None

    def test_invalid_skill_id_rejected(self):
        """Invalid skill_id should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PlannerDecision(
                skill_id="invalid_skill",
                parameters={},
                reasoning="Test",
                confidence=0.5,
            )
        assert "skill_id" in str(exc_info.value)

    def test_confidence_below_zero_rejected(self):
        """Confidence below 0 should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PlannerDecision(
                skill_id="bangumi_search",
                parameters={},
                reasoning="Test",
                confidence=-0.1,
            )
        assert "confidence" in str(exc_info.value)

    def test_confidence_above_one_rejected(self):
        """Confidence above 1 should be rejected."""
        with pytest.raises(ValidationError) as exc_info:
            PlannerDecision(
                skill_id="bangumi_search",
                parameters={},
                reasoning="Test",
                confidence=1.5,
            )
        assert "confidence" in str(exc_info.value)

    def test_default_parameters_is_empty_dict(self):
        """Parameters should default to empty dict."""
        decision = PlannerDecision(
            skill_id="help",
            reasoning="User asked for help",
            confidence=1.0,
        )
        assert decision.parameters == {}

    def test_all_valid_skill_ids(self):
        """All valid skill_ids should be accepted."""
        valid_ids = [
            "bangumi_search",
            "route_planning",
            "reset",
            "back",
            "help",
            "unknown",
        ]
        for skill_id in valid_ids:
            decision = PlannerDecision(
                skill_id=skill_id,
                reasoning=f"Testing {skill_id}",
                confidence=0.8,
            )
            assert decision.skill_id == skill_id


class TestPlannerDecisionGeminiCompatibility:
    """Tests for Gemini API compatibility."""

    def test_no_additional_properties_in_schema(self):
        """Schema should not contain additionalProperties for Gemini API."""
        schema = PlannerDecision.model_json_schema()

        def has_additional_properties(obj, path=""):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if key == "description":
                        continue
                    if key == "additionalProperties":
                        return True, f"{path}.{key}"
                    if isinstance(value, (dict, list)):
                        found, found_path = has_additional_properties(
                            value, f"{path}.{key}"
                        )
                        if found:
                            return True, found_path
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    found, found_path = has_additional_properties(item, f"{path}[{i}]")
                    if found:
                        return True, found_path
            return False, ""

        has_it, location = has_additional_properties(schema)
        assert not has_it, f"Schema has additionalProperties at {location}"

    def test_schema_has_required_fields(self):
        """Schema should have required fields defined."""
        schema = PlannerDecision.model_json_schema()
        assert "required" in schema
        assert "skill_id" in schema["required"]
        assert "reasoning" in schema["required"]
        assert "confidence" in schema["required"]

    def test_model_can_be_serialized_to_json(self):
        """Model should serialize to valid JSON."""
        decision = PlannerDecision(
            skill_id="bangumi_search",
            parameters={"query": "Test"},
            reasoning="Test reasoning",
            confidence=0.9,
        )
        json_str = decision.model_dump_json()
        assert "bangumi_search" in json_str
        assert "Test reasoning" in json_str
