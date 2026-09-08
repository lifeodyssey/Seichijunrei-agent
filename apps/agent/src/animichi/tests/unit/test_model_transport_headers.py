"""Unit tests for the headers the model transport attaches per provider.

The opencode zen/go gateway (``https://opencode.ai/zen/go/v1``) answers every
chat request with 400 ``MissingSessionID`` unless it carries a stable
``x-opencode-session`` id (#1477). No other provider is offered that header.

Two layers: the client's ``default_headers`` carry one id per agent process,
and a run that knows its conversation overrides that per request so the gateway
keeps one conversation on one upstream.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch
from uuid import UUID

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel

from animichi.agents.base import (
    _APP_CLIENT_HEADER,
    _sdk_client,
    conversation_routing_settings,
    parse_model_spec,
)
from animichi.config.model_aliases import model_alias_from_spec
from animichi.config.settings import Settings

_SESSION_HEADER = "x-opencode-session"
_ZEN_GO_SPEC = "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"
_MIMO_DIRECT_SPEC = "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
_DEEPSEEK_SPEC = "deepseek:deepseek-v4-flash"
_UNPROFILED_SPEC = "openai:other@https://compat.example/v1"
_ZEN_GO_ALTERNATE_SPEC = "openai:kimi-k3@https://opencode.ai/zen/go/v1"
_CHAT_COMPLETION_STUB = {
    "id": "chatcmpl-test",
    "object": "chat.completion",
    "created": 0,
    "model": "mimo-v2.5",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "ok"},
            "finish_reason": "stop",
        }
    ],
}


def _provider_settings() -> Settings:
    return Settings(
        app_env="test",
        cors_allowed_origin="http://localhost:3000",
        deepseek_api_key="test-deepseek-key",
        mimo_api_key="test-mimo-key",
        zen_go_api_key="test-zen-go-key",
        openai_compat_api_key="test-compat-key",
        openai_compat_base_url="https://api.xiaomimimo.com/v1",
    )


@pytest.fixture(autouse=True)
def provider_credentials() -> Iterator[None]:
    """Give every provider in this module a credential the SDK accepts."""
    with patch("animichi.config.get_settings", return_value=_provider_settings()):
        yield


@pytest.fixture
def model_transport() -> httpx.AsyncClient:
    return httpx.AsyncClient()


def make_sdk_client(spec: str, transport: httpx.AsyncClient) -> AsyncOpenAI:
    return _sdk_client(model_alias_from_spec(spec), transport, max_retries=0)


def test_zen_go_gateway_receives_a_uuid_session_header(
    model_transport: httpx.AsyncClient,
) -> None:
    client = make_sdk_client(_ZEN_GO_SPEC, model_transport)

    assert UUID(client.default_headers[_SESSION_HEADER]).version == 4


def test_session_header_is_unchanging_within_the_process(
    model_transport: httpx.AsyncClient,
) -> None:
    first = make_sdk_client(_ZEN_GO_SPEC, model_transport)
    second = make_sdk_client(_ZEN_GO_SPEC, model_transport)

    assert (
        first.default_headers[_SESSION_HEADER]
        == (second.default_headers[_SESSION_HEADER])
    )


@pytest.mark.parametrize("spec", [_MIMO_DIRECT_SPEC, _DEEPSEEK_SPEC, _UNPROFILED_SPEC])
def test_other_providers_never_receive_the_session_header(
    spec: str, model_transport: httpx.AsyncClient
) -> None:
    client = make_sdk_client(spec, model_transport)

    assert _SESSION_HEADER not in client.default_headers


@pytest.mark.parametrize("spec", [_ZEN_GO_SPEC, _MIMO_DIRECT_SPEC, _DEEPSEEK_SPEC])
def test_every_provider_keeps_the_app_client_header(
    spec: str, model_transport: httpx.AsyncClient
) -> None:
    client = make_sdk_client(spec, model_transport)

    assert client.default_headers[_APP_CLIENT_HEADER] == "animichi Dev"


def make_fallback_model(*specs: str) -> Model:
    return FallbackModel(*[parse_model_spec(spec) for spec in specs])


def test_a_run_with_a_conversation_id_pins_it_on_the_zen_go_header() -> None:
    settings = conversation_routing_settings(parse_model_spec(_ZEN_GO_SPEC), "conv-1")

    assert settings is not None
    assert settings["extra_headers"] == {_SESSION_HEADER: "conv-1"}


def test_a_run_without_a_conversation_id_keeps_the_process_id() -> None:
    assert conversation_routing_settings(parse_model_spec(_ZEN_GO_SPEC), None) is None


@pytest.mark.parametrize("spec", [_MIMO_DIRECT_SPEC, _DEEPSEEK_SPEC, _UNPROFILED_SPEC])
def test_a_non_zen_go_host_gets_no_conversation_header(spec: str) -> None:
    assert conversation_routing_settings(parse_model_spec(spec), "conv-1") is None


def test_a_fallback_chain_that_leaves_the_gateway_gets_no_conversation_header() -> None:
    chain = make_fallback_model(_ZEN_GO_SPEC, _DEEPSEEK_SPEC)

    assert conversation_routing_settings(chain, "conv-1") is None


def test_a_fallback_chain_inside_the_gateway_keeps_the_conversation_header() -> None:
    chain = make_fallback_model(_ZEN_GO_SPEC, _ZEN_GO_ALTERNATE_SPEC)

    settings = conversation_routing_settings(chain, "conv-1")

    assert settings is not None
    assert settings["extra_headers"] == {_SESSION_HEADER: "conv-1"}


async def test_a_per_run_header_reaches_the_wire_over_the_process_default() -> None:
    """The SDK contract this design rests on: per-request `extra_headers`
    override the client's `default_headers` on the actual outbound request."""
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_CHAT_COMPLETION_STUB)

    transport = httpx.AsyncClient(transport=httpx.MockTransport(record))
    client = make_sdk_client(_ZEN_GO_SPEC, transport)
    await client.chat.completions.create(
        model="mimo-v2.5",
        messages=[{"role": "user", "content": "hi"}],
        extra_headers={_SESSION_HEADER: "conv-1"},
    )

    assert seen[0].headers[_SESSION_HEADER] == "conv-1"
    assert seen[0].headers[_APP_CLIENT_HEADER] == "animichi Dev"
