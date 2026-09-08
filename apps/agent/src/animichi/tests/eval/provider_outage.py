"""Refuse an eval run the model provider starved, before a metric is missed.

``ErrorResponseModel`` is never one of the model's own output choices
(``runtime_models.py``): ``error_boundary._on_run_error`` is the only thing that
builds one, for an agent-loop exception nobody classified. The run then FINISHES
— the boundary hands back a clean result — so the case is evaluated, not failed,
``report.failures`` stays empty and ``error_rate_gate`` has nothing to count.
That is how the nightly of 2026-09-08 turned a total gateway outage (#1477) into
``Missing metric(s): argument_correctness``: seven columns' worth of scores for
662 turns that never reached the model.

TWO LANES, TWO CEILINGS (#1499). A CAPPED run reads no baseline and writes none
(``eval_gate_flow._run_capped_gate``), so a starved fifth — the share
``smoke_errors.TRANSPORT_RATE_CEILING`` calls untrustworthy, and a backstop that
only has to kill the 100% case — spoils nothing but the numbers that one run
prints. The UNCAPPED run is the other lane: it is the only one that MINTS the
record every later run is judged against, and the only one that dilutes a
comparison against it. At 0.20 a 662-case nightly admits 132 starved cases, so
that lane gets a hundredth-scale ceiling of its own. ``outage_ceiling`` takes
the run mode, which ``eval_harness.CAPPED`` has already decided.

The payload TYPE is the whole discriminator: a boundary error that got some
steps away first is the same outage, so counting only stepless turns would let a
partial one pass.

``provider_outage_failure`` takes counts, the party to blame and the ceiling it
judged against, nothing else, so ``gate_oracle.py`` can publish its sentences
and ``packages/eval/src/gate-run/provider-outage.ts`` — which has the same blind
spot over the edge's error envelope — can be measured against them. What goes in
those last two slots is each runner's own: this one names the model it built the
run with and the ceiling its lane picked, while the TS runner holds a door, has
no model name it could honestly blame (``DEPLOYED_AGENT_TIER``) and needs only
one ceiling because it never writes a baseline (``gate-exit-code.ts:10``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import ErrorResponseModel

if TYPE_CHECKING:  # `gate_oracle` imports this module without a dataset.
    from animichi.tests.eval.eval_harness import AgentReport

#: The starved share above which a CAPPED run is an outage rather than a result.
CAPPED_LANE_CEILING = 0.20

#: The same, for the lane that may write the baseline: an uncapped run.
BASELINE_LANE_CEILING = 0.02


class ProviderOutage(RuntimeError):
    """Raised when the error boundary answered for more cases than the ceiling."""


def outage_ceiling(*, is_capped: bool) -> float:
    """The run mode is the lane, and the lane is the ceiling."""
    return CAPPED_LANE_CEILING if is_capped else BASELINE_LANE_CEILING


def provider_outage_failure(
    starved: int, evaluated: int, answered_by: str, ceiling: float
) -> str | None:
    """The gate's own sentence, or ``None`` when the run is judgeable."""
    share = starved / evaluated if evaluated else 0.0
    if share <= ceiling:
        return None
    return (
        f"{starved}/{evaluated} evaluated cases came back as the agent's error "
        f"payload ({_percent(share)} > {_percent(ceiling)}): "
        f"{answered_by} answered nothing the evaluators could score. This run is a "
        "provider outage, not a result — re-run it."
    )


def refuse_starved_run(report: AgentReport, *, model_id: str, is_capped: bool) -> None:
    """Fail the run before a starved metric can be reported as a missing one."""
    failure = provider_outage_failure(
        len(starved_case_ids(report)),
        len(report.cases),
        model_id,
        outage_ceiling(is_capped=is_capped),
    )
    if failure is not None:
        raise ProviderOutage(failure)


def starved_case_ids(report: AgentReport) -> frozenset[str]:
    """The evaluated cases the error boundary answered for, named."""
    return frozenset(
        str(case.name) for case in report.cases if _is_error_payload(case.output)
    )


def _percent(share: float) -> str:
    return f"{share:.0%}"


def _is_error_payload(output: object) -> bool:
    """The boundary's payload, as the runner records it on the turn's result."""
    return isinstance(output, AgentResult) and isinstance(
        output.output, ErrorResponseModel
    )
