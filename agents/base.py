"""Base agent configuration for Pydantic AI agents.

Provides shared configuration and factory functions for creating
model-agnostic agents. The model is selected via config, defaulting
to Gemini but supporting OpenAI/Anthropic/Ollama.

Usage:
    from agents.base import create_agent

    agent = create_agent(
        "gemini-2.0-flash",
        system_prompt="You are a travel assistant.",
        result_type=MyOutputModel,
    )
    result = await agent.run("Plan a trip to Kamakura")
"""

from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel
from pydantic_ai import Agent

T = TypeVar("T", bound=BaseModel)

# Default model for development (fast + cheap)
DEFAULT_MODEL = "gemini-2.0-flash"


def create_agent(
    model: str = DEFAULT_MODEL,
    *,
    system_prompt: str = "",
    result_type: type[T] | None = None,
    retries: int = 2,
    **kwargs: Any,
) -> Agent[Any, T] | Agent[Any, str]:
    """Create a Pydantic AI agent with the given configuration.

    Args:
        model: Model identifier (e.g. "gemini-2.0-flash", "openai:gpt-4o",
               "anthropic:claude-sonnet-4-20250514").
        system_prompt: System prompt for the agent.
        result_type: Pydantic model for structured output. If None, returns str.
        retries: Number of retries on failure.
        **kwargs: Additional Agent constructor arguments.

    Returns:
        A configured Pydantic AI Agent instance.
    """
    agent_kwargs: dict[str, Any] = {
        "model": model,
        "retries": retries,
        **kwargs,
    }
    if system_prompt:
        agent_kwargs["system_prompt"] = system_prompt
    if result_type is not None:
        agent_kwargs["result_type"] = result_type

    return Agent(**agent_kwargs)
