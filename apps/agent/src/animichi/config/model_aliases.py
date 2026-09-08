"""Server-owned model aliases accepted at the public request boundary."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from urllib.parse import urlparse

_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
_MIMO_MODEL_NAME = "mimo-v2.5"
_ZEN_GATEWAY_DOMAIN = "opencode.ai"


class ProviderKind(StrEnum):
    """Transport implementation used for a concrete model."""

    DEEPSEEK = "deepseek"
    OPENAI = "openai"


class CredentialRef(StrEnum):
    """Settings field corresponding to an unchanged deployment env name."""

    DEEPSEEK_API_KEY = "deepseek_api_key"
    MIMO_API_KEY = "mimo_api_key"
    OPENAI_COMPAT_API_KEY = "openai_compat_api_key"
    ZEN_GO_API_KEY = "zen_go_api_key"


@dataclass(frozen=True)
class ModelAlias:
    """Fixed model transport, credential, and behavior profile."""

    name: str
    provider_kind: ProviderKind
    fixed_base_url: str
    credential_ref: CredentialRef
    disable_thinking: bool

    @property
    def effective_model(self) -> tuple[ProviderKind, str, str]:
        """Return the identity used by duplicate-registry validation."""
        provider_kind = self.provider_kind
        if _host_matches(self.fixed_base_url, "deepseek.com"):
            provider_kind = ProviderKind.DEEPSEEK
        return provider_kind, self.name, self.fixed_base_url.rstrip("/")


class ModelAliasError(ValueError):
    """Raised when a caller requests an invalid model alias."""

    def __init__(self, alias: str) -> None:
        self.alias = alias
        super().__init__("Invalid model alias.")


class ModelAliasRegistryError(RuntimeError):
    """Raised when the server-owned alias registry is internally invalid."""

    def __init__(self, first: str, second: str) -> None:
        super().__init__(f"duplicate effective model: {first}, {second}")


def _host_matches(base_url: str, domain: str) -> bool:
    host = urlparse(base_url).hostname or ""
    return host == domain or host.endswith(f".{domain}")


_CREDENTIAL_DOMAINS = (
    ("xiaomimimo.com", CredentialRef.MIMO_API_KEY),
    ("deepseek.com", CredentialRef.DEEPSEEK_API_KEY),
    (_ZEN_GATEWAY_DOMAIN, CredentialRef.ZEN_GO_API_KEY),
)


def credential_ref_for_base_url(base_url: str) -> CredentialRef:
    """Resolve one domain-to-settings credential policy."""
    for domain, credential_ref in _CREDENTIAL_DOMAINS:
        if _host_matches(base_url, domain):
            return credential_ref
    return CredentialRef.OPENAI_COMPAT_API_KEY


def routes_by_opencode_session(base_url: str) -> bool:
    """Whether the host routes a conversation by its ``x-opencode-session`` id.

    The opencode zen/go gateway rejects a request without that header
    (400 ``MissingSessionID``); no other provider accepts it.
    """
    return _host_matches(base_url, _ZEN_GATEWAY_DOMAIN)


def credential_value(credential_ref: CredentialRef) -> str | None:
    """Read a provider credential exclusively through application settings."""
    from animichi.config import get_settings

    settings = get_settings()
    if credential_ref is CredentialRef.DEEPSEEK_API_KEY:
        return settings.deepseek_api_key or None
    if credential_ref is CredentialRef.MIMO_API_KEY:
        return settings.mimo_api_key or None
    if credential_ref is CredentialRef.ZEN_GO_API_KEY:
        return settings.zen_go_api_key or None
    return settings.openai_compat_api_key or None


def _disable_thinking(model_name: str) -> bool:
    """Disable hidden reasoning for latency-sensitive tool-calling models."""
    normalized = model_name.lower()
    return "deepseek" in normalized or "mimo" in normalized


def _openai_base_url(raw: str) -> tuple[str, str]:
    from animichi.config import get_settings

    name, separator, base_url = raw.partition("@")
    resolved_url = base_url if separator else get_settings().openai_compat_base_url
    return name, resolved_url


def model_alias_from_spec(spec: str) -> ModelAlias:
    """Convert a trusted raw spec into one concrete server-owned profile."""
    if spec.startswith("deepseek:"):
        name = spec.removeprefix("deepseek:")
        return _deepseek_profile(name)
    if spec.startswith("openai:"):
        name, base_url = _openai_base_url(spec.removeprefix("openai:"))
        return _openai_profile(name, base_url)
    raise ValueError(f"Unsupported model spec: {spec}")


def _deepseek_profile(name: str) -> ModelAlias:
    return ModelAlias(
        name,
        ProviderKind.DEEPSEEK,
        _DEEPSEEK_BASE_URL,
        CredentialRef.DEEPSEEK_API_KEY,
        _disable_thinking(name),
    )


def _openai_profile(name: str, base_url: str) -> ModelAlias:
    return ModelAlias(
        name,
        ProviderKind.OPENAI,
        base_url,
        credential_ref_for_base_url(base_url),
        _disable_thinking(name),
    )


def _default_alias() -> ModelAlias:
    from animichi.config import get_settings

    return model_alias_from_spec(get_settings().default_agent_model)


def _deepseek_alias() -> ModelAlias:
    return _deepseek_profile("deepseek-v4-flash")


def _configured_mimo_name(default: str, fallback: str | None) -> str:
    for spec in (default, fallback):
        if spec and spec.startswith("openai:") and "mimo" in spec.lower():
            return spec.removeprefix("openai:").partition("@")[0]
    return _MIMO_MODEL_NAME


def _mimo_alias() -> ModelAlias:
    from animichi.config import get_settings

    settings = get_settings()
    name = _configured_mimo_name(
        settings.default_agent_model, settings.fallback_agent_model
    )
    return ModelAlias(
        name,
        ProviderKind.OPENAI,
        settings.openai_compat_base_url,
        CredentialRef.MIMO_API_KEY,
        _disable_thinking(name),
    )


_BUILDERS: dict[str, Callable[[], ModelAlias]] = {
    "default": _default_alias,
    "deepseek": _deepseek_alias,
    "mimo": _mimo_alias,
}


def validate_model_alias_registry(aliases: Mapping[str, ModelAlias]) -> None:
    """Reject two aliases that resolve to the same effective model."""
    seen: dict[tuple[ProviderKind, str, str], str] = {}
    for alias_name, alias in aliases.items():
        prior = seen.setdefault(alias.effective_model, alias_name)
        if prior != alias_name:
            raise ModelAliasRegistryError(prior, alias_name)


def _build_aliases() -> dict[str, ModelAlias]:
    aliases = {name: build() for name, build in _BUILDERS.items()}
    concrete = {name: alias for name, alias in aliases.items() if name != "default"}
    validate_model_alias_registry(concrete)
    return aliases


MODEL_ALIASES: Mapping[str, ModelAlias] = MappingProxyType(_build_aliases())
