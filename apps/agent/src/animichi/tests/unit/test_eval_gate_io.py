"""Unit tests for eval baseline record IO."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from animichi.tests.eval.eval_harness import ALL_CASES, DEFAULT_MODEL_ID, METRIC_NAMES
from animichi.tests.eval.gate import (
    BaselineRecord,
    baseline_path,
    read_baseline_record,
    write_baseline_record,
)

_BASELINES_DIR = Path(__file__).parents[1] / "eval" / "baselines"


def _record(case_count: int = 2, evaluated_count: int = 2) -> BaselineRecord:
    cases = {f"case-{idx}": {"Accuracy": 1.0} for idx in range(case_count)}
    return BaselineRecord(
        model="m",
        dataset="translation_v1",
        tier="translation",
        case_count=case_count,
        evaluated_count=evaluated_count,
        scores={"Accuracy": 1.0},
        cases=cases,
    )


def test_baseline_path_sanitizes_model_id(tmp_path: Path) -> None:
    path = baseline_path("agent", "org/model:v1@latest", tmp_path)

    assert path == tmp_path / "agent_org-model-v1-latest.json"


def test_write_read_round_trip(tmp_path: Path) -> None:
    record = _record()

    path = write_baseline_record(
        record,
        layer="translation",
        model_id="translation",
        baselines_dir=tmp_path,
    )
    result = read_baseline_record(
        "translation",
        "translation",
        baselines_dir=tmp_path,
        expected_case_count=2,
    )

    assert path.read_text().endswith("\n")
    assert result == record


def test_rejects_unknown_schema_version() -> None:
    payload = (
        _record().model_dump_json().replace('"schema_version":2', '"schema_version":3')
    )

    with pytest.raises(ValueError):
        BaselineRecord.model_validate_json(payload)


def test_committed_baselines_validate() -> None:
    paths = sorted(_BASELINES_DIR.glob("*.json"))

    # The trajectory baseline moved back to the direct MiMo endpoint on
    # 2026-09-07 (#1303): the zen/go gateway now refuses every request that
    # carries no `x-opencode-session`, so no run can be made against it.
    assert len(paths) == 2
    for path in paths:
        BaselineRecord.model_validate_json(path.read_text())


def test_l4_trajectory_baseline_is_current_for_the_live_dataset() -> None:
    """Card #227 AC1: the L1 baseline must track today's live dataset.

    read_baseline_record returns None for a missing OR stale (wrong case count
    or metric vocabulary) baseline — a stronger, CI-checkable "is current"
    invariant than test_committed_baselines_validate's schema-only check.
    """
    record = read_baseline_record(
        "agent_l4_trajectory",
        DEFAULT_MODEL_ID,
        baselines_dir=_BASELINES_DIR,
        expected_case_count=len(ALL_CASES),
        expected_metrics=METRIC_NAMES,
    )

    assert record is not None
    assert record.case_count == len(ALL_CASES)
    # errored_count is part of the baseline; "current" means dataset + metric
    # vocabulary match, not any particular error count. The 2026-09-07 run
    # errored on none of the 662 (#1303); the 2026-08 one errored on five.
    assert record.errored_count == 0
    assert record.evaluated_count + record.errored_count == record.case_count
    assert set(record.scores) == set(METRIC_NAMES)


def test_read_returns_none_for_missing_file(tmp_path: Path) -> None:
    result = read_baseline_record("agent", "m", baselines_dir=tmp_path)

    assert result is None


def test_read_returns_none_for_legacy_aggregate_json(tmp_path: Path) -> None:
    path = baseline_path("agent", "m", tmp_path)
    payload = {"model": "m", "case_count": 5, "scores": {"a": 1.0}}
    path.write_text(json.dumps(payload))

    result = read_baseline_record("agent", "m", baselines_dir=tmp_path)

    assert result is None


def test_read_returns_none_for_stale_case_count(tmp_path: Path) -> None:
    write_baseline_record(
        _record(case_count=5), layer="agent", model_id="m", baselines_dir=tmp_path
    )

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=6,
    )

    assert result is None


def test_read_returns_none_for_low_evaluated_count(tmp_path: Path) -> None:
    write_baseline_record(
        _record(case_count=10, evaluated_count=7),
        layer="agent",
        model_id="m",
        baselines_dir=tmp_path,
    )

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=10,
    )

    assert result is None


def test_read_returns_none_for_stale_metric_vocabulary(tmp_path: Path) -> None:
    write_baseline_record(
        _record(), layer="agent", model_id="m", baselines_dir=tmp_path
    )

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=2,
        expected_metrics=["tool_correctness"],
    )

    assert result is None


def test_read_rejects_stale_per_case_metric_vocabulary(tmp_path: Path) -> None:
    record = _record().model_copy(update={"scores": {"tool_correctness": 1.0}})
    write_baseline_record(record, layer="agent", model_id="m", baselines_dir=tmp_path)

    result = read_baseline_record(
        "agent",
        "m",
        baselines_dir=tmp_path,
        expected_case_count=2,
        expected_metrics=["tool_correctness"],
    )

    assert result is None
