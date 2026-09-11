"""Architecture describes the implemented native anonymous identity and budget boundaries."""

from __future__ import annotations

from pathlib import Path

import pytest

ARCHITECTURE = Path(__file__).resolve().parents[6] / "docs" / "ARCHITECTURE.md"
WORKER = Path(__file__).resolve().parents[6] / "workers" / "edge" / "src"


@pytest.fixture(scope="module")
def architecture() -> str:
    return ARCHITECTURE.read_text(encoding="utf-8")


def test_the_auth_section_names_the_real_worker_modules(architecture: str) -> None:
    assert "`workers/edge/src/identity/auth.ts`" in architecture
    assert "`workers/edge/src/identity/anonymous-id.ts`" in architecture


def test_anonymous_access_is_documented_as_implemented(architecture: str) -> None:
    assert "Anonymous identity is an HMAC-protected cookie" in architecture
    assert "Verified forwarded identity" in architecture


def test_the_documented_identity_shape_matches_the_code(architecture: str) -> None:
    auth_source = (WORKER / "identity" / "auth.ts").read_text(encoding="utf-8")
    anonymous_source = (WORKER / "identity" / "anonymous-id.ts").read_text(
        encoding="utf-8"
    )
    assert '"anonymous"' in auth_source
    assert 'ANON_ID_PREFIX = "anon_"' in anonymous_source
    assert "X-User-Type: anonymous" in architecture
    assert "X-User-Id: anon_<hex>" in architecture


def test_the_documented_opt_in_switches_match_the_worker(architecture: str) -> None:
    auth_source = (WORKER / "identity" / "anonymous-id.ts").read_text(encoding="utf-8")
    for name in ("ANON_ACCESS_ENABLED", "ANON_ID_SECRET"):
        assert name in architecture
        assert name in auth_source


def test_the_documented_breaker_names_its_code_and_data_source(
    architecture: str,
) -> None:
    assert "anon_budget_exhausted" in architecture
    assert "ANON_DAILY_COST_BUDGET_USD" in architecture
    assert "daily_usage" in architecture


def test_the_breaker_is_documented_as_native_authoritative(
    architecture: str,
) -> None:
    assert "`workers/edge/src/agent/host/native-authority.ts`" in architecture
    assert "enforced before admission, drive and tool execution" in architecture
    assert "container ingress is the authoritative decider" not in architecture


def test_the_breaker_is_implemented_on_the_native_tier(architecture: str) -> None:
    bootstrap = (WORKER / "agent" / "host" / "native-bootstrap.ts").read_text(
        encoding="utf-8"
    )
    authority = (WORKER / "agent" / "host" / "native-authority.ts").read_text(
        encoding="utf-8"
    )
    assert "ANON_DAILY_COST_BUDGET_USD" in bootstrap
    assert "daily_usage" in authority
    assert "requireToolAuthority" in bootstrap
    assert "this ceiling currently has no decider" not in architecture


def test_zero_history_anonymous_visitors_are_documented_as_allowed(
    architecture: str,
) -> None:
    unwrapped = " ".join(architecture.split())
    assert "there is no minimum-history threshold" in unwrapped
