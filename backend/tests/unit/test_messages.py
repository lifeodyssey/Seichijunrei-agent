"""Unit tests for backend.agents.messages."""

from __future__ import annotations

from backend.agents.messages import build_message


class TestBuildMessage:
    def test_search_bangumi_ja(self) -> None:
        msg = build_message("search_bangumi", 5, "ja")
        assert msg == "5件の聖地が見つかりました。"

    def test_search_bangumi_zh(self) -> None:
        msg = build_message("search_bangumi", 3, "zh")
        assert msg == "找到了3处圣地。"

    def test_search_bangumi_en(self) -> None:
        msg = build_message("search_bangumi", 10, "en")
        assert msg == "Found 10 pilgrimage spots."

    def test_search_nearby_ja(self) -> None:
        msg = build_message("search_nearby", 2, "ja")
        assert msg == "この周辺に2件の聖地があります。"

    def test_search_nearby_en(self) -> None:
        msg = build_message("search_nearby", 7, "en")
        assert msg == "Found 7 pilgrimage spots nearby."

    def test_plan_route_ja(self) -> None:
        msg = build_message("plan_route", 4, "ja")
        assert msg == "4件のスポットで最適ルートを作成しました。"

    def test_plan_route_en(self) -> None:
        msg = build_message("plan_route", 4, "en")
        assert msg == "Created a route with 4 pilgrimage stops."

    def test_plan_selected_zh(self) -> None:
        msg = build_message("plan_selected", 2, "zh")
        assert msg == "已为2处选定取景地规划路线。"

    def test_answer_question_returns_empty(self) -> None:
        msg = build_message("answer_question", 1, "ja")
        assert msg == ""

    def test_zero_count_returns_empty_message_ja(self) -> None:
        msg = build_message("search_bangumi", 0, "ja")
        assert msg == "該当する巡礼地が見つかりませんでした。"

    def test_zero_count_returns_empty_message_zh(self) -> None:
        msg = build_message("search_bangumi", 0, "zh")
        assert msg == "没有找到相关的巡礼地。"

    def test_zero_count_returns_empty_message_en(self) -> None:
        msg = build_message("search_bangumi", 0, "en")
        assert msg == "No pilgrimage spots found."

    def test_missing_locale_falls_back_to_empty(self) -> None:
        msg = build_message("search_bangumi", 5, "fr")
        assert msg == ""

    def test_unknown_tool_falls_back_to_empty(self) -> None:
        msg = build_message("unknown_tool", 5, "ja")
        assert msg == ""

    def test_unclear_ja(self) -> None:
        msg = build_message("unclear", 1, "ja")
        assert msg == "もう少し具体的に教えていただけますか？"

    def test_clarify_returns_empty(self) -> None:
        msg = build_message("clarify", 1, "en")
        assert msg == ""
