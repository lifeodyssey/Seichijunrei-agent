"""Translation tool for bangumi titles using Gemini LLM.

This module defines an async translation function and wraps it in a
FunctionTool so it can be used by ADK LlmAgents. It delegates to the
application layer use case following clean architecture patterns.
"""

from google.adk.tools import FunctionTool

from application.use_cases import TranslateText
from infrastructure.gateways import GeminiTranslationGateway
from utils.logger import get_logger

logger = get_logger(__name__)


async def translate_text(
    text: str,
    target_language: str,
    context: str = "anime title",
) -> dict:
    """Translate text to target language using Gemini.

    Args:
        text: Text to translate (usually Japanese bangumi title).
        target_language: Target language code (zh-CN, en, ja, etc.).
        context: Context hint for better translation (default: "anime title").

    Returns:
        {
            "original": str,
            "translated": str,
            "target_language": str,
            "success": bool,
            "error": str | None,
        }
    """
    try:
        use_case = TranslateText(translator=GeminiTranslationGateway())
        translated = await use_case(
            text=text,
            target_language=target_language,
            context=context,
        )

        logger.info(
            "Translation completed",
            original=text[:100] if text else "",
            translated=translated[:100] if translated else "",
            target_language=target_language,
        )

        return {
            "original": text,
            "translated": translated,
            "target_language": target_language,
            "success": True,
            "error": None,
        }

    except Exception as exc:
        logger.error(
            "Translation failed",
            text=text[:100] if text else "",
            target_language=target_language,
            error=str(exc),
            exc_info=True,
        )
        return {
            "original": text,
            "translated": text,
            "target_language": target_language,
            "success": False,
            "error": str(exc),
        }


# Expose as an ADK FunctionTool for use by LlmAgents.
translate_tool = FunctionTool(translate_text)
