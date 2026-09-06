"""Cross-language deployment invariants for the agent container."""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[6]
_ENV = _ROOT / "workers/edge/src/container/container-env.ts"
_DELIVERY = _ROOT / ".github/workflows/cd.yml"
_DOCKERFILE = _ROOT / "apps/agent/Dockerfile"


def _typescript_string_list(source: str, name: str) -> set[str]:
    match = re.search(
        rf"const\s+{re.escape(name)}\s*=\s*\[(?P<body>.*?)\]\s*;",
        source,
        re.DOTALL,
    )
    assert match is not None, f"missing TypeScript constant: {name}"
    return set(re.findall(r'["\']([A-Z][A-Z0-9_]*)["\']', match["body"]))


def test_container_required_keys_are_forwarded() -> None:
    source = _ENV.read_text()
    required = _typescript_string_list(source, "CONTAINER_REQUIRED_KEYS")
    forwarded = _typescript_string_list(source, "CONTAINER_ENV_KEYS")
    assert required
    assert required <= forwarded


def test_promotion_reuses_worker_artifacts_without_mutating_runtime_secrets() -> None:
    delivery = _DELIVERY.read_text()
    assert "download-artifact" in delivery
    assert "deploy " in delivery
    assert "--no-bundle" in delivery
    assert "secret put" not in delivery
    assert "secret bulk" not in delivery
    assert "worker_secrets" not in delivery


def test_sealed_release_artifacts_do_not_contain_agent_model_keys() -> None:
    delivery = _DELIVERY.read_text()
    assert "ZEN_GO_API_KEY" not in delivery
    assert "MIMO_API_KEY" not in delivery
    assert "DEEPSEEK_API_KEY" not in delivery


def test_dockerfile_does_not_hardcode_a_privileged_app_env() -> None:
    assert "APP_ENV=" not in _DOCKERFILE.read_text()
