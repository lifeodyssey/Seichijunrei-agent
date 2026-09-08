"""Refuse an eval run the model provider starved, before a metric is missed.

``ErrorResponseModel`` is never one of the model's own output choices
(``runtime_models.py``): ``error_boundary._on_run_error`` is the only thing that
builds one, for an agent-loop exception nobody classified. The run then FINISHES
— the boundary hands back a clean result — so the case is evaluated, not failed,
``report.failures`` stays empty and ``error_rate_gate`` has nothing to count.
That is how the nightly of 2026-09-08 turned a total gateway outage (#1477) into
``Missing metric(s): argument_correctness``: seven columns' worth of scores for
662 turns that never reached the model.

The ceiling is ``smoke_errors.TRANSPORT_RATE_CEILING``'s, for its reason — a run
where more than a fifth of the cases never reached the model is untrustworthy as
evidence about the code, and must be re-run rather than judged. The payload TYPE
is the whole discriminator: a boundary error that got some steps away first is
the same outage, so counting only stepless turns would let a partial one pass.

``provider_outage_failure`` takes counts and the party to blame, nothing else,
so ``gate_oracle.py`` can publish its sentences and
``packages/eval/src/gate-run/provider-outage.ts`` — which has the same blind spot
over the edge's error envelope — can be measured against them. What goes in that
last slot is each runner's own: this one names the model it built the run with,
while the TS runner holds a door and no model name it could honestly blame
(``DEPLOYED_AGENT_TIER``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import ErrorResponseModel

if TYPE_CHECKING:  # `gate_oracle` imports this module without a dataset.
    from animichi.tests.eval.eval_harness import AgentReport

#: The share of starved cases above which a run is an outage, not a result.
PROVIDER_OUTAGE_CEILING = 0.20


class ProviderOutage(RuntimeError):
    """Raised when the error boundary answered for more cases than the ceiling."""


def provider_outage_failure(
    starved: int, evaluated: int, answered_by: str
) -> str | None:
    """The gate's own sentence, or ``None`` when the run is judgeable."""
    share = starved / evaluated if evaluated else 0.0
    if share <= PROVIDER_OUTAGE_CEILING:
        return None
    return (
        f"{starved}/{evaluated} evaluated cases came back as the agent's error "
        f"payload ({_percent(share)} > {_percent(PROVIDER_OUTAGE_CEILING)}): "
        f"{answered_by} answered nothing the evaluators could score. This run is a "
        "provider outage, not a result — re-run it."
    )


def refuse_starved_run(report: AgentReport, *, model_id: str) -> None:
    """Fail the run before a starved metric can be reported as a missing one."""
    failure = provider_outage_failure(
        _starved_cases(report), len(report.cases), model_id
    )
    if failure is not None:
        raise ProviderOutage(failure)


def _percent(share: float) -> str:
    return f"{share:.0%}"


def _starved_cases(report: AgentReport) -> int:
    return sum(1 for case in report.cases if _is_error_payload(case.output))


def _is_error_payload(output: object) -> bool:
    """The boundary's payload, as the runner records it on the turn's result."""
    return isinstance(output, AgentResult) and isinstance(
        output.output, ErrorResponseModel
    )
