"""IntentAgent — classifies user intent with regex fast-path + LLM fallback.

Intent categories:
    - search_by_location: User wants to find anime near a station/location
    - search_by_bangumi: User wants to visit locations from a specific anime
    - plan_route: User wants to generate an optimized walking route
    - general_qa: General questions about anime pilgrimage
    - unclear: Need clarification
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from agents.base import create_agent, get_default_model

# ── Structured output ────────────────────────────────────────────────


class ExtractedParams(BaseModel):
    """Typed parameters extracted from user input."""

    bangumi: str | None = Field(default=None, description="Bangumi ID")
    location: str | None = Field(default=None, description="Location/station name")
    episode: int | None = Field(default=None, description="Episode number")
    origin: str | None = Field(default=None, description="Route starting point")
    radius: int | None = Field(default=None, description="Search radius in meters")


class IntentOutput(BaseModel):
    """Structured output from intent classification."""

    intent: str = Field(
        ...,
        description="Classified intent: search_by_location, search_by_bangumi, plan_route, general_qa, unclear",
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Classification confidence")
    extracted_params: ExtractedParams = Field(
        default_factory=ExtractedParams,
        description="Extracted parameters (e.g. bangumi, location, episode, origin)",
    )
    reasoning: str = Field(default="", description="Brief reasoning for the classification")


# ── Bangumi title → ID mapping (seeded 17 anime) ────────────────────

BANGUMI_TITLE_MAP: dict[str, str] = {
    # Shinkai Makoto
    "君の名は。": "160209",
    "君の名は": "160209",
    "你的名字": "160209",
    "your name": "160209",
    "天気の子": "269235",
    "天气之子": "269235",
    "weathering with you": "269235",
    "すずめの戸締まり": "362577",
    "铃芽之旅": "362577",
    "铃芽户缔": "362577",
    "suzume": "362577",
    "秒速5センチメートル": "927",
    "秒速5厘米": "927",
    "秒速五厘米": "927",
    "5 centimeters per second": "927",
    "言の葉の庭": "58949",
    "言叶之庭": "58949",
    "garden of words": "58949",
    # KyoAni TV
    "響け！ユーフォニアム": "115908",
    "響けユーフォニアム": "115908",
    "響けユーフォ": "115908",
    "吹响吧上低音号": "115908",
    "吹响": "115908",
    "euphonium": "115908",
    "響け！ユーフォニアム2": "152091",
    "吹响2": "152091",
    "響け！ユーフォニアム3": "283643",
    "吹响3": "283643",
    "涼宮ハルヒの憂鬱": "485",
    "凉宫春日的忧郁": "485",
    "凉宫春日": "485",
    "haruhi": "485",
    "けいおん！": "1424",
    "けいおん": "1424",
    "轻音少女": "1424",
    "轻音": "1424",
    "k-on": "1424",
    "たまこまーけっと": "55113",
    "玉子市场": "55113",
    "tamako market": "55113",
    "氷菓": "27364",
    "冰菓": "27364",
    "冰果": "27364",
    "hyouka": "27364",
    # Hibike movies
    "リズと青い鳥": "216371",
    "利兹与青鸟": "216371",
    "liz and the blue bird": "216371",
}

# Build sorted keys (longest first for greedy matching)
_TITLE_KEYS_SORTED = sorted(BANGUMI_TITLE_MAP.keys(), key=len, reverse=True)
_TITLE_PATTERN = re.compile(
    "|".join(re.escape(k) for k in _TITLE_KEYS_SORTED),
    re.IGNORECASE,
)

# ── Regex patterns ───────────────────────────────────────────────────

# Episode extraction: 第N集/第N话/第N話/ep N/episode N
_EPISODE_PATTERN = re.compile(
    r"第\s*(\d+)\s*[集话話]|[Ee](?:p(?:isode)?)?\s*(\d+)",
)

# Route intent: 从X出发/到/去 + 路线/ルート
_ROUTE_PATTERN = re.compile(
    r"(?:从|從)(.+?)(?:出发|出發|到|去)"
    r"|(.+?)(?:から|より).*(?:ルート|回る|巡り|巡る)"
    r"|(?:规划|規劃|计划|計劃|帮我|幫我).*(?:路线|路線|ルート)",
)

# Route origin extraction
_ROUTE_ORIGIN_PATTERN = re.compile(
    r"(?:从|從)\s*(.+?)\s*(?:出发|出發|到|去)"
    r"|(.+?)\s*(?:から|より)",
)

# Location search: X附近/X周辺/X有什么/X有哪些
_LOCATION_PATTERN = re.compile(
    r"(.+?)(?:附近|周辺|周边|周邊|有什么|有哪些|にある|の近く)"
    r"|(?:在|去)(.+?)(?:的|找|看)",
)

# Bangumi search triggers (after title match)
_BANGUMI_TRIGGER = re.compile(
    r"取景地|圣地|聖地|巡礼|巡禮|场景|場景|スポット|ロケ地|舞台"
    r"|在哪|在哪里|在哪裡|どこ|出现|出現|出てく",
)

# General QA triggers
_QA_TRIGGER = re.compile(
    r"是什么|是什麼|とは|って何|マナー|注意|需要注意|怎么去|怎麼去|如何|攻略|ガイド",
)


# ── Regex fast-path ──────────────────────────────────────────────────


def _match_bangumi_title(text: str) -> str | None:
    """Try to match a bangumi title in the text. Returns bangumi_id or None."""
    m = _TITLE_PATTERN.search(text)
    if m:
        matched = m.group(0).lower()
        # Find the ID (case-insensitive lookup)
        for key, bid in BANGUMI_TITLE_MAP.items():
            if key.lower() == matched:
                return bid
    return None


def _extract_episode(text: str) -> int | None:
    """Extract episode number from text."""
    m = _EPISODE_PATTERN.search(text)
    if m:
        return int(m.group(1) or m.group(2))
    return None


def _extract_route_origin(text: str) -> str | None:
    """Extract route origin (station/location) from text."""
    m = _ROUTE_ORIGIN_PATTERN.search(text)
    if m:
        return (m.group(1) or m.group(2) or "").strip() or None
    return None


def _extract_location(text: str) -> str | None:
    """Extract location name from text."""
    m = _LOCATION_PATTERN.search(text)
    if m:
        loc = (m.group(1) or m.group(2) or "").strip()
        # Clean up: remove trailing particles
        loc = re.sub(r"[的に]$", "", loc).strip()
        return loc or None
    return None


def classify_intent_regex(text: str) -> IntentOutput | None:
    """Classify intent using regex patterns (no LLM call).

    Returns IntentOutput if confident, None if should fall through to LLM.
    """
    text_stripped = text.strip()
    if not text_stripped:
        return IntentOutput(
            intent="unclear", confidence=1.0,
            extracted_params=ExtractedParams(), reasoning="empty input",
        )

    bangumi_id = _match_bangumi_title(text_stripped)
    episode = _extract_episode(text_stripped)
    is_route = bool(_ROUTE_PATTERN.search(text_stripped))
    is_bangumi_trigger = bool(_BANGUMI_TRIGGER.search(text_stripped))

    # 1. Route intent (highest priority — has explicit origin + destination)
    if is_route and bangumi_id:
        origin = _extract_route_origin(text_stripped)
        return IntentOutput(
            intent="plan_route", confidence=0.95,
            extracted_params=ExtractedParams(
                bangumi=bangumi_id, origin=origin, episode=episode,
            ),
            reasoning="route pattern + bangumi title matched",
        )

    # 2. Bangumi search (title matched + search trigger)
    if bangumi_id and is_bangumi_trigger:
        location = _extract_location(text_stripped)
        return IntentOutput(
            intent="search_by_bangumi", confidence=0.95,
            extracted_params=ExtractedParams(
                bangumi=bangumi_id, episode=episode, location=location,
            ),
            reasoning="bangumi title + search trigger matched",
        )

    # 3. Bangumi + episode (title + episode number, no explicit trigger needed)
    if bangumi_id and episode:
        return IntentOutput(
            intent="search_by_bangumi", confidence=0.90,
            extracted_params=ExtractedParams(bangumi=bangumi_id, episode=episode),
            reasoning="bangumi title + episode number matched",
        )

    # 4. Location search (no bangumi title, but location pattern)
    if not bangumi_id:
        location = _extract_location(text_stripped)
        if location and (is_bangumi_trigger or re.search(r"动漫|アニメ|anime|圣地|聖地", text_stripped)):
            return IntentOutput(
                intent="search_by_location", confidence=0.90,
                extracted_params=ExtractedParams(location=location),
                reasoning="location pattern + anime/pilgrimage trigger",
            )

    # 5. General QA
    if _QA_TRIGGER.search(text_stripped) and not bangumi_id:
        return IntentOutput(
            intent="general_qa", confidence=0.80,
            extracted_params=ExtractedParams(),
            reasoning="QA trigger pattern matched",
        )

    # 6. Very short / greeting → unclear
    if len(text_stripped) <= 5 and not bangumi_id:
        return IntentOutput(
            intent="unclear", confidence=0.85,
            extracted_params=ExtractedParams(),
            reasoning="input too short to determine intent",
        )

    # No confident match → return None (fall through to LLM)
    return None


# ── LLM path ─────────────────────────────────────────────────────────

INTENT_SYSTEM_PROMPT = """\
You are an intent classifier for an anime pilgrimage (聖地巡礼) travel assistant.

Classify user messages into one of these intents:
- search_by_location: User mentions a station, city, or area and wants to find nearby anime locations
- search_by_bangumi: User mentions a specific anime title and wants to visit its real-world locations
- plan_route: User wants to generate an optimized walking route between pilgrimage points
- general_qa: General questions about anime pilgrimage
- unclear: Cannot determine intent, need clarification

Extract relevant parameters:
- bangumi: Bangumi ID if an anime is mentioned (use these IDs: 160209=你的名字, 269235=天气之子, \
362577=铃芽之旅, 927=秒速5厘米, 58949=言叶之庭, 115908=吹响, 152091=吹响2, 283643=吹响3, \
485=凉宫春日, 1424=轻音少女, 55113=玉子市场, 27364=冰菓, 216371=利兹与青鸟)
- location: Location/station name if mentioned
- episode: Episode number if mentioned
- origin: Starting point for route planning

Respond in the user's language (Japanese, Chinese, or English).
"""


def create_intent_agent(model: Any = None) -> object:
    """Create an IntentAgent with structured output.

    Returns a Pydantic AI Agent configured for intent classification.
    Will be called by the PlannerAgent in the Plan-and-Execute pattern.
    """
    return create_agent(
        model or get_default_model(),
        system_prompt=INTENT_SYSTEM_PROMPT,
        output_type=IntentOutput,
    )


async def classify_intent(text: str, *, model: Any = None) -> IntentOutput:
    """Classify user intent — regex fast-path, then LLM fallback.

    Args:
        text: User input text.
        model: LLM model identifier for fallback. Uses settings default if None.

    Returns:
        IntentOutput with classified intent and extracted parameters.
    """
    # Try regex first (free, fast, deterministic)
    result = classify_intent_regex(text)
    if result is not None:
        return result

    # LLM fallback
    agent = create_intent_agent(model)
    llm_result = await agent.run(text)
    return llm_result.output
