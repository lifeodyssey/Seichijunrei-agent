"""Deterministic intent classifier using regex + keyword matching.

Fast (~1ms) classification for common query patterns. When confidence is low,
returns AMBIGUOUS to let the ReAct planner disambiguate.
"""

from __future__ import annotations

import re
from enum import StrEnum


class QueryIntent(StrEnum):
    ANIME_SEARCH = "anime_search"
    NEARBY_SEARCH = "nearby_search"
    ROUTE_PLAN = "route_plan"
    QA = "qa"
    GREETING = "greeting"
    AMBIGUOUS = "ambiguous"


# Patterns for each intent (ordered by specificity)
_ROUTE_PATTERNS = [
    re.compile(
        r"ルート|路线|route|行程|回る|plan.*route|walking order|itinerary",
        re.IGNORECASE,
    ),
]

_NEARBY_PATTERNS = [
    re.compile(r"近く|附近|nearby|周辺|around|付近|周り", re.IGNORECASE),
    re.compile(r"(駅|站|station).*(聖地|取景|spot|location)", re.IGNORECASE),
    re.compile(r"(聖地|取景|spot|location).*(駅|站|station)", re.IGNORECASE),
]

_GREETING_PATTERNS = [
    re.compile(
        r"^(hi|hello|hey|こんにちは|你好|おはよう|やあ)\s*[!！.。]?\s*$",
        re.IGNORECASE,
    ),
    re.compile(
        r"^(what are you|你是谁|お前は誰|何ができる|what can you do)\s*[?？]?\s*$",
        re.IGNORECASE,
    ),
]

_QA_PATTERNS = [
    re.compile(r"聖地巡礼.*(マナー|etiquette|礼仪|注意)", re.IGNORECASE),
    re.compile(r"(tips|コツ|秘诀|おすすめ).*(聖地巡礼|pilgrimage)", re.IGNORECASE),
]

# Anime-related keywords that indicate a search query
_ANIME_KEYWORDS = [
    "聖地",
    "取景地",
    "pilgrimage",
    "filming location",
    "real life location",
    "ロケ地",
    "舞台",
    "アニメ",
    "anime",
    "动漫",
    "番剧",
]


def classify_intent(query: str, locale: str = "ja") -> tuple[QueryIntent, float]:
    """Classify query intent with confidence score.

    Returns (intent, confidence). If confidence < 0.7, returns AMBIGUOUS.
    """
    q = query.strip()

    # Greetings (high confidence, exact-ish match)
    for pat in _GREETING_PATTERNS:
        if pat.search(q):
            return QueryIntent.GREETING, 0.95

    # Route planning (high confidence keywords)
    for pat in _ROUTE_PATTERNS:
        if pat.search(q):
            return QueryIntent.ROUTE_PLAN, 0.85

    # Nearby search (location-based)
    for pat in _NEARBY_PATTERNS:
        if pat.search(q):
            return QueryIntent.NEARBY_SEARCH, 0.85

    # QA patterns
    for pat in _QA_PATTERNS:
        if pat.search(q):
            return QueryIntent.QA, 0.80

    # Anime search (keyword-based, moderate confidence)
    q_lower = q.lower()
    anime_hits = sum(1 for kw in _ANIME_KEYWORDS if kw.lower() in q_lower)
    if anime_hits >= 2:
        return QueryIntent.ANIME_SEARCH, 0.80
    if anime_hits == 1:
        return QueryIntent.ANIME_SEARCH, 0.70

    # If the query is short and doesn't match anything specific,
    # it's likely an anime title (most users come to search anime)
    if len(q) < 30 and not any(c in q for c in "?？"):
        return QueryIntent.ANIME_SEARCH, 0.70

    return QueryIntent.AMBIGUOUS, 0.40
