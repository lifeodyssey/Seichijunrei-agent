"""Application settings and configuration management."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # API Keys
    google_maps_api_key: str = Field(default="", description="Google Maps API key")
    gemini_api_key: str = Field(default="", description="Gemini API key")
    weather_api_key: str = Field(default="", description="Weather API key")

    # API Endpoints
    anitabi_api_url: str = Field(
        default="https://api.anitabi.cn/bangumi",
        description="Anitabi API base URL"
    )
    weather_api_url: str = Field(
        default="https://api.openweathermap.org/data/2.5",
        description="Weather API base URL"
    )

    # Google Cloud Configuration
    google_application_credentials: Optional[str] = Field(
        default=None,
        description="Path to Google Cloud service account key"
    )
    google_cloud_project: Optional[str] = Field(
        default=None,
        description="Google Cloud project ID"
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
    template_dir: Path = Field(default=Path("templates"), description="Template directory")

    # Rate Limiting
    rate_limit_calls: int = Field(default=100, description="Rate limit calls")
    rate_limit_period_seconds: int = Field(default=60, description="Rate limit period")

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level is valid."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v

    @field_validator("output_dir", "template_dir")
    @classmethod
    def ensure_directory_exists(cls, v: Path) -> Path:
        """Ensure directory exists, create if not."""
        v.mkdir(parents=True, exist_ok=True)
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
        if not self.gemini_api_key:
            missing.append("GEMINI_API_KEY")
        if self.is_production and not self.weather_api_key:
            missing.append("WEATHER_API_KEY")
        return missing


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()