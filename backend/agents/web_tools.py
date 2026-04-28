"""Web-facing tool registrations (web_search, translate_anime_title).

Extracted from pilgrimage_tools.py to keep that file under 300 lines.
Import this module after ``pilgrimage_agent`` is created so the decorators
can attach to it.
"""

from __future__ import annotations

from pydantic_ai import RunContext

from backend.agents.pilgrimage_agent import pilgrimage_agent
from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.translation import translate_title


@pilgrimage_agent.tool
async def web_search(
    ctx: RunContext[RuntimeDeps],
    *,
    query: str,
) -> str:
    """Search the web for information using DuckDuckGo.

    Use this when you need to:
    - Find the correct translation of an anime title
    - Look up information about a pilgrimage location
    - Verify facts about an anime or location
    - Find community-accepted translations from 萌娘百科 or Wikipedia

    Args:
        query: The search query. Be specific. Include the language you want results in.
               Examples:
               - "響け！ユーフォニアム Chinese name 中文名"
               - "Your Name anime Japanese title"
               - "宇治駅 anime pilgrimage spots"

    Returns a text summary of the top search results.
    """
    import asyncio
    from functools import partial

    from ddgs import DDGS

    def _search_sync(q: str) -> list[dict[str, str]]:
        with DDGS() as ddgs:
            return list(ddgs.text(q, max_results=5))

    loop = asyncio.get_running_loop()
    try:
        results = await asyncio.wait_for(
            loop.run_in_executor(None, partial(_search_sync, query)),
            timeout=10.0,
        )
    except (TimeoutError, OSError, RuntimeError) as exc:
        return f"Search failed for '{query}': {exc}"
    if not results:
        return f"No results found for: {query}"
    lines = []
    for r in results[:5]:
        title = r.get("title", "")
        body = r.get("body", "")
        href = r.get("href", "")
        lines.append(f"- {title}: {body} ({href})")
    return "\n".join(lines)


@pilgrimage_agent.tool
async def translate_anime_title(
    ctx: RunContext[RuntimeDeps],
    *,
    title: str,
    target_language: str,
) -> dict[str, object]:
    """Translate an anime title to a target language using authoritative sources.

    This tool searches Bangumi, 萌娘百科, and Wikipedia for the community-accepted
    translation. It does NOT hard-translate — it finds the official localized title.

    IMPORTANT: Always use this tool when you need to show an anime title in a
    different language from the original. Do not guess translations.

    Args:
        title: The anime title to translate. Can be in any language.
               Examples: "君の名は。", "Your Name", "你的名字"
        target_language: Target language code: "ja", "zh", or "en"

    Returns: {"original": "...", "translated": "...", "source": "db|bangumi_api|web_search", "confidence": 0.0-1.0}
    """
    result = await translate_title(
        title,
        target_locale=target_language,
        db=ctx.deps.db,
    )
    return {
        "original": result.original,
        "translated": result.translated,
        "source": result.source,
        "confidence": result.confidence,
    }
