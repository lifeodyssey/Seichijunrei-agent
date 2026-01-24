"""Unit tests for PlannerAgent.

Tests verify:
- Agent creation with correct configuration
- Prompt formatting with session context
- Integration with PlannerDecision schema
"""

from unittest.mock import patch

import pytest

from adk_agents.seichijunrei_bot._planner import (
    PlannerDecision,
    create_planner_agent,
    format_planner_prompt,
)
from adk_agents.seichijunrei_bot._state import BANGUMI_CANDIDATES


class TestCreatePlannerAgent:
    """Tests for create_planner_agent function."""

    def test_creates_llm_agent(self):
        """Should create an LlmAgent instance."""
        agent = create_planner_agent()
        assert agent is not None
        assert agent.name == "PlannerAgent"

    def test_agent_has_output_schema(self):
        """Agent should have PlannerDecision as output schema."""
        agent = create_planner_agent()
        assert agent.output_schema == PlannerDecision

    def test_agent_uses_configured_model(self):
        """Agent should use model from settings."""
        with patch("adk_agents.seichijunrei_bot._planner.planner_agent.get_settings") as mock:
            mock.return_value.planner_model = "gemini-1.5-flash"
            agent = create_planner_agent()
            assert agent.model == "gemini-1.5-flash"


class TestFormatPlannerPrompt:
    """Tests for format_planner_prompt function."""

    def test_includes_user_text(self):
        """Prompt should include user message."""
        prompt = format_planner_prompt("Your Name", {}, "en")
        assert "Your Name" in prompt

    def test_includes_has_candidates_false(self):
        """Prompt should indicate no candidates when state is empty."""
        prompt = format_planner_prompt("test", {}, "en")
        assert "Has candidates: False" in prompt

    def test_includes_has_candidates_true(self):
        """Prompt should indicate candidates when present in state."""
        state = {BANGUMI_CANDIDATES: {"candidates": [{"id": 1}]}}
        prompt = format_planner_prompt("test", state, "en")
        assert "Has candidates: True" in prompt

    def test_includes_user_language(self):
        """Prompt should include user language."""
        prompt = format_planner_prompt("test", {}, "ja")
        assert "User language: ja" in prompt

    def test_default_language_is_zh_cn(self):
        """Default language should be zh-CN."""
        prompt = format_planner_prompt("test", {})
        assert "User language: zh-CN" in prompt
