"""Static response message templates for ExecutorAgent.

Keyed by (primary_tool, locale). These replace the LLM message call,
saving one LLM round-trip per request.
"""

from __future__ import annotations

_MESSAGES: dict[tuple[str, str], str] = {
    ("search_bangumi", "ja"): "{count}件の聖地が見つかりました。",
    ("search_bangumi", "zh"): "找到了{count}处圣地。",
    ("search_bangumi", "en"): "Found {count} pilgrimage spots.",
    ("search_nearby", "ja"): "この周辺に{count}件の聖地があります。",
    ("search_nearby", "zh"): "附近有{count}处圣地。",
    ("search_nearby", "en"): "Found {count} pilgrimage spots nearby.",
    ("plan_route", "ja"): "{count}件のスポットで最適ルートを作成しました。",
    ("plan_route", "zh"): "已为{count}处圣地规划路线。",
    ("plan_route", "en"): "Created a route with {count} pilgrimage stops.",
    ("plan_selected", "ja"): "{count}件の選択スポットでルートを作成しました。",
    ("plan_selected", "zh"): "已为{count}处选定取景地规划路线。",
    ("plan_selected", "en"): "Created a route with {count} selected stops.",
    ("answer_question", "ja"): "",
    ("answer_question", "zh"): "",
    ("answer_question", "en"): "",
    ("empty", "ja"): "該当する巡礼地が見つかりませんでした。",
    ("empty", "zh"): "没有找到相关的巡礼地。",
    ("empty", "en"): "No pilgrimage spots found.",
    ("unclear", "ja"): "もう少し具体的に教えていただけますか？",
    ("unclear", "zh"): "能再具体一些吗？",
    ("unclear", "en"): "Could you be more specific?",
    ("clarify", "ja"): "",
    ("clarify", "zh"): "",
    ("clarify", "en"): "",
}


def build_message(primary_tool: str, count: int, locale: str) -> str:
    """Build a static response message from template."""
    if count == 0:
        return _MESSAGES.get(("empty", locale), "")
    return _MESSAGES.get((primary_tool, locale), "").format(count=count)
