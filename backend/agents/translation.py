"""Translation Agent — multilingual anime title and content translation.

Provides a web-search-backed translation tool for the pilgrimage agent.
Translation chain (cheapest first):
1. DB cache (bangumi table has title + title_cn)
2. Bangumi API (search_subject returns name + name_cn)
3. DuckDuckGo web search (萌娘百科, Wikipedia, etc.)
4. LLM fallback (last resort)

This module does NOT hard-translate anime titles. It searches authoritative
sources (Bangumi, 萌娘百科, Wikipedia) to find the community-accepted
translation, which may differ from a literal translation.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog
from pydantic_ai import Agent
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool

from backend.agents.base import resolve_model

logger = structlog.get_logger(__name__)


@dataclass
class TranslationDeps:
    """Dependencies for the translation agent."""

    db: object | None = None
    source_locale: str = ""
    target_locale: str = ""


@dataclass
class TranslationResult:
    """Result of a translation lookup."""

    original: str
    translated: str
    source: str  # "db", "bangumi_api", "web_search", "llm_fallback"
    confidence: float = 1.0  # 1.0 = authoritative, 0.5 = web search, 0.3 = LLM guess


# ── Deterministic lookup functions (no LLM needed) ──────────────────


async def _lookup_db(db: object, title: str, target_locale: str) -> str | None:
    """Check if we already have a translation in the DB."""
    repo = getattr(db, "bangumi", None)
    find_all = getattr(repo, "find_all_by_title", None)
    if not callable(find_all):
        return None

    matches = await find_all(title)
    if not matches:
        return None

    best = matches[0]
    if target_locale == "zh":
        cn = best.get("title_cn")
        return str(cn) if cn else None
    if target_locale in ("ja", ""):
        ja = best.get("title")
        return str(ja) if ja else None
    # English — we don't have title_en yet, return None to trigger search
    return None


async def _lookup_bangumi_api(title: str, target_locale: str) -> str | None:
    """Search Bangumi API for the title translation."""
    try:
        from backend.clients.bangumi import BangumiClient

        async with BangumiClient() as client:
            results = await client.search_subject(
                keyword=title, subject_type=2, max_results=1
            )
            if not results:
                return None

            hit = results[0]
            name_ja = hit.get("name")
            name_cn = hit.get("name_cn")

            if target_locale == "zh" and name_cn:
                return str(name_cn)
            if target_locale == "ja" and name_ja:
                return str(name_ja)
            if target_locale == "en":
                # Bangumi doesn't have English titles directly
                # but name_cn is sometimes English for international titles
                if name_cn and all(ord(c) < 128 for c in str(name_cn)):
                    return str(name_cn)
            return None
    except Exception as exc:
        logger.warning("bangumi_api_translation_failed", title=title, error=str(exc))
        return None


# ── Translation Agent (with web search) ─────────────────────────────

_TRANSLATION_INSTRUCTIONS = """\
You are a translation specialist for anime titles and pilgrimage-related content.

Your job: translate anime titles, place names, and user-facing text between
Japanese, Chinese, and English.

IMPORTANT RULES:
1. For anime titles, NEVER hard-translate. Search for the community-accepted
   translation using web search. For example:
   - "君の名は。" → Chinese: "你的名字。" (NOT "你的名字是")
   - "進撃の巨人" → English: "Attack on Titan" (NOT "Advance of Giants")
   - "響け！ユーフォニアム" → Chinese: "吹响！悠风号" (NOT "响吧！上低音号")

2. Use web search to find translations from authoritative sources:
   - 萌娘百科 (zh.moegirl.org.cn) for Chinese translations
   - Wikipedia for English translations
   - Bangumi (bgm.tv) for cross-references

3. For place names, use the standard localized form:
   - "宇治駅" → Chinese: "宇治站", English: "Uji Station"
   - "秋葉原" → Chinese: "秋叶原", English: "Akihabara"

4. Return ONLY the translated text, no explanations.
"""

translation_agent: Agent[TranslationDeps, str] = Agent(
    resolve_model(None),
    deps_type=TranslationDeps,
    output_type=str,
    instructions=_TRANSLATION_INSTRUCTIONS,
    tools=[duckduckgo_search_tool()],
    retries=1,
)


# ── Public API ──────────────────────────────────────────────────────


async def translate_title(
    title: str,
    *,
    target_locale: str,
    db: object | None = None,
) -> TranslationResult:
    """Translate an anime title to the target locale.

    Tries DB → Bangumi API → DuckDuckGo web search → LLM fallback.
    """
    # 1. DB cache
    if db is not None:
        cached = await _lookup_db(db, title, target_locale)
        if cached and cached != title:
            logger.info("translation_db_hit", title=title, translated=cached)
            return TranslationResult(
                original=title, translated=cached, source="db", confidence=1.0
            )

    # 2. Bangumi API
    api_result = await _lookup_bangumi_api(title, target_locale)
    if api_result and api_result != title:
        logger.info("translation_bangumi_hit", title=title, translated=api_result)
        return TranslationResult(
            original=title, translated=api_result, source="bangumi_api", confidence=0.9
        )

    # 3. Web search + LLM (via translation_agent)
    locale_names = {"ja": "Japanese", "zh": "Chinese", "en": "English"}
    target_name = locale_names.get(target_locale, target_locale)

    prompt = f'What is the official {target_name} title for the anime "{title}"? Search for the community-accepted translation.'

    try:
        deps = TranslationDeps(
            db=db,
            target_locale=target_locale,
        )
        result = await translation_agent.run(prompt, deps=deps)
        translated = result.output.strip().strip('"').strip("'")

        if translated and translated != title:
            logger.info(
                "translation_web_search_hit",
                title=title,
                translated=translated,
            )
            return TranslationResult(
                original=title,
                translated=translated,
                source="web_search",
                confidence=0.7,
            )
    except Exception as exc:
        logger.warning("translation_agent_failed", title=title, error=str(exc))

    # 4. Fallback — return original
    return TranslationResult(
        original=title, translated=title, source="llm_fallback", confidence=0.3
    )


async def translate_text(
    text: str,
    *,
    target_locale: str,
) -> str:
    """Translate a general text string to the target locale.

    Used for user-facing messages, clarification questions, etc.
    Does NOT use web search — just LLM direct translation.
    """
    if not text:
        return text

    locale_names = {"ja": "日本語", "zh": "中文", "en": "English"}
    target_name = locale_names.get(target_locale, target_locale)

    try:
        deps = TranslationDeps(db=None, target_locale=target_locale)
        result = await translation_agent.run(
            f"Translate the following text to {target_name}. "
            f"Return ONLY the translation:\n\n{text}",
            deps=deps,
        )
        return result.output.strip()
    except Exception as exc:
        logger.warning("text_translation_failed", error=str(exc))
        return text
