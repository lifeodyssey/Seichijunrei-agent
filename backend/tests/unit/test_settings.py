"""Unit tests for application settings and configuration."""

from backend.config.settings import Settings


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
        # gcp_auth_mode depends on environment (adc or service_account)
        assert config["gcp_auth_mode"] in ("adc", "service_account")

    def test_runtime_config_shows_not_set_for_missing_project(self):
        """Test that runtime config shows '(not set)' for missing project."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project=None,
        )
        config = settings.get_runtime_config()
        assert config["google_cloud_project"] == "(not set)"

    def test_runtime_config_includes_service_fields(self):
        """Test that runtime config includes service deployment fields."""
        settings = Settings(
            google_maps_api_key="test_key",
            service_host="127.0.0.1",
            service_port=9000,
            observability_enabled=True,
            observability_exporter_type="console",
        )
        config = settings.get_runtime_config()
        assert config["service_host"] == "127.0.0.1"
        assert config["service_port"] == 9000
        assert config["observability_enabled"] is True
        assert config["observability_exporter_type"] == "console"


class TestAPIKeyValidation:
    """Test API key validation."""

    def test_validate_api_keys_missing_gemini(self):
        """Test that missing Gemini API key is reported when Gemini is active."""
        settings = Settings(
            gemini_api_key="",
            default_agent_model="google-gla:gemini-3.1-pro-preview",
        )
        missing = settings.validate_api_keys()
        assert "GEMINI_API_KEY" in missing

    def test_validate_api_keys_all_present(self):
        """Test that no keys are reported missing when all are set."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="compat_key",
            openai_compat_base_url="https://api.univibe.cc/openai",
        )
        missing = settings.validate_api_keys()
        assert missing == []

    def test_validate_api_keys_missing_openai_compat_when_fallback_enabled(self):
        """Fallback provider requires compat config when using openai fallback."""
        settings = Settings(
            gemini_api_key="test_key",
            fallback_agent_model="openai:gpt-5.4",
            openai_compat_base_url="",
            openai_compat_api_key="",
        )
        missing = settings.validate_api_keys()
        assert "OPENAI_COMPAT_BASE_URL" in missing

    def test_get_runtime_config_includes_provider_fields(self):
        """Runtime config should expose non-secret provider settings."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="compat_key",
            default_agent_model="google-gla:gemini-3.1-pro-preview",
            fallback_agent_model="openai:gpt-5.4",
            openai_compat_base_url="https://api.univibe.cc/openai",
        )
        config = settings.get_runtime_config()
        assert config["default_agent_model"] == "google-gla:gemini-3.1-pro-preview"
        assert config["fallback_agent_model"] == "openai:gpt-5.4"
        assert config["openai_compat_base_url"] == "https://api.univibe.cc/openai"

    def test_get_secrets_masks_openai_compat_key(self):
        """Secret debug info should mask the compat key too."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="sk-test-openai-compat",
        )
        secrets = settings.get_secrets()
        assert secrets["openai_compat_api_key"].endswith("***")
