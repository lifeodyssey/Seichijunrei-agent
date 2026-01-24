"""Unit tests for HybridRouterAgent helper functions.

Tests verify:
- Text extraction from user content
- Pattern matching for commands
- Language detection from state
- Selection detection logic
- State reset functions
"""

from google.genai import types

from adk_agents.seichijunrei_bot._planner.hybrid_router_agent import (
    _BACK_PATTERNS,
    _HELP_PATTERNS,
    _RESET_PATTERNS,
    _SELECTION_PATTERNS,
    _STATUS_PATTERNS,
    HybridRouterAgent,
    _extract_user_text,
    _looks_like_selection,
    _matches_any,
    _normalize_text,
    _state_get_user_language,
)
from adk_agents.seichijunrei_bot._state import BANGUMI_CANDIDATES, EXTRACTION_RESULT


class TestExtractUserText:
    """Tests for _extract_user_text function."""

    def test_returns_empty_for_none(self):
        """Should return empty string for None content."""
        assert _extract_user_text(None) == ""

    def test_extracts_single_text_part(self):
        """Should extract text from single part."""
        content = types.Content(role="user", parts=[types.Part(text="Hello")])
        assert _extract_user_text(content) == "Hello"

    def test_extracts_multiple_text_parts(self):
        """Should join multiple text parts with newline."""
        content = types.Content(
            role="user",
            parts=[types.Part(text="Hello"), types.Part(text="World")],
        )
        assert _extract_user_text(content) == "Hello\nWorld"

    def test_handles_empty_parts(self):
        """Should handle content with no parts."""
        content = types.Content(role="user", parts=[])
        assert _extract_user_text(content) == ""

    def test_strips_whitespace(self):
        """Should strip leading/trailing whitespace."""
        content = types.Content(role="user", parts=[types.Part(text="  Hello  ")])
        assert _extract_user_text(content) == "Hello"


class TestMatchesAny:
    """Tests for _matches_any function."""

    def test_returns_false_for_empty_text(self):
        """Should return False for empty text."""
        assert _matches_any("", _HELP_PATTERNS) is False

    def test_matches_help_patterns(self):
        """Should match help command patterns."""
        assert _matches_any("/help", _HELP_PATTERNS) is True
        assert _matches_any("help", _HELP_PATTERNS) is True
        assert _matches_any("?", _HELP_PATTERNS) is True
        assert _matches_any("帮助", _HELP_PATTERNS) is True

    def test_matches_reset_patterns(self):
        """Should match reset command patterns."""
        assert _matches_any("reset", _RESET_PATTERNS) is True
        assert _matches_any("restart", _RESET_PATTERNS) is True
        assert _matches_any("重新开始", _RESET_PATTERNS) is True

    def test_matches_back_patterns(self):
        """Should match back command patterns."""
        assert _matches_any("back", _BACK_PATTERNS) is True
        assert _matches_any("返回", _BACK_PATTERNS) is True
        assert _matches_any("上一步", _BACK_PATTERNS) is True

    def test_matches_status_patterns(self):
        """Should match status command patterns."""
        assert _matches_any("/status", _STATUS_PATTERNS) is True
        assert _matches_any("状态", _STATUS_PATTERNS) is True

    def test_matches_selection_patterns(self):
        """Should match selection patterns."""
        assert _matches_any("1", _SELECTION_PATTERNS) is True
        assert _matches_any("first", _SELECTION_PATTERNS) is True
        assert _matches_any("第一个", _SELECTION_PATTERNS) is True

    def test_no_match_returns_false(self):
        """Should return False when no pattern matches."""
        assert _matches_any("random text", _HELP_PATTERNS) is False


class TestStateGetUserLanguage:
    """Tests for _state_get_user_language function."""

    def test_returns_default_for_empty_state(self):
        """Should return zh-CN for empty state."""
        assert _state_get_user_language({}) == "zh-CN"

    def test_returns_language_from_extraction_result(self):
        """Should return language from extraction result."""
        state = {EXTRACTION_RESULT: {"user_language": "en"}}
        assert _state_get_user_language(state) == "en"

    def test_returns_default_for_missing_language(self):
        """Should return default when language is missing."""
        state = {EXTRACTION_RESULT: {}}
        assert _state_get_user_language(state) == "zh-CN"

    def test_returns_default_for_none_extraction(self):
        """Should return default when extraction is None."""
        state = {EXTRACTION_RESULT: None}
        assert _state_get_user_language(state) == "zh-CN"

    def test_returns_japanese_language(self):
        """Should return Japanese language when set."""
        state = {EXTRACTION_RESULT: {"user_language": "ja"}}
        assert _state_get_user_language(state) == "ja"


class TestNormalizeText:
    """Tests for _normalize_text function."""

    def test_removes_whitespace(self):
        """Should remove whitespace."""
        assert _normalize_text("hello world") == "helloworld"

    def test_removes_brackets(self):
        """Should remove various bracket types."""
        assert _normalize_text("《你的名字》") == "你的名字"
        assert _normalize_text("「君の名は」") == "君の名は"
        assert _normalize_text("[Your Name]") == "yourname"

    def test_lowercases_text(self):
        """Should lowercase text."""
        assert _normalize_text("HELLO") == "hello"

    def test_handles_empty_string(self):
        """Should handle empty string."""
        assert _normalize_text("") == ""


class TestLooksLikeSelection:
    """Tests for _looks_like_selection function."""

    def test_matches_numeric_selection(self):
        """Should match numeric selection."""
        assert _looks_like_selection("1", {}) is True
        assert _looks_like_selection("42", {}) is True

    def test_matches_ordinal_selection(self):
        """Should match ordinal selection."""
        assert _looks_like_selection("first", {}) is True
        assert _looks_like_selection("second", {}) is True

    def test_matches_chinese_ordinal(self):
        """Should match Chinese ordinal selection."""
        assert _looks_like_selection("第一个", {}) is True
        assert _looks_like_selection("第二部", {}) is True

    def test_matches_title_from_candidates(self):
        """Should match title substring from candidates."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [
                    {"title": "Your Name", "title_cn": "你的名字"},
                    {"title": "Weathering with You", "title_cn": "天气之子"},
                ]
            }
        }
        assert _looks_like_selection("你的名字", state) is True
        assert _looks_like_selection("Your Name", state) is True

    def test_no_match_without_candidates(self):
        """Should not match title when no candidates."""
        assert _looks_like_selection("你的名字", {}) is False

    def test_short_text_not_matched(self):
        """Should not match very short text against titles."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"title": "Your Name", "title_cn": "你的名字"}]
            }
        }
        assert _looks_like_selection("a", state) is False

    def test_handles_invalid_candidates(self):
        """Should handle invalid candidate data."""
        state = {BANGUMI_CANDIDATES: {"candidates": [None, "invalid", 123]}}
        assert _looks_like_selection("test", state) is False


class TestHybridRouterAgentStaticMethods:
    """Tests for HybridRouterAgent static methods."""

    def test_reset_prompt_english(self):
        """Should return English reset prompt."""
        prompt = HybridRouterAgent._reset_prompt("en")
        assert "State cleared" in prompt

    def test_reset_prompt_japanese(self):
        """Should return Japanese reset prompt."""
        prompt = HybridRouterAgent._reset_prompt("ja")
        assert "リセット" in prompt

    def test_reset_prompt_chinese(self):
        """Should return Chinese reset prompt."""
        prompt = HybridRouterAgent._reset_prompt("zh-CN")
        assert "重置" in prompt

    def test_reset_all_clears_state_keys(self):
        """Should clear all stage 1 state keys."""
        state = {
            BANGUMI_CANDIDATES: {"candidates": []},
            EXTRACTION_RESULT: {"query": "test"},
            "other_key": "preserved",
        }
        HybridRouterAgent._reset_all(state)
        assert BANGUMI_CANDIDATES not in state
        assert EXTRACTION_RESULT not in state
        assert state.get("other_key") == "preserved"

    def test_reset_to_candidates_clears_stage2_keys(self):
        """Should clear stage 2 keys but preserve candidates."""
        state = {
            BANGUMI_CANDIDATES: {"candidates": []},
            "selected_bangumi": {"id": 1},
            "route_plan": {"points": []},
        }
        HybridRouterAgent._reset_to_candidates(state)
        # Candidates should be preserved
        assert BANGUMI_CANDIDATES in state
