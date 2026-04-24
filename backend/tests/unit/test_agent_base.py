"""Unit tests for shared agent model parsing and fallback construction."""

from __future__ import annotations

from unittest.mock import patch

from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel

from backend.agents.base import describe_model, parse_model_spec, resolve_model
from backend.config.settings import Settings


def _test_settings() -> Settings:
    return Settings(
        gemini_api_key="test-gemini-key",
        openai_compat_api_key="test-openai-compat-key",
        openai_compat_base_url="https://api.univibe.cc/openai",
        default_agent_model="openai:gemini-3-pro-preview@https://api.zetatechs.com/v1",
        fallback_agent_model="openai:gpt-5.4",
        fallback_agent_model_2=None,
    )


class TestParseModelSpec:
    def test_parse_gemini_model(self) -> None:
        model = parse_model_spec("google-gla:gemini-3.1-pro-preview")
        assert isinstance(model, GoogleModel)
        assert model.model_name == "gemini-3.1-pro-preview"

    def test_parse_openai_compat_model(self) -> None:
        model = parse_model_spec(
            "openai:gpt-5.4@https://api.univibe.cc/openai",
            use_settings_fallbacks=False,
        )
        assert isinstance(model, OpenAIChatModel)
        assert model.model_name == "gpt-5.4"

    def test_resolve_model_uses_default_fallback_chain(self) -> None:
        with patch("backend.config.get_settings", return_value=_test_settings()):
            model = resolve_model(None)
        assert isinstance(model, FallbackModel)
        assert len(model.models) == 2
        assert model.models[0].model_name == "gemini-3-pro-preview"
        assert model.models[1].model_name == "gpt-5.4"

    def test_explicit_model_does_not_add_default_fallback(self) -> None:
        with patch("backend.config.get_settings", return_value=_test_settings()):
            model = resolve_model("google-gla:gemini-3.1-pro-preview")
        assert isinstance(model, GoogleModel)

    def test_describe_model_for_fallback(self) -> None:
        with patch("backend.config.get_settings", return_value=_test_settings()):
            model = resolve_model(None)
        assert describe_model(model) == "fallback(gemini-3-pro-preview, gpt-5.4)"
