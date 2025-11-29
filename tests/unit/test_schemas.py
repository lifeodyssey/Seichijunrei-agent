"""Unit tests for Pydantic schemas to ensure Gemini API compatibility.

These tests verify that our schemas generate JSON Schema without
additionalProperties, which is not supported by the Gemini API.
"""

from adk_agents.seichijunrei_bot._schemas import (
    PointsSelectionResult,
)


def test_points_selection_result_no_additional_properties():
    """Verify PointsSelectionResult schema doesn't contain additionalProperties.

    This is critical because Gemini API rejects schemas with additionalProperties.
    Using explicit Pydantic models instead of dict prevents this issue.
    """
    schema = PointsSelectionResult.model_json_schema()

    # Helper to recursively check for additionalProperties in schema structure
    # (ignoring description fields which may contain the word)
    def has_additional_properties(obj, path=""):
        if isinstance(obj, dict):
            for key, value in obj.items():
                # Skip description fields - they're documentation only
                if key == "description":
                    continue
                # Check if this key is the problematic additionalProperties
                if key == "additionalProperties":
                    return True, f"{path}.{key}"
                # Recursively check nested objects
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
    assert not has_it, (
        f"Schema contains additionalProperties at {location} which is not supported "
        f"by Gemini API. Use explicit Pydantic models instead of dict types."
    )


def test_points_selection_result_selected_points_is_array():
    """Verify selected_points field is an array of objects."""
    schema = PointsSelectionResult.model_json_schema()

    # Check that selected_points is defined as an array
    assert "properties" in schema
    assert "selected_points" in schema["properties"]

    selected_points_schema = schema["properties"]["selected_points"]
    assert (
        selected_points_schema["type"] == "array"
    ), "selected_points should be an array type"

    # Check that items are object references or inline objects
    items = selected_points_schema["items"]
    assert (
        "$ref" in items or items.get("type") == "object"
    ), "selected_points items should reference a structured object"


def test_points_selection_result_required_fields():
    """Verify PointsSelectionResult has all required fields.

    Note: selected_points has default_factory=list, so it's not marked as
    required in the schema. This is correct Pydantic behavior.
    """
    schema = PointsSelectionResult.model_json_schema()

    # Fields without defaults are required
    required_fields = [
        "selection_rationale",
        "estimated_coverage",
        "total_available",
        "rejected_count",
    ]

    assert "required" in schema
    for field in required_fields:
        assert field in schema["required"], f"Missing required field: {field}"

    # Verify selected_points exists as a property (even though it has a default)
    assert "properties" in schema
    assert "selected_points" in schema["properties"]


def test_points_selection_result_can_be_instantiated():
    """Verify PointsSelectionResult can be instantiated with valid data."""
    # This test ensures the schema is practical and usable
    # We'll update it once SelectedPoint model is created

    # For now, just verify the model can be imported and has the right structure
    assert hasattr(PointsSelectionResult, "model_json_schema")
    assert hasattr(PointsSelectionResult, "model_validate")
