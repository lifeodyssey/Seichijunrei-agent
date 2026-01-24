"""Use case: translate text to target language."""

from __future__ import annotations

from dataclasses import dataclass

from ..ports.translation import TranslationGateway


@dataclass(frozen=True, slots=True)
class TranslateText:
    """Translate text using a translation gateway."""

    translator: TranslationGateway

    async def __call__(
        self,
        *,
        text: str,
        target_language: str,
        context: str = "anime title",
    ) -> str:
        """Execute the translation.

        Args:
            text: Text to translate.
            target_language: Target language code.
            context: Context hint for better translation.

        Returns:
            Translated text.
        """
        return await self.translator.translate(
            text=text,
            target_language=target_language,
            context=context,
        )
