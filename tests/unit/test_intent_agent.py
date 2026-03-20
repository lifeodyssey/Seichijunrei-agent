"""Unit tests for IntentAgent regex fast-path."""

from __future__ import annotations

import pytest

from agents.intent_agent import (
    ExtractedParams,
    IntentOutput,
    _extract_episode,
    _extract_location,
    _extract_route_origin,
    _match_bangumi_title,
    classify_intent_regex,
)


class TestBangumiTitleMatch:
    """Test bangumi title → ID matching."""

    @pytest.mark.parametrize("text,expected_id", [
        ("秒速5厘米的取景地", "927"),
        ("君の名は。の聖地", "160209"),
        ("你的名字取景地", "160209"),
        ("天气之子的圣地", "269235"),
        ("吹响吧上低音号的圣地", "115908"),
        ("響けユーフォニアムの聖地", "115908"),
        ("凉宫春日的忧郁取景地", "485"),
        ("轻音少女的圣地", "1424"),
        ("冰菓的取景地", "27364"),
        ("玉子市场圣地巡礼", "55113"),
        ("言叶之庭在哪里", "58949"),
        ("铃芽之旅的取景地", "362577"),
    ])
    def test_title_match(self, text: str, expected_id: str) -> None:
        assert _match_bangumi_title(text) == expected_id

    def test_no_match(self) -> None:
        assert _match_bangumi_title("今天天气不错") is None
        assert _match_bangumi_title("推荐一下") is None


class TestEpisodeExtraction:
    """Test episode number extraction."""

    @pytest.mark.parametrize("text,expected", [
        ("第3集", 3),
        ("第 5 话", 5),
        ("第12話", 12),
        ("ep3", 3),
        ("Episode 7", 7),
        ("没有集数", None),
    ])
    def test_episode(self, text: str, expected: int | None) -> None:
        assert _extract_episode(text) == expected


class TestLocationExtraction:
    """Test location name extraction."""

    @pytest.mark.parametrize("text,expected", [
        ("宇治附近有什么圣地", "宇治"),
        ("東京駅の近くにあるアニメ聖地", "東京駅"),
        ("新宿周辺のアニメスポット", "新宿"),
        ("京都有哪些动漫取景地", "京都"),
        ("秋叶原附近的圣地巡礼点", "秋叶原"),
    ])
    def test_location(self, text: str, expected: str) -> None:
        result = _extract_location(text)
        assert result == expected


class TestRouteOriginExtraction:
    """Test route origin extraction."""

    @pytest.mark.parametrize("text,expected", [
        ("从京都站出发去吹响的圣地", "京都站"),
        ("从新宿到天气之子取景地", "新宿"),
    ])
    def test_origin(self, text: str, expected: str) -> None:
        result = _extract_route_origin(text)
        assert result == expected


class TestClassifyIntentRegex:
    """Test the full regex classification pipeline."""

    def test_search_by_bangumi_cn(self) -> None:
        result = classify_intent_regex("秒速5厘米的取景地在哪")
        assert result is not None
        assert result.intent == "search_by_bangumi"
        assert result.extracted_params.bangumi == "927"

    def test_search_by_bangumi_ja(self) -> None:
        result = classify_intent_regex("君の名は。の聖地を教えて")
        assert result is not None
        assert result.intent == "search_by_bangumi"
        assert result.extracted_params.bangumi == "160209"

    def test_search_by_bangumi_with_episode(self) -> None:
        result = classify_intent_regex("吹响第3集出现的地方")
        assert result is not None
        assert result.intent == "search_by_bangumi"
        assert result.extracted_params.bangumi == "115908"
        assert result.extracted_params.episode == 3

    def test_search_by_location_cn(self) -> None:
        result = classify_intent_regex("宇治附近有什么圣地")
        assert result is not None
        assert result.intent == "search_by_location"
        assert result.extracted_params.location == "宇治"

    def test_search_by_location_ja(self) -> None:
        result = classify_intent_regex("東京駅の近くにあるアニメ聖地")
        assert result is not None
        assert result.intent == "search_by_location"
        assert result.extracted_params.location == "東京駅"

    def test_plan_route_cn(self) -> None:
        result = classify_intent_regex("从京都站出发去吹响的圣地")
        assert result is not None
        assert result.intent == "plan_route"
        assert result.extracted_params.bangumi == "115908"
        assert result.extracted_params.origin == "京都站"

    def test_plan_route_ja(self) -> None:
        result = classify_intent_regex("東京駅から君の名はの聖地を回るルート")
        assert result is not None
        assert result.intent == "plan_route"
        assert result.extracted_params.bangumi == "160209"

    def test_general_qa(self) -> None:
        result = classify_intent_regex("圣地巡礼是什么意思")
        assert result is not None
        assert result.intent == "general_qa"

    def test_unclear_short(self) -> None:
        result = classify_intent_regex("推荐一下")
        # Short input without bangumi → unclear or None
        assert result is None or result.intent == "unclear"

    def test_unclear_greeting(self) -> None:
        result = classify_intent_regex("你好")
        assert result is not None
        assert result.intent == "unclear"

    def test_empty_input(self) -> None:
        result = classify_intent_regex("")
        assert result is not None
        assert result.intent == "unclear"

    def test_combo_bangumi_location(self) -> None:
        result = classify_intent_regex("京都的冰菓取景地")
        assert result is not None
        assert result.intent == "search_by_bangumi"
        assert result.extracted_params.bangumi == "27364"

    def test_returns_none_for_ambiguous(self) -> None:
        """Ambiguous input should return None (fall through to LLM)."""
        result = classify_intent_regex("我想去日本旅游看看动漫相关的东西")
        # This is too vague for regex — should fall through
        assert result is None or result.intent in ("search_by_location", "general_qa")

    def test_output_model_valid(self) -> None:
        """Verify IntentOutput is a valid Pydantic model."""
        output = IntentOutput(
            intent="search_by_bangumi",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="927"),
            reasoning="test",
        )
        assert output.intent == "search_by_bangumi"
        assert output.confidence == 0.95
        assert output.extracted_params.bangumi == "927"
