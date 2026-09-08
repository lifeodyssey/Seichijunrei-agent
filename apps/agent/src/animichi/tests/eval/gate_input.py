"""Everything one finished eval run hands the gates.

Its own module (#1499) because ``eval_gate_flow`` is over the file cap and two
of its neighbours need this type: ``baseline_mint``, which turns a run into the
record later runs are judged against, and the flow itself. Importing it back
out of ``eval_gate_flow`` would be a cycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias

from animichi.tests.eval.direct_gates import TrajectoryCase
from animichi.tests.eval.run_scores import ScoreMap
from animichi.tests.eval.smoke_errors import SmokeError
from animichi.tests.eval.trajectory_assertions import TrajectoryExpectation

CaseScores: TypeAlias = dict[str, ScoreMap]


@dataclass(frozen=True)
class GateInput:
    model: str
    dataset: str
    tier: str
    case_count: int
    evaluated_count: int
    scores: ScoreMap
    cases: CaseScores
    errors: tuple[SmokeError, ...] = ()
    trajectories: tuple[TrajectoryCase, ...] = ()
    expectations: tuple[TrajectoryExpectation, ...] = ()
    strata: dict[str, str] | None = None
    #: The evaluated cases the error boundary answered for
    #: (``provider_outage.starved_case_ids``). Named rather than counted:
    #: ``metric_gate`` has to know WHICH pairs the outage took, and
    #: ``baseline_mint`` only has to know that it took any.
    starved: frozenset[str] = frozenset()

    @property
    def errored_count(self) -> int:
        """Single source of truth: the classified errors are the errored cases."""
        return len(self.errors)
