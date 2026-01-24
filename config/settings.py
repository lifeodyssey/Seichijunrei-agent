"""Application settings and configuration management."""

import warnings
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _mask_secret(value: str | None, visible_chars: int = 4) -> str:
    """Mask a secret value, showing only the first few characters."""
    if not value:
        return "(empty)"
    if len(value) <= visible_chars:
        return "***"
    return f"{value[:visible_chars]}...***"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    # API Keys
    google_maps_api_key: str = Field(default="", description="Google Maps API key")
    # Kept for backwards compatibility but no longer required by Python code.
    gemini_api_key: str = Field(
        default="", description="Gemini API key (legacy, optional)"
    )
    weather_api_key: str = Field(default="", description="Weather API key")

    # API Endpoints
    anitabi_api_url: str = Field(
        default="https://api.anitabi.cn/bangumi", description="Anitabi API base URL"
    )
    weather_api_url: str = Field(
        default="https://api.openweathermap.org/data/2.5",
        description="Weather API base URL",
    )

    # Google Cloud Configuration
    google_application_credentials: str | None = Field(
        default=None, description="Path to Google Cloud service account key"
    )
    google_cloud_project: str | None = Field(
        default=None, description="Google Cloud project ID"
    )

    # Application Settings
    app_env: str = Field(default="development", description="Application environment")
    log_level: str = Field(default="INFO", description="Logging level")
    debug: bool = Field(default=False, description="Debug mode")
    max_retries: int = Field(default=3, description="Maximum API retry attempts")
    timeout_seconds: int = Field(default=30, description="API request timeout")

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

    # A2UI (Agent-to-User Interface) Settings
    a2ui_backend: str = Field(
        default="local",
        description='A2UI backend mode: "local" or "agent_engine"',
    )
    a2ui_port: int = Field(default=8081, description="A2UI web server port")
    a2ui_host: str = Field(default="0.0.0.0", description="A2UI web server host")
    a2ui_vertexai_project: str | None = Field(
        default=None, description="Vertex AI project for Agent Engine backend"
    )
    a2ui_vertexai_location: str | None = Field(
        default=None, description="Vertex AI location for Agent Engine backend"
    )
    a2ui_agent_engine_name: str | None = Field(
        default=None, description="Agent Engine resource name"
    )
    a2ui_agent_engine_user_id: str = Field(
        default="a2ui-web", description="User ID for Agent Engine sessions"
    )

    # MCP (Model Context Protocol) - optional
    enable_mcp_tools: bool = Field(
        default=False,
        description="Enable MCP toolsets (stdio/SSE/streamable HTTP) for service tools",
    )
    mcp_transport: str = Field(
        default="stdio",
        description='MCP transport: "stdio", "sse", or "streamable-http"',
    )
    mcp_bangumi_url: str | None = Field(
        default=None,
        description="Bangumi MCP server URL for sse/streamable-http transports",
    )
    mcp_anitabi_url: str | None = Field(
        default=None,
        description="Anitabi MCP server URL for sse/streamable-http transports",
    )

    # State Contract Validation (ADK-001)
    enable_state_contract_validation: bool = Field(
        default=True,
        description=(
            "Enable runtime validation of ADK skill state contracts. "
            "When enabled, preconditions are validated before skill execution "
            "and postconditions are validated after. Set to False in production "
            "for performance if contracts are well-tested."
        ),
    )

    # LLM Planner Settings (PLAN-002)
    enable_llm_planner: bool = Field(
        default=True,
        description=(
            "Enable LLM planner for ambiguous inputs. "
            "When enabled, ambiguous user inputs are routed to an LLM for intent "
            "classification. When disabled, only deterministic fast paths are used."
        ),
    )
    planner_model: str = Field(
        default="gemini-2.0-flash",
        description=(
            "Model to use for the planner agent. "
            "Should be a fast, cost-effective model for intent classification."
        ),
    )
    planner_confidence_threshold: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description=(
            "Minimum confidence score to execute planner decision. "
            "Below this threshold, clarification is requested from the user."
        ),
    )

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level is valid."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v

    @field_validator("a2ui_backend")
    @classmethod
    def validate_a2ui_backend(cls, v: str) -> str:
        v = v.strip().lower()
        valid = {"local", "agent_engine"}
        if v not in valid:
            raise ValueError(
                f"Invalid A2UI_BACKEND: {v}. Must be one of {sorted(valid)}"
            )
        return v

    @field_validator("mcp_transport")
    @classmethod
    def validate_mcp_transport(cls, v: str) -> str:
        v = v.strip().lower()
        if v in {"streamable_http", "streamablehttp"}:
            v = "streamable-http"
        valid = {"stdio", "sse", "streamable-http"}
        if v not in valid:
            raise ValueError(
                f"Invalid MCP_TRANSPORT: {v}. Must be one of {sorted(valid)}"
            )
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
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout_seconds,
            "cache_ttl_seconds": self.cache_ttl_seconds,
            "use_cache": self.use_cache,
            "enable_mcp_tools": self.enable_mcp_tools,
            "enable_state_contract_validation": self.enable_state_contract_validation,
            "enable_llm_planner": self.enable_llm_planner,
            "planner_model": self.planner_model,
            "planner_confidence_threshold": self.planner_confidence_threshold,
            "a2ui_backend": self.a2ui_backend,
            "a2ui_port": self.a2ui_port,
        }

    def get_feature_flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature flag names to their boolean values.
        """
        return {
            "use_cache": self.use_cache,
            "debug": self.debug,
            "enable_mcp_tools": self.enable_mcp_tools,
            "enable_state_contract_validation": self.enable_state_contract_validation,
            "enable_llm_planner": self.enable_llm_planner,
        }

    def get_secrets(self) -> dict[str, str]:
        """Get masked secret information (safe to log for debugging).

        Returns:
            Dictionary of secret names to their masked values.
        """
        return {
            "google_maps_api_key": _mask_secret(self.google_maps_api_key),
            "gemini_api_key": _mask_secret(self.gemini_api_key),
            "weather_api_key": _mask_secret(self.weather_api_key),
            "google_application_credentials": _mask_secret(
                self.google_application_credentials
            ),
        }

    def validate_api_keys(self) -> list[str]:
        """Validate required API keys are present."""
        missing = []
        if not self.google_maps_api_key:
            missing.append("GOOGLE_MAPS_API_KEY")
        if self.is_production and not self.weather_api_key:
            missing.append("WEATHER_API_KEY")
        return missing

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
            f"google_maps_api_key={_mask_secret(self.google_maps_api_key)}, "
            f"gemini_api_key={_mask_secret(self.gemini_api_key)}, "
            f"weather_api_key={_mask_secret(self.weather_api_key)}"
            f")"
        )

    def __str__(self) -> str:
        """Return string representation with masked secrets."""
        return self.__repr__()


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
