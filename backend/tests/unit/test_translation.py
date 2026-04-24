"""Unit tests for the translation module."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from backend.agents.translation import (
    TranslationResult,
    _lookup_db,
    translate_text,
    translate_title,
)


class TestLookupDb:
    async def test_returns_chinese_title(self) -> None:
        db = MagicMock()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "title": "君の名は。",
                    "title_cn": "你的名字。",
                }
            ]
        )
        result = await _lookup_db(db, "君の名は", "zh")
        assert result == "你的名字。"

    async def test_returns_japanese_title(self) -> None:
        db = MagicMock()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "title": "君の名は。",
                    "title_cn": "你的名字。",
                }
            ]
        )
        result = await _lookup_db(db, "你的名字", "ja")
        assert result == "君の名は。"

    async def test_returns_none_for_english(self) -> None:
        db = MagicMock()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "title": "君の名は。",
                    "title_cn": "你的名字。",
                }
            ]
        )
        result = await _lookup_db(db, "Your Name", "en")
        assert result is None

    async def test_returns_none_when_no_matches(self) -> None:
        db = MagicMock()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        result = await _lookup_db(db, "unknown", "zh")
        assert result is None

    async def test_returns_none_when_db_has_no_repo(self) -> None:
        db = MagicMock(spec=[])
        result = await _lookup_db(db, "test", "zh")
        assert result is None


class TestTranslateTitle:
    async def test_db_hit_returns_cached(self) -> None:
        db = MagicMock()
        db.bangumi.find_all_by_title = AsyncMock(
            return_value=[
                {
                    "title": "響け！ユーフォニアム",
                    "title_cn": "吹响！悠风号",
                }
            ]
        )
        result = await translate_title(
            "響け！ユーフォニアム", target_locale="zh", db=db
        )
        assert isinstance(result, TranslationResult)
        assert result.translated == "吹响！悠风号"
        assert result.source == "db"
        assert result.confidence == 1.0

    async def test_no_db_falls_through_returns_fallback(self) -> None:
        """When DB is None and all lookups fail, should return llm_fallback."""
        from unittest.mock import patch

        with (
            patch(
                "backend.agents.translation._lookup_bangumi_api",
                return_value=None,
            ),
            patch(
                "backend.agents.translation.translation_agent",
                MagicMock(),
            ) as mock_agent,
        ):
            mock_agent.run = AsyncMock(side_effect=RuntimeError("no model configured"))
            result = await translate_title(
                "nonexistent_anime_xyz", target_locale="zh", db=None
            )
        assert isinstance(result, TranslationResult)
        assert result.source == "llm_fallback"


class TestTranslateText:
    async def test_translate_text_returns_original_on_error(self) -> None:
        from unittest.mock import patch

        with patch(
            "backend.agents.translation.translation_agent",
            MagicMock(),
        ) as mock_agent:
            mock_agent.run = AsyncMock(side_effect=RuntimeError("model error"))
            result = await translate_text("hello world", target_locale="zh")
        assert result == "hello world"

    async def test_translate_text_strips_output(self) -> None:
        from unittest.mock import patch

        mock_result = MagicMock()
        mock_result.output = "  翻译结果  "
        with patch(
            "backend.agents.translation.translation_agent",
            MagicMock(),
        ) as mock_agent:
            mock_agent.run = AsyncMock(return_value=mock_result)
            result = await translate_text("test", target_locale="zh")
        assert result == "翻译结果"
