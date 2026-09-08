"""Base agent configuration and trusted model resolution."""

from __future__ import annotations

import re
from uuid import uuid4

import httpx
from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.deepseek import DeepSeekProvider
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from animichi.config.model_aliases import (
    MODEL_ALIASES,
    ModelAlias,
    ModelAliasError,
    ProviderKind,
    credential_value,
    model_alias_from_spec,
    routes_by_opencode_session,
)
from animichi.config.settings import Settings, _is_local_base_url

_DEFAULT_MODEL_SPEC = "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"
_MODEL_ALIAS_PATTERN = re.compile(r"[a-z0-9_-]+")
_APP_CLIENT_HEADER = "X-App-Client"
_OPENCODE_SESSION_HEADER = "x-opencode-session"
_LOCAL_DEV_API_KEY = "local-dev-placeholder"

# The floor the zen/go gateway requires: one unchanging id for the lifetime of
# this agent process, carried by every request. A turn that knows its
# conversation overrides it per request via `conversation_routing_settings`,
# which is what actually keeps one conversation on one upstream cache.
_OPENCODE_SESSION_ID = str(uuid4())


def build_model_http_client(settings: Settings | None = None) -> httpx.AsyncClient:
    """Build a model transport for process or FastAPI-lifespan ownership."""
    if settings is None:
        from animichi.config import get_settings

        settings = get_settings()
    return httpx.AsyncClient(
        trust_env=True,
        timeout=settings.model_attempt_timeout,
    )


def _resolve_http_client(client: httpx.AsyncClient | None) -> httpx.AsyncClient:
    return client if client is not None else build_model_http_client()


def _model_settings(alias: ModelAlias) -> ModelSettings | None:
    if not alias.disable_thinking:
        return None
    return ModelSettings(extra_body={"thinking": {"type": "disabled"}})


def _app_client_name() -> str:
    from animichi.config import get_settings

    app_env = get_settings().app_env.lower()
    environment = {"production": "Prod", "staging": "Staging"}.get(app_env, "Dev")
    return f"animichi {environment}"


def _model_api_key(alias: ModelAlias) -> str | None:
    api_key = credential_value(alias.credential_ref)
    if api_key is None and _is_local_base_url(alias.fixed_base_url):
        return _LOCAL_DEV_API_KEY
    return api_key


def _default_headers(alias: ModelAlias) -> dict[str, str]:
    headers = {_APP_CLIENT_HEADER: _app_client_name()}
    if routes_by_opencode_session(alias.fixed_base_url):
        headers[_OPENCODE_SESSION_HEADER] = _OPENCODE_SESSION_ID
    return headers


def _sdk_client(
    alias: ModelAlias, client: httpx.AsyncClient, *, max_retries: int
) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=alias.fixed_base_url,
        api_key=_model_api_key(alias),
        http_client=client,
        max_retries=max_retries,
        default_headers=_default_headers(alias),
    )


def _provider(
    alias: ModelAlias,
    client: httpx.AsyncClient,
    *,
    max_retries: int,
) -> DeepSeekProvider | OpenAIProvider:
    sdk_client = _sdk_client(alias, client, max_retries=max_retries)
    if alias.provider_kind is ProviderKind.DEEPSEEK:
        return DeepSeekProvider(openai_client=sdk_client)
    return OpenAIProvider(openai_client=sdk_client)


def _chain_members(model: Model) -> tuple[Model, ...]:
    return tuple(model.models) if isinstance(model, FallbackModel) else (model,)


def conversation_routing_settings(
    model: Model | None, conversation_id: str | None
) -> ModelSettings | None:
    """Pin one conversation to one zen/go upstream for the whole conversation.

    Applied only when every model the run could reach is a zen/go host, so a
    fallback to another provider never carries our session id off-gateway. A
    run without a conversation id keeps the per-process `default_headers` id,
    which is all the gateway itself requires.
    """
    if model is None or not conversation_id:
        return None
    if not all(
        routes_by_opencode_session(member.base_url or "")
        for member in _chain_members(model)
    ):
        return None
    return ModelSettings(extra_headers={_OPENCODE_SESSION_HEADER: conversation_id})


def _parse_model_alias(
    alias: ModelAlias,
    *,
    http_client: httpx.AsyncClient | None = None,
    disable_sdk_retries: bool = False,
) -> Model:
    client = _resolve_http_client(http_client)
    provider = _provider(
        alias,
        client,
        max_retries=0 if disable_sdk_retries else 2,
    )
    return OpenAIChatModel(
        alias.name,
        provider=provider,
        settings=_model_settings(alias),
    )


def _parse_model(
    spec: str,
    *,
    http_client: httpx.AsyncClient | None = None,
    disable_sdk_retries: bool = False,
) -> Model:
    """Parse a trusted internal model spec into a concrete model."""
    return _parse_model_alias(
        model_alias_from_spec(spec),
        http_client=http_client,
        disable_sdk_retries=disable_sdk_retries,
    )


def _model_chain(
    primary_spec: str,
    fallback_spec: str | None,
    http_client: httpx.AsyncClient | None,
) -> Model:
    primary = model_alias_from_spec(primary_spec)
    if not fallback_spec:
        return _fail_fast_model(primary_spec, http_client)
    fallback = model_alias_from_spec(fallback_spec)
    if primary.effective_model == fallback.effective_model:
        return _fail_fast_model(primary_spec, http_client)
    return FallbackModel(
        _fail_fast_model(primary_spec, http_client),
        _fail_fast_model(fallback_spec, http_client),
    )


def _fail_fast_model(spec: str, client: httpx.AsyncClient | None) -> Model:
    return _parse_model(spec, http_client=client, disable_sdk_retries=True)


def parse_model_spec(
    model: Model | str,
    *,
    use_settings_fallbacks: bool = False,
    http_client: httpx.AsyncClient | None = None,
) -> Model:
    """Resolve a trusted eval/test model spec; never use for caller input."""
    if not isinstance(model, str):
        return model
    if not use_settings_fallbacks:
        return _parse_model(model, http_client=http_client)
    from animichi.config import get_settings

    return _model_chain(
        model,
        get_settings().fallback_agent_model,
        http_client,
    )


def get_default_model(*, http_client: httpx.AsyncClient | None = None) -> Model:
    """Build the default model and its distinct optional fallback."""
    from animichi.config import get_settings

    settings = get_settings()
    primary_spec = settings.default_agent_model or _DEFAULT_MODEL_SPEC
    return _model_chain(
        primary_spec,
        settings.fallback_agent_model,
        http_client,
    )


def resolve_model_alias(
    model: Model | str | None,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> Model | None:
    """Resolve a caller string only through the server-owned alias allowlist."""
    if model is None or not isinstance(model, str):
        return model
    if _MODEL_ALIAS_PATTERN.fullmatch(model) is None:
        raise ModelAliasError(model)
    alias = MODEL_ALIASES.get(model)
    if alias is None:
        raise ModelAliasError(model)
    if model == "default":
        return get_default_model(http_client=http_client)
    return _parse_model_alias(
        alias,
        http_client=http_client,
        disable_sdk_retries=True,
    )


def resolve_model(
    model: Model | str | None,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> Model:
    """Resolve a trusted internal raw spec or the configured default."""
    if model is None:
        return get_default_model(http_client=http_client)
    if isinstance(model, str):
        return _parse_model(model, http_client=http_client)
    return model


def describe_model(model: object) -> str:
    """Human-readable model description for logs."""
    if isinstance(model, FallbackModel):
        return f"fallback({', '.join(m.model_name for m in model.models)})"
    label = getattr(model, "model_name", None)
    return label if isinstance(label, str) and label else type(model).__name__
