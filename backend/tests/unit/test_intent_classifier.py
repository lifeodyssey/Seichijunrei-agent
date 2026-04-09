"""Unit tests for intent classifier."""

from backend.agents.intent_classifier import QueryIntent, classify_intent


class TestClassifyIntent:
    def test_greeting_ja(self) -> None:
        intent, conf = classify_intent("こんにちは")
        assert intent == QueryIntent.GREETING
        assert conf >= 0.9

    def test_greeting_en(self) -> None:
        intent, conf = classify_intent("hello")
        assert intent == QueryIntent.GREETING
        assert conf >= 0.9

    def test_route_ja(self) -> None:
        intent, conf = classify_intent("君の名はのルートを計画して")
        assert intent == QueryIntent.ROUTE_PLAN
        assert conf >= 0.8

    def test_route_zh(self) -> None:
        intent, conf = classify_intent("帮我规划路线")
        assert intent == QueryIntent.ROUTE_PLAN
        assert conf >= 0.8

    def test_nearby_ja(self) -> None:
        intent, conf = classify_intent("宇治駅の近くの聖地")
        assert intent == QueryIntent.NEARBY_SEARCH
        assert conf >= 0.8

    def test_anime_search_explicit(self) -> None:
        intent, conf = classify_intent("君の名はの聖地巡礼スポット")
        assert intent == QueryIntent.ANIME_SEARCH
        assert conf >= 0.7

    def test_anime_title_only(self) -> None:
        intent, conf = classify_intent("響けユーフォニアム")
        assert intent == QueryIntent.ANIME_SEARCH
        # Short query, likely anime title

    def test_ambiguous_long(self) -> None:
        intent, conf = classify_intent(
            "I want to know about the best places to visit in Japan"
            " for culture and food recommendations"
        )
        assert intent == QueryIntent.AMBIGUOUS
        assert conf < 0.7

    def test_identity_question(self) -> None:
        intent, conf = classify_intent("你是谁？")
        assert intent == QueryIntent.GREETING
        assert conf >= 0.9
