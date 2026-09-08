"""Pytest entrypoints for the two-tier four-layer agent eval."""

from __future__ import annotations

import os

import pytest

from animichi.interfaces.public_api import default_catalog_client
from animichi.tests.eval.eval_gate_flow import finish_cli_report
from animichi.tests.eval.eval_harness import (
    DATASET_PATH,
    EVAL_MODEL_ID,
    AgentInput,
    AgentReport,
    evaluate_target,
    make_agent_task,
)
from animichi.tests.eval.exec_tiers import (
    EvalTierTarget,
    trajectory_web_mocks,
)
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.null_database import NullDatabase
from animichi.tests.eval.provider_outage import ProviderOutage
from animichi.tests.eval.run_scores import NoEvaluatedCases
from animichi.tests.eval.stats import CaseStrata
from animichi.tests.eval.strata_first_run import evaluate_after_strata

__all__ = ["AgentInput", "make_agent_task"]


# This compatibility pytest alias shares finish_cli_report with the CLI runner.
# Uncapped all-error reports deliberately fail here instead of being skipped.
def _assert_report(
    report: AgentReport,
    target: EvalTierTarget,
    strata: CaseStrata,
    model_id: str = EVAL_MODEL_ID,
) -> None:
    try:
        failures = finish_cli_report(report, target, model_id, strata)
    except (ProviderOutage, NoEvaluatedCases) as exc:
        pytest.fail(str(exc))
    if failures is None:
        pytest.skip(f"Baseline created for {model_id}; re-run to enforce gate.")
    assert not failures, "Regression:\n" + "\n".join(failures)


async def _run_pytest_tier(target: EvalTierTarget) -> None:
    strata, report = await evaluate_after_strata(
        DATASET_PATH, lambda: evaluate_target(target)
    )
    report.print(include_input=True, include_output=True)
    _assert_report(report, target, strata)


@pytest.mark.integration
async def test_agent_trajectory() -> None:
    await _run_pytest_tier(
        EvalTierTarget(
            db=NullDatabase(),
            catalog_factory=MockCatalogClient,
            layer="agent_l4_trajectory",
            tier="trajectory",
            source="DB: NullDatabase",
            web_mocks=trajectory_web_mocks(),
        )
    )


@pytest.mark.integration
@pytest.mark.skipif(
    os.environ.get("EVAL_FULLSTACK") != "1",
    reason="fullstack tier is opt-in (EVAL_FULLSTACK=1)",
)
async def test_agent_fullstack(request: pytest.FixtureRequest) -> None:
    await _run_pytest_tier(
        EvalTierTarget(
            db=request.getfixturevalue("real_db"),
            catalog_factory=default_catalog_client,
            layer="agent_l4",
            tier="fullstack",
            source="DB: real_db fixture",
        )
    )
