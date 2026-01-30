"""Unit tests for IntentRouter helper functions.

Tests verify:
- Text extraction from user content
- Pattern matching for commands
- Language detection from state
- Selection detection logic
- Text normalization
"""

from google.genai import types

from adk_agents.seichijunrei_bot._intent.router import (
    _BACK_PATTERNS,
    _GREETING_PATTERNS,
    _HELP_PATTERNS,
    _RESET_PATTERNS,
    _SELECTION_PATTERNS,
    _STATUS_PATTERNS,
    _extract_user_text,
    _looks_like_selection,
    _matches_any,
    _normalize_text,
    _state_get_user_language,
    _text_response,
)
from adk_agents.seichijunrei_bot._state import BANGUMI_CANDIDATES, EXTRACTION_RESULT


class TestExtractUserText:
    """Tests for _extract_user_text function."""

    def test_extract_from_none(self):
        """Should return empty string for None content."""
        assert _extract_user_text(None) == ""

    def test_extract_from_single_part(self):
        """Should extract text from single part."""
        content = types.Content(role="user", parts=[types.Part(text="hello")])
        assert _extract_user_text(content) == "hello"

    def test_extract_from_multiple_parts(self):
        """Should join text from multiple parts."""
        content = types.Content(
            role="user",
            parts=[types.Part(text="hello"), types.Part(text="world")],
        )
        assert _extract_user_text(content) == "hello\nworld"

    def test_extract_strips_whitespace(self):
        """Should strip leading/trailing whitespace."""
        content = types.Content(role="user", parts=[types.Part(text="  hello  ")])
        assert _extract_user_text(content) == "hello"


class TestMatchesAny:
    """Tests for _matches_any function."""

    def test_empty_text_returns_false(self):
        """Should return False for empty text."""
        assert _matches_any("", _RESET_PATTERNS) is False

    def test_matches_reset_pattern(self):
        """Should match reset patterns."""
        assert _matches_any("reset", _RESET_PATTERNS) is True
        assert _matches_any("重新开始", _RESET_PATTERNS) is True

    def test_matches_back_pattern(self):
        """Should match back patterns."""
        assert _matches_any("back", _BACK_PATTERNS) is True
        assert _matches_any("返回", _BACK_PATTERNS) is True

    def test_matches_help_pattern(self):
        """Should match help patterns."""
        assert _matches_any("/help", _HELP_PATTERNS) is True
        assert _matches_any("帮助", _HELP_PATTERNS) is True

    def test_matches_status_pattern(self):
        """Should match status patterns."""
        assert _matches_any("/status", _STATUS_PATTERNS) is True
        assert _matches_any("状态", _STATUS_PATTERNS) is True

    def test_matches_selection_pattern(self):
        """Should match selection patterns."""
        assert _matches_any("1", _SELECTION_PATTERNS) is True
        assert _matches_any("first", _SELECTION_PATTERNS) is True
        assert _matches_any("第一个", _SELECTION_PATTERNS) is True

    def test_matches_greeting_pattern(self):
        """Should match greeting patterns."""
        assert _matches_any("hello", _GREETING_PATTERNS) is True
        assert _matches_any("你好", _GREETING_PATTERNS) is True

    def test_no_match_returns_false(self):
        """Should return False when no pattern matches."""
        assert _matches_any("random text", _RESET_PATTERNS) is False


class TestStateGetUserLanguage:
    """Tests for _state_get_user_language function."""

    def test_returns_default_for_empty_state(self):
        """Should return zh-CN for empty state."""
        assert _state_get_user_language({}) == "zh-CN"

    def test_returns_language_from_extraction(self):
        """Should return language from extraction result."""
        state = {EXTRACTION_RESULT: {"user_language": "en"}}
        assert _state_get_user_language(state) == "en"

    def test_returns_default_for_invalid_language(self):
        """Should return default for non-string language."""
        state = {EXTRACTION_RESULT: {"user_language": 123}}
        assert _state_get_user_language(state) == "zh-CN"


class TestTextResponse:
    """Tests for _text_response function."""

    def test_creates_model_content(self):
        """Should create content with model role."""
        response = _text_response("hello")
        assert response.role == "model"
        assert response.parts[0].text == "hello"


class TestNormalizeText:
    """Tests for _normalize_text function."""

    def test_removes_whitespace(self):
        """Should remove whitespace."""
        assert _normalize_text("hello world") == "helloworld"

    def test_removes_brackets(self):
        """Should remove various brackets."""
        assert _normalize_text("《灌篮高手》") == "灌篮高手"
        assert _normalize_text("「test」") == "test"

    def test_casefolds(self):
        """Should casefold text."""
        assert _normalize_text("HELLO") == "hello"


class TestLooksLikeSelection:
    """Tests for _looks_like_selection function."""

    def test_matches_number_pattern(self):
        """Should match number patterns."""
        assert _looks_like_selection("1", {}) is True
        assert _looks_like_selection("第一个", {}) is True

    def test_matches_candidate_title(self):
        """Should match candidate title."""
        state = {
            BANGUMI_CANDIDATES: {
                "candidates": [{"title": "SLAM DUNK", "title_cn": "灌篮高手"}]
            }
        }
        assert _looks_like_selection("灌篮高手", state) is True
        assert _looks_like_selection("SLAM DUNK", state) is True

    def test_no_match_without_candidates(self):
        """Should not match title without candidates."""
        assert _looks_like_selection("灌篮高手", {}) is False

    def test_short_text_returns_false(self):
        """Should return False for very short text."""
        state = {BANGUMI_CANDIDATES: {"candidates": [{"title": "AB"}]}}
        assert _looks_like_selection("A", state) is False

    def test_invalid_candidate_skipped(self):
        """Should skip non-dict candidates."""
        state = {BANGUMI_CANDIDATES: {"candidates": ["invalid", None]}}
        assert _looks_like_selection("test", state) is False
