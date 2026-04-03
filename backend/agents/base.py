"""Base agent configuration for Pydantic AI agents.

Provides shared configuration and factory functions for creating
model-agnostic agents. The model is selected via config, defaulting
to Gemini but supporting OpenAI/Anthropic/Ollama.

Usage:
    from backend.agents.base import create_agent, get_default_model

    agent = create_agent(
        get_default_model(),
        system_prompt="You are a travel assistant.",
        output_type=MyOutputModel,
    )
    result = await agent.run("Plan a trip to Kamakura")
"""

from __future__ import annotations

from typing import TypeVar, overload

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models import Model

T = TypeVar("T", bound=BaseModel)

# Fallback when settings don't specify a model
_FALLBACK_MODEL = "gemini-2.5-pro"


def get_default_model() -> str:
    """Get the default agent model from settings, with fallback."""
    from backend.config import get_settings

    return get_settings().default_agent_model or _FALLBACK_MODEL


@overload
def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: type[T],
    retries: int = 2,
) -> Agent[None, T]: ...


@overload
def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: None = None,
    retries: int = 2,
) -> Agent[None, str]: ...


def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: type[T] | None = None,
    retries: int = 2,
) -> Agent[None, T] | Agent[None, str]:
    """Create a Pydantic AI agent with the given configuration.

    Args:
        model: Model identifier or pydantic-ai Model instance. Uses settings default if None.
        system_prompt: System prompt for the agent.
        output_type: Pydantic model for structured output. If None, returns str.
        retries: Number of retries on failure.
    Returns:
        A configured Pydantic AI Agent instance.
    """
    selected_model: Model | str = get_default_model() if model is None else model
    if output_type is None:
        return Agent(
            selected_model,
            system_prompt=system_prompt,
            retries=retries,
        )
    return Agent(
        selected_model,
        system_prompt=system_prompt,
        output_type=output_type,
        retries=retries,
    )
