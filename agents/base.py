"""Base agent configuration for Pydantic AI agents.

Provides shared configuration and factory functions for creating
model-agnostic agents. The model is selected via config, defaulting
to Gemini but supporting OpenAI/Anthropic/Ollama.

Usage:
    from agents.base import create_agent, get_default_model

    agent = create_agent(
        get_default_model(),
        system_prompt="You are a travel assistant.",
        output_type=MyOutputModel,
    )
    result = await agent.run("Plan a trip to Kamakura")
"""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel
from pydantic_ai import Agent

T = TypeVar("T", bound=BaseModel)

# Fallback when settings don't specify a model
_FALLBACK_MODEL = "gemini-2.5-pro"


def get_default_model() -> str:
    """Get the default agent model from settings, with fallback."""
    from config import get_settings

    return get_settings().default_agent_model or _FALLBACK_MODEL


def create_agent(
    model: Any = None,
    *,
    system_prompt: str = "",
    output_type: type[T] | None = None,
    retries: int = 2,
    **kwargs: Any,
) -> Agent[Any, T] | Agent[Any, str]:
    """Create a Pydantic AI agent with the given configuration.

    Args:
        model: Model identifier or pydantic-ai Model instance. Uses settings default if None.
        system_prompt: System prompt for the agent.
        output_type: Pydantic model for structured output. If None, returns str.
        retries: Number of retries on failure.
        **kwargs: Additional Agent constructor arguments.

    Returns:
        A configured Pydantic AI Agent instance.
    """
    agent_kwargs: dict[str, Any] = {
        "model": model or get_default_model(),
        "retries": retries,
        **kwargs,
    }
    if system_prompt:
        agent_kwargs["system_prompt"] = system_prompt
    if output_type is not None:
        agent_kwargs["output_type"] = output_type

    return Agent(**agent_kwargs)
