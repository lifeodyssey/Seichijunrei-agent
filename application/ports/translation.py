"""Ports for translation services."""

from __future__ import annotations

from typing import Protocol


class TranslationGateway(Protocol):
    """Port for text translation services."""

    async def translate(self, *, text: str, target_language: str, context: str) -> str:
        """Translate text to target language.

        Args:
            text: Text to translate.
            target_language: Target language code (e.g., 'en', 'zh-CN').
            context: Context hint for better translation.

        Returns:
            Translated text.

        Raises:
            ExternalServiceError: If translation service fails.
            InvalidInputError: If input validation fails.
        """
        ...
