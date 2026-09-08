"""The record one uncapped run writes and every later run is judged against.

Its own module (#1499) for the reason ``packages/eval/src/gate/baseline-record.ts``
is: both ``gate.py`` — which reads, writes and ages the record — and
``metric_gate.py`` — which compares a run against it — need the type, and
``gate.py`` imports ``metric_gate``, so leaving it there would make the second
import a cycle.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class BaselineRecord(BaseModel):
    """Schema-v2 baseline with aggregate and per-case scores."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal[2] = 2
    model: str
    dataset: str
    tier: str
    #: The evaluator vocabulary that produced these numbers. Optional because
    #: the translation tier writes records with evaluators of its own and every
    #: record committed before 2026-09-07 predates the field, so
    #: ``read_baseline_record`` — which refuses a record naming any other
    #: vocabulary, at the cost of one ungated run that re-stamps this field —
    #: reads ``None`` as "this record cannot say" (#1303).
    evaluator_version: str | None = None
    repeat: int = 1
    case_count: int
    evaluated_count: int
    errored_count: int = 0
    scores: dict[str, float]
    cases: dict[str, dict[str, float]]
    note: str | None = None

    @property
    def case_metrics(self) -> set[str]:
        """Every metric the per-case half names, whatever the aggregate says."""
        return {metric for scores in self.cases.values() for metric in scores}
