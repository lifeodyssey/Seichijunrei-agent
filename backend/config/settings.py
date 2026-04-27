"""Application settings and configuration management."""

import warnings
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _mask_secret(value: str | None, visible_chars: int = 4) -> str:
    """Mask a secret value, showing only the first few characters."""
    if not value:
        return "(empty)"
    if len(value) <= visible_chars:
        return "***"
    return f"{value[:visible_chars]}...***"


def _is_gemini_model(model_name: str | None) -> bool:
    """Return True when a model spec uses Google Gemini directly (not via proxy)."""
    if not isinstance(model_name, str):
        return False
    lower = model_name.lower()
    # OpenAI-compat models routed through a proxy (e.g., Zeta) don't need GEMINI_API_KEY
    if lower.startswith("openai:"):
        return False
    return "gemini" in lower


def _is_openai_compat_model(model_name: str | None) -> bool:
    """Return True when a model spec uses the repo's OpenAI-compatible path."""
    return isinstance(model_name, str) and model_name.lower().startswith("openai:")


def _is_local_base_url(base_url: str | None) -> bool:
    """Return True when a compat base URL targets a local/dev endpoint."""
    if not base_url:
        return False
    parsed = urlparse(base_url)
    return parsed.hostname in {"localhost", "127.0.0.1"}


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    # API Keys
    gemini_api_key: str = Field(default="", description="Gemini API key for LLM agents")
    openai_compat_api_key: str = Field(
        default="",
        description="API key for the OpenAI-compatible fallback provider",
    )

    # API Endpoints
    anitabi_api_url: str = Field(
        default="https://api.anitabi.cn/bangumi", description="Anitabi API base URL"
    )

    # Optional Google Cloud configuration used by Google-backed integrations.
    google_cloud_project: str | None = Field(
        default=None,
        description="Google Cloud project ID",
    )
    google_application_credentials: str | None = Field(
        default=None,
        description="Path to service account key",
    )

    # Application Settings
    app_env: str = Field(default="development", description="Application environment")
    log_level: str = Field(default="INFO", description="Logging level")
    debug: bool = Field(default=False, description="Debug mode")
    max_retries: int = Field(default=3, description="Maximum API retry attempts")
    timeout_seconds: int = Field(
        default=120, description="API request timeout (reasoning models need longer)"
    )
    service_host: str = Field(default="0.0.0.0", description="HTTP service bind host")
    service_port: int = Field(default=8080, description="HTTP service bind port")
    observability_enabled: bool = Field(
        default=False,
        description="Enable OpenTelemetry tracing and metrics",
    )
    observability_service_name: str = Field(
        default="seichijunrei-runtime",
        description="Service name reported to observability backends",
    )
    observability_service_version: str = Field(
        default="0.1.0",
        description="Service version reported to observability backends",
    )
    observability_exporter_type: Literal["none", "console", "otlp"] = Field(
        default="none",
        description="OpenTelemetry exporter type",
    )
    observability_otlp_endpoint: str | None = Field(
        default=None,
        description="Optional OTLP endpoint for tracing and metrics export",
    )

    # Cache Settings
    cache_ttl_seconds: int = Field(default=3600, description="Cache TTL in seconds")
    use_cache: bool = Field(default=True, description="Enable caching")

    # Output Paths
    output_dir: Path = Field(default=Path("outputs"), description="Output directory")
    template_dir: Path = Field(
        default=Path("templates"), description="Template directory"
    )

    # Rate Limiting
    rate_limit_calls: int = Field(default=100, description="Rate limit calls")
    rate_limit_period_seconds: int = Field(default=60, description="Rate limit period")

    # Supabase
    supabase_url: str = Field(default="", description="Supabase project URL")
    supabase_anon_key: str = Field(default="", description="Supabase anon key")
    supabase_service_role_key: str = Field(
        default="", description="Supabase service role key"
    )
    supabase_db_url: str = Field(
        default="", description="Direct Postgres DSN for asyncpg"
    )

    # Session storage (in-memory only)

    # Agent model
    default_agent_model: str = Field(
        default="openai:deepseek-v4-pro@https://api.deepseek.com",
        description="Default primary LLM model (DeepSeek V4 Pro)",
    )
    fallback_agent_model: str | None = Field(
        default="openai:gpt-5.4",
        description="Fallback LLM model when the default provider fails",
    )
    fallback_agent_model_2: str | None = Field(
        default=None,
        description="Second fallback LLM model (disabled by default)",
    )
    openai_compat_base_url: str = Field(
        default="https://api.univibe.cc/openai",
        description="Base URL for the OpenAI-compatible provider",
    )

    # Migrations
    auto_migrate: bool = Field(
        default=True,
        description="Run pending DB migrations on startup (set false in production)",
    )

    # CORS
    cors_allowed_origin: str = Field(
        default="*",
        description="Allowed CORS origin. Set to actual domain in production.",
    )

    @field_validator("cors_allowed_origin")
    @classmethod
    def validate_cors_origin(cls, v: str, info: object) -> str:
        """Reject wildcard CORS in production."""
        # info.data is available during model validation with all prior fields
        data = getattr(info, "data", {})
        app_env = (
            data.get("app_env", "development")
            if isinstance(data, dict)
            else "development"
        )
        if v == "*" and str(app_env).lower() == "production":
            raise ValueError(
                "cors_allowed_origin must not be '*' in production. "
                "Set CORS_ALLOWED_ORIGIN to your actual domain."
            )
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level is valid."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.app_env.lower() == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.app_env.lower() == "development"

    def get_runtime_config(self) -> dict[str, str | int | bool]:
        """Get non-secret runtime configuration (safe to log).

        Returns:
            Dictionary of runtime config values that can be safely logged.
        """
        return {
            "app_env": self.app_env,
            "log_level": self.log_level,
            "debug": self.debug,
            "service_host": self.service_host,
            "service_port": self.service_port,
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout_seconds,
            "cache_ttl_seconds": self.cache_ttl_seconds,
            "use_cache": self.use_cache,
            "observability_enabled": self.observability_enabled,
            "observability_exporter_type": self.observability_exporter_type,
            "google_cloud_project": self.google_cloud_project or "(not set)",
            "gcp_auth_mode": "service_account" if self.uses_service_account else "adc",
            "default_agent_model": self.default_agent_model,
            "fallback_agent_model": self.fallback_agent_model or "(not set)",
            "openai_compat_base_url": self.openai_compat_base_url,
        }

    def get_feature_flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature flag names to their boolean values.
        """
        return {
            "use_cache": self.use_cache,
            "debug": self.debug,
        }

    def get_secrets(self) -> dict[str, str]:
        """Get masked secret information (safe to log for debugging).

        Returns:
            Dictionary of secret names to their masked values.
        """
        return {
            "gemini_api_key": _mask_secret(self.gemini_api_key),
            "openai_compat_api_key": _mask_secret(self.openai_compat_api_key),
            "google_application_credentials": _mask_secret(
                self.google_application_credentials
            ),
        }

    def validate_api_keys(self) -> list[str]:
        """Validate required API keys are present."""
        missing: list[str] = []
        all_models = [
            self.default_agent_model,
            self.fallback_agent_model,
            self.fallback_agent_model_2,
        ]
        uses_gemini = any(_is_gemini_model(m) for m in all_models)
        if uses_gemini and not self.gemini_api_key:
            missing.append("GEMINI_API_KEY")

        uses_openai_compat = any(_is_openai_compat_model(m) for m in all_models)
        if uses_openai_compat:
            if not self.openai_compat_base_url:
                missing.append("OPENAI_COMPAT_BASE_URL")
            elif (
                not _is_local_base_url(self.openai_compat_base_url)
                and not self.openai_compat_api_key
            ):
                missing.append("OPENAI_COMPAT_API_KEY")
        return missing

    def validate_gcp_config(self) -> list[str]:
        """Validate GCP configuration.

        Returns:
            List of missing/invalid configuration items.

        This check only validates whether project-level Google integrations have
        enough configuration to run.
        """
        issues = []
        if not self.google_cloud_project:
            issues.append("GOOGLE_CLOUD_PROJECT is required")
        return issues

    @property
    def uses_service_account(self) -> bool:
        """Check if using service account authentication (production mode)."""
        return bool(self.google_application_credentials)

    @property
    def uses_adc(self) -> bool:
        """Check if using Application Default Credentials (local dev mode)."""
        return not self.google_application_credentials

    @model_validator(mode="after")
    def _warn_missing_api_keys(self) -> "Settings":
        """Warn about missing API keys at startup (non-blocking)."""
        missing = self.validate_api_keys()
        if missing:
            warnings.warn(
                f"Missing API keys: {', '.join(missing)}. Some features may not work.",
                UserWarning,
                stacklevel=2,
            )
        return self

    def __repr__(self) -> str:
        """Return string representation with masked secrets."""
        return (
            f"Settings("
            f"app_env={self.app_env!r}, "
            f"debug={self.debug}, "
            f"log_level={self.log_level!r}, "
            f"gemini_api_key={_mask_secret(self.gemini_api_key)}, "
            f"openai_compat_api_key={_mask_secret(self.openai_compat_api_key)}"
            f")"
        )

    def __str__(self) -> str:
        """Return string representation with masked secrets."""
        return self.__repr__()


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
