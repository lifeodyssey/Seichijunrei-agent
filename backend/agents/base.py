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

import os
import threading
from typing import TypeVar, overload

import httpx
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

T = TypeVar("T", bound=BaseModel)

# Fallback when settings don't specify a model
_FALLBACK_MODEL = "google-gla:gemini-3.1-pro-preview"


def _build_http_client() -> httpx.AsyncClient:
    """Build an HTTP client that ignores shell proxy env vars.

    Uses trust_env=False to scope proxy bypass to provider clients only,
    without mutating process-wide os.environ.
    """
    return httpx.AsyncClient(trust_env=False, timeout=30.0)


_GOOGLE_MODEL_LOCK = threading.Lock()

_PROXY_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


def _normalize_gemini_model(model_name: str) -> GoogleModel:
    """Build a GoogleModel from a repo config string.

    Note: Google genai SDK creates an internal sync httpx client that reads
    process proxy env vars. We temporarily save and clear them during
    construction, then restore after. Thread-safe via lock.
    """
    from backend.config import get_settings

    with _GOOGLE_MODEL_LOCK:
        saved = {k: os.environ.pop(k) for k in _PROXY_VARS if k in os.environ}
        try:
            normalized = model_name.removeprefix("google-gla:")
            provider = GoogleProvider(
                api_key=get_settings().gemini_api_key or None,
                http_client=_build_http_client(),
            )
            model = GoogleModel(normalized, provider=provider)
        finally:
            os.environ.update(saved)
    return model


def _resolve_api_key_for_base_url(base_url: str) -> str | None:
    """Resolve the best API key for a given base URL.

    Checks MIMO_API_KEY for mimo endpoints, then falls back to
    OPENAI_COMPAT_API_KEY from settings.
    """
    mimo_url = os.environ.get("MIMO_BASE_URL", "")
    if mimo_url and base_url.rstrip("/").startswith(mimo_url.rstrip("/")):
        key = os.environ.get("MIMO_API_KEY")
        if key:
            return key
    # Also match by domain for inline @url specs
    if "xiaomimimo.com" in base_url:
        key = os.environ.get("MIMO_API_KEY")
        if key:
            return key
    if "deepseek.com" in base_url:
        key = os.environ.get("DEEPSEEK_API_KEY")
        if key:
            return key
    if "zetatechs.com" in base_url:
        key = os.environ.get("ZETA_API_KEY")
        if key:
            return key
    return None


def _parse_openai_compat_model(
    spec: str, *, base_url_override: str | None = None, api_key: str | None = None
) -> OpenAIChatModel:
    """Build an OpenAI-compatible model from a spec string."""
    base_url: str | None
    has_inline_url = "@" in spec
    if has_inline_url:
        name, inline_base_url = spec.split("@", 1)
        base_url = inline_base_url
    else:
        name = spec
        base_url = base_url_override
    model_name = name.removeprefix("openai:")
    if not base_url:
        raise ValueError("OpenAI-compatible model requires a base URL")
    # When the spec has an inline @url, prefer URL-specific key over the
    # generic settings key — different providers need different keys.
    url_specific_key = _resolve_api_key_for_base_url(base_url)
    resolved_key = (
        url_specific_key
        if (has_inline_url and url_specific_key)
        else (api_key or url_specific_key)
    )
    provider = OpenAIProvider(
        base_url=base_url,
        api_key=resolved_key or None,
        http_client=_build_http_client(),
    )
    return OpenAIChatModel(model_name, provider=provider)


def parse_model_spec(
    model: Model | str, *, use_settings_fallbacks: bool = False
) -> Model:
    """Resolve a configured model string or instance into a concrete Model."""
    from backend.config import get_settings

    if not isinstance(model, str):
        return model

    settings = get_settings()
    primary: Model
    if model.startswith("google-gla:") or model.startswith("gemini"):
        primary = _normalize_gemini_model(model)
    elif model.startswith("openai:"):
        primary = _parse_openai_compat_model(
            model,
            base_url_override=settings.openai_compat_base_url,
            api_key=settings.openai_compat_api_key,
        )
    else:
        raise ValueError(f"Unsupported model spec: {model}")

    if not use_settings_fallbacks:
        return primary

    fallback_specs: list[str] = []
    fb1 = settings.fallback_agent_model
    if fb1 and fb1 != model:
        fallback_specs.append(fb1)
    fb2 = getattr(settings, "fallback_agent_model_2", None)
    if isinstance(fb2, str) and fb2 and fb2 != model:
        fallback_specs.append(fb2)

    if not fallback_specs:
        return primary

    fallback_models = [
        parse_model_spec(spec, use_settings_fallbacks=False) for spec in fallback_specs
    ]
    return FallbackModel(primary, *fallback_models)


def get_default_model() -> Model:
    """Get the default agent model chain from settings, with fallback."""
    from backend.config import get_settings

    settings = get_settings()
    model_spec = settings.default_agent_model or _FALLBACK_MODEL
    return parse_model_spec(model_spec, use_settings_fallbacks=True)


def resolve_model(model: Model | str | None) -> Model:
    """Resolve an explicit or default model to a concrete runtime Model."""
    if model is None:
        return get_default_model()
    return parse_model_spec(model, use_settings_fallbacks=False)


def describe_model(model: object) -> str:
    """Return a human-readable model description for logs and telemetry."""
    if isinstance(model, FallbackModel):
        return f"fallback({', '.join(item.model_name for item in model.models)})"
    label = getattr(model, "model_name", None)
    if isinstance(label, str) and label:
        return label
    return type(model).__name__


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
    selected_model: Model = resolve_model(model)
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
