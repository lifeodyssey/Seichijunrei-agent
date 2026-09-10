"""Deterministic repository documentation guardrails."""

from __future__ import annotations

import pytest

from animichi.tests.unit.documentation_guardrails import (
    HISTORICAL_MARKER,
    REPO_ROOT,
    _coverage_key_drift,
    assert_retired_technologies_are_historical,
    check_retired_technology_docs,
    documented_coverage_thresholds,
    extract_agent_runtime_section,
    live_coverage_thresholds,
)

READS: tuple[str, ...] = (
    "apps/agent/pyproject.toml",
    "apps/web/vitest.config.ts",
    "docs/ARCHITECTURE.md",
    "docs/ops/deployment.md",
    "docs/testing-strategy.md",
)


def test_unmarked_retired_technology_fails() -> None:
    with pytest.raises(ValueError, match="Next.js"):
        assert_retired_technologies_are_historical("Current stack: Next.js")


def test_historical_marker_allows_retired_technology() -> None:
    historical_note = f"{HISTORICAL_MARKER}\nIssue #537 retired Next.js."

    assert_retired_technologies_are_historical(historical_note)


def test_canonical_docs_only_allow_marked_retired_technology() -> None:
    check_retired_technology_docs(REPO_ROOT)


def test_coverage_key_drift_names_the_unexpected_key() -> None:
    live = live_coverage_thresholds(REPO_ROOT)

    assert _coverage_key_drift({**live, "Frontend vibes": 1}) == (
        "unexpected Frontend vibes"
    )


def test_coverage_key_drift_names_the_missing_key() -> None:
    live = dict(live_coverage_thresholds(REPO_ROOT))
    del live["Backend total"]

    assert _coverage_key_drift(live) == "missing Backend total"


def test_documented_coverage_thresholds_match_live_configs() -> None:
    assert documented_coverage_thresholds(REPO_ROOT) == live_coverage_thresholds(
        REPO_ROOT
    )


@pytest.mark.parametrize(
    "fact",
    (
        "Request and execution",
        "AgentHarness",
        "AgentLane",
        "registers durable recovery before",
        "inspectExecution/getResult",
        "Native Pi owns",
        "Shared production/Eval composition",
        "There is no compatibility converter",
    ),
)
def test_architecture_records_the_live_agent_runtime(fact: str) -> None:
    architecture = (REPO_ROOT / "docs/ARCHITECTURE.md").read_text(encoding="utf-8")

    assert fact in extract_agent_runtime_section(architecture)
