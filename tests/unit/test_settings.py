"""Unit tests for application settings and configuration."""

import pytest

from config.settings import Settings


class TestGCPConfiguration:
    """Test GCP configuration validation."""

    def test_validate_gcp_config_missing_project(self):
        """Test that missing GOOGLE_CLOUD_PROJECT is reported."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project=None,
        )
        issues = settings.validate_gcp_config()
        assert "GOOGLE_CLOUD_PROJECT is required" in issues

    def test_validate_gcp_config_with_project(self):
        """Test that valid GCP config passes validation."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project-id",
        )
        issues = settings.validate_gcp_config()
        assert len(issues) == 0

    def test_uses_service_account_when_credentials_set(self):
        """Test service account detection when credentials path is set."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
            google_application_credentials="/path/to/key.json",
        )
        assert settings.uses_service_account is True
        assert settings.uses_adc is False

    def test_uses_adc_when_no_credentials(self):
        """Test ADC detection when no credentials path is set."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
            google_application_credentials=None,
        )
        assert settings.uses_adc is True
        assert settings.uses_service_account is False

    def test_runtime_config_includes_gcp_info(self):
        """Test that runtime config includes GCP configuration."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
        )
        config = settings.get_runtime_config()
        assert "google_cloud_project" in config
        assert config["google_cloud_project"] == "my-project"
        assert "gcp_auth_mode" in config
        assert config["gcp_auth_mode"] == "adc"

    def test_runtime_config_shows_not_set_for_missing_project(self):
        """Test that runtime config shows '(not set)' for missing project."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project=None,
        )
        config = settings.get_runtime_config()
        assert config["google_cloud_project"] == "(not set)"


class TestAPIKeyValidation:
    """Test API key validation."""

    def test_validate_api_keys_missing_google_maps(self):
        """Test that missing Google Maps API key is reported."""
        settings = Settings(
            google_maps_api_key="",
        )
        missing = settings.validate_api_keys()
        assert "GOOGLE_MAPS_API_KEY" in missing

    def test_validate_api_keys_production_requires_weather(self):
        """Test that production requires weather API key."""
        settings = Settings(
            google_maps_api_key="test_key",
            weather_api_key="",
            app_env="production",
        )
        missing = settings.validate_api_keys()
        assert "WEATHER_API_KEY" in missing

    def test_validate_api_keys_development_no_weather_required(self):
        """Test that development does not require weather API key."""
        settings = Settings(
            google_maps_api_key="test_key",
            weather_api_key="",
            app_env="development",
        )
        missing = settings.validate_api_keys()
        assert "WEATHER_API_KEY" not in missing
