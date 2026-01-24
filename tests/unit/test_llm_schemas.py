"""Unit tests for LLM schema models."""

from domain.llm_schemas import BangumiNameExtraction, BangumiSelection


class TestBangumiNameExtraction:
    """Tests for BangumiNameExtraction schema."""

    def test_create_with_name(self):
        """Should create extraction with bangumi name."""
        extraction = BangumiNameExtraction(bangumi_name="灌篮高手")
        assert extraction.bangumi_name == "灌篮高手"

    def test_create_with_english_name(self):
        """Should create extraction with English name."""
        extraction = BangumiNameExtraction(bangumi_name="Slam Dunk")
        assert extraction.bangumi_name == "Slam Dunk"


class TestBangumiSelection:
    """Tests for BangumiSelection schema."""

    def test_create_selection(self):
        """Should create selection with all fields."""
        selection = BangumiSelection(
            id=123,
            name="スラムダンク",
            name_cn="灌篮高手",
            confidence=0.95,
            reasoning="Title matches user query exactly",
        )
        assert selection.id == 123
        assert selection.name == "スラムダンク"
        assert selection.name_cn == "灌篮高手"
        assert selection.confidence == 0.95
        assert "matches" in selection.reasoning

    def test_confidence_range(self):
        """Should accept confidence values between 0 and 1."""
        low = BangumiSelection(
            id=1, name="A", name_cn="B", confidence=0.0, reasoning="Low"
        )
        high = BangumiSelection(
            id=2, name="C", name_cn="D", confidence=1.0, reasoning="High"
        )
        assert low.confidence == 0.0
        assert high.confidence == 1.0
