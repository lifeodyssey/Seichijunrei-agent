"""Application settings and configuration management."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level is valid."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
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

    def validate_api_keys(self) -> list[str]:
        """Validate required API keys are present."""
        missing = []
        if not self.google_maps_api_key:
            missing.append("GOOGLE_MAPS_API_KEY")
        if self.is_production and not self.weather_api_key:
            missing.append("WEATHER_API_KEY")
        return missing


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
