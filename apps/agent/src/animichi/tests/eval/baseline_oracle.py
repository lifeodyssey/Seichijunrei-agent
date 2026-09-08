"""The baseline-record half of the oracle the TypeScript port is pinned against.

``gate.py`` decides three things about a record before any statistic runs: where
it lives, whether it is still fresh, and what it looks like on disk. Each of
those is exercised here through the real functions, so the TS port asserts
against Python's answers rather than a second guess at them.

Warnings that carry a filesystem path (missing / invalid baseline) are left out:
the path differs between the two runs, so only their shape is testable, and that
is asserted on the TS side alone.

Written through ``stats_oracle.py``, the module that owns the output file.
"""

from __future__ import annotations

import json
import logging
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from animichi.tests.eval.gate import (
    BaselineRecord,
    baseline_path,
    read_baseline_record,
    write_baseline_record,
)

EVAL_DIR = Path(__file__).parent
BASELINE_FILE = (
    "agent_l4_trajectory_openai-mimo-v2.5-https---api.xiaomimimo.com-v1.json"
)
STALE_LAYER = "agent_l4_trajectory"
STALE_MODEL = "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"


class _MessageCollector(logging.Handler):
    """Records the gate's formatted warnings so they can be pinned verbatim."""

    def __init__(self, messages: list[str]) -> None:
        super().__init__(level=logging.WARNING)
        self._messages = messages

    def emit(self, record: logging.LogRecord) -> None:
        self._messages.append(record.getMessage())


@contextmanager
def collected_warnings() -> Iterator[list[str]]:
    messages: list[str] = []
    # The package logger, not ``…eval.gate``: the metric loop's warnings come
    # from ``…eval.metric_gate`` since #1499 and must still be pinned.
    logger = logging.getLogger("animichi.tests.eval")
    handler = _MessageCollector(messages)
    logger.addHandler(handler)
    try:
        yield messages
    finally:
        logger.removeHandler(handler)


def record_json(record: BaselineRecord) -> dict[str, object]:
    parsed: object = json.loads(record.model_dump_json())
    if not isinstance(parsed, dict):
        raise TypeError("a baseline record must serialize to a JSON object")
    return {str(key): value for key, value in parsed.items()}


def synthetic_record(deltas: Sequence[float]) -> BaselineRecord:
    cases = {f"case-{index}": {"metric": value} for index, value in enumerate(deltas)}
    return BaselineRecord(
        model="test",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=len(cases),
        evaluated_count=len(cases),
        scores={"metric": 0.0},
        cases=cases,
    )


def error_baseline(evaluated: int, errored: int) -> BaselineRecord:
    return BaselineRecord(
        model="test",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=evaluated + errored,
        evaluated_count=evaluated,
        errored_count=errored,
        scores={"metric": 0.0},
        cases={},
    )


def real_baseline() -> BaselineRecord:
    path = EVAL_DIR / "baselines" / BASELINE_FILE
    return BaselineRecord.model_validate_json(path.read_text())


def _low_evaluated_record() -> BaselineRecord:
    record = synthetic_record([0.0] * 25)
    return record.model_copy(update={"evaluated_count": 19})


def _staleness_case(
    name: str,
    record: BaselineRecord,
    expected_case_count: int | None,
    expected_metrics: Sequence[str] | None,
) -> dict[str, object]:
    with tempfile.TemporaryDirectory() as directory:
        loaded, warnings = _read_in(
            Path(directory), record, expected_case_count, expected_metrics
        )
    return {
        "name": name,
        "record": record_json(record),
        "expected_case_count": expected_case_count,
        "expected_metrics": None
        if expected_metrics is None
        else list(expected_metrics),
        "loaded": loaded,
        "warnings": warnings,
    }


def _read_in(
    directory: Path,
    record: BaselineRecord,
    expected_case_count: int | None,
    expected_metrics: Sequence[str] | None,
) -> tuple[bool, list[str]]:
    write_baseline_record(
        record, layer=STALE_LAYER, model_id=STALE_MODEL, baselines_dir=directory
    )
    with collected_warnings() as warnings:
        loaded = read_baseline_record(
            STALE_LAYER,
            STALE_MODEL,
            baselines_dir=directory,
            expected_case_count=expected_case_count,
            expected_metrics=expected_metrics,
        )
    return loaded is not None, warnings


def _staleness_cases() -> list[dict[str, object]]:
    fresh = synthetic_record([0.0] * 25)
    return [
        _staleness_case("fresh", fresh, 25, ["metric"]),
        _staleness_case("no_expectations", fresh, None, None),
        _staleness_case("case_count_changed", fresh, 30, None),
        _staleness_case("evaluated_count_low", _low_evaluated_record(), 25, None),
        _staleness_case("metric_vocabulary_changed", fresh, 25, ["metric", "extra"]),
    ]


def _baseline_paths() -> list[dict[str, str]]:
    models = ["openai:mimo-v2.5@https://opencode.ai/zen/go/v1", "plain-model"]
    return [_baseline_path_case(model) for model in models]


def _baseline_path_case(model_id: str) -> dict[str, str]:
    with tempfile.TemporaryDirectory() as directory:
        path = baseline_path(STALE_LAYER, model_id, Path(directory))
    return {"layer": STALE_LAYER, "model_id": model_id, "filename": path.name}


def _written_text(record: BaselineRecord) -> dict[str, object]:
    with tempfile.TemporaryDirectory() as directory:
        path = write_baseline_record(
            record,
            layer=STALE_LAYER,
            model_id=STALE_MODEL,
            baselines_dir=Path(directory),
        )
        return {"record": record_json(record), "text": path.read_text()}


def _written_records() -> list[dict[str, object]]:
    scored = synthetic_record([0.0, 1.0, 0.5])
    return [
        _written_text(scored),
        _written_text(error_baseline(50, 0)),
        _written_text(scored.model_copy(update={"note": "a note", "repeat": 3})),
        _written_text(real_baseline()),
    ]


FIXED_VALUES = [
    0.0,
    1.0,
    -1.0,
    0.1,
    0.9,
    0.15625,
    0.03125,
    -0.15625,
    -0.03125,
    0.09375,
    5e-05,
    0.12345,
    -0.0,
    0.7749999999999999,
]
PERCENT_VALUES = [0.21, 0.2, 0.625, 0.375, 1.0, 0.205, 0.5, 0.9999, 0.0]
REPR_VALUES = [
    0.0,
    1.0,
    0.5,
    -0.0,
    0.0001,
    1e-05,
    1e16,
    1e15,
    0.9959100204498977,
    1 / 3,
    100.0,
    2.5e-07,
    0.7427701674277016,
]


def baseline_sections() -> dict[str, object]:
    """Every reference value drawn from a baseline record's own behaviour."""
    return {
        "baseline_staleness": _staleness_cases(),
        "baseline_paths": _baseline_paths(),
        "written_records": _written_records(),
    }
