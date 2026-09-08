"""The schema of the per-run results file the eval writes to ``results/``.

Split out of ``exec_tiers.py`` (#1493), which is the execution tier itself: the
models here are the committed artifact's shape and are read back by the gate
equivalence tests, so they answer to the file rather than to the run.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class UsageRow(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    requests: int = 0


class UsageSummary(UsageRow):
    cases_with_usage: int = 0


class CaseRow(BaseModel):
    id: str | None = None
    scores: dict[str, float] | None = None
    reasons: dict[str, str] | None = None
    error: str | None = None
    intent: str | None = None
    message: str | None = None
    message_locale: str | None = None
    steps: list[str] | None = None
    step_count: int | None = None
    query: str | None = None
    locale: str | None = None
    expected_stages: list[str] | None = None
    usage: UsageRow | None = None


class ResultsPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    model: str
    evaluator_version: str = "unknown"
    dataset: str
    tier: str
    repeat: int = 1
    retries: int = 0
    case_count: int
    evaluated_count: int
    errored_count: int
    scores: dict[str, float]
    #: What the run has to say about the numbers above — today, the pooled-stratum
    #: line a dataset with no ``path`` column earns (#1478). It sits IN THE FILE
    #: rather than only in the log because the result file is what is committed and
    #: compared later, and an unstratified interval nobody is told about is the
    #: defect in a quieter form. `GateRunResult.warnings` is the TS side of it.
    warnings: list[str] = []
    cases: list[CaseRow]
    usage: UsageSummary = UsageSummary()
