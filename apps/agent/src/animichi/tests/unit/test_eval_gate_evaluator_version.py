"""The baseline reader refuses a record scored by another evaluator (#1303).

`packages/eval/src/gate/baseline-store.ts` reaches the same verdict on the same
record and fails the run with it; `gate.py` warns and drops the record, which is
this side's convention for a baseline it cannot use (#1483).
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from animichi.tests.eval.eval_harness import DEFAULT_MODEL_ID
from animichi.tests.eval.evaluator_version import EVALUATOR_VERSION
from animichi.tests.eval.gate import (
    BaselineRecord,
    baseline_path,
    read_baseline_record,
    write_baseline_record,
)

_BASELINES_DIR = Path(__file__).parents[1] / "eval" / "baselines"
_GATE_LOGGER = "animichi.tests.eval.gate"
_OTHER_VERSION = "official-v1"


def make_baseline_record(evaluator_version: str | None) -> BaselineRecord:
    return BaselineRecord(
        model="m",
        dataset="translation_v1",
        tier="translation",
        evaluator_version=evaluator_version,
        case_count=1,
        evaluated_count=1,
        scores={"Accuracy": 1.0},
        cases={"case-0": {"Accuracy": 1.0}},
    )


def read_after_write(
    record: BaselineRecord, baselines_dir: Path
) -> BaselineRecord | None:
    write_baseline_record(
        record, layer="agent", model_id="m", baselines_dir=baselines_dir
    )
    return read_baseline_record("agent", "m", baselines_dir=baselines_dir)


def test_a_record_from_another_evaluator_is_refused(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger=_GATE_LOGGER):
        result = read_after_write(make_baseline_record(_OTHER_VERSION), tmp_path)

    assert result is None


def test_the_refusal_names_both_evaluator_versions(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger=_GATE_LOGGER):
        read_after_write(make_baseline_record(_OTHER_VERSION), tmp_path)

    assert (
        f"scored by evaluator {_OTHER_VERSION}, this runner scores "
        f"{EVALUATOR_VERSION}" in caplog.text
    )


def test_the_refusal_is_the_damaged_record_class(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """`Invalid baseline for …` — what gate.py logs for a record it cannot use."""
    with caplog.at_level(logging.WARNING, logger=_GATE_LOGGER):
        read_after_write(make_baseline_record(_OTHER_VERSION), tmp_path)

    assert caplog.text.count("Invalid baseline for agent/m at ") == 1


def test_a_record_without_an_evaluator_version_is_read(tmp_path: Path) -> None:
    """Every record committed before the field existed has that shape."""
    result = read_after_write(make_baseline_record(None), tmp_path)

    assert result is not None


def test_a_record_from_this_evaluator_is_read(tmp_path: Path) -> None:
    result = read_after_write(make_baseline_record(EVALUATOR_VERSION), tmp_path)

    assert result is not None


def test_the_committed_trajectory_baseline_names_this_evaluator() -> None:
    """The stamp #1482 wrote, read off the file rather than through the reader.

    `test_eval_gate_io.py::test_l4_trajectory_baseline_is_current_for_the_live_dataset`
    covers the reader's verdict on this record; this is the fact that verdict
    now rests on, and the twin of `test/gate-baseline-record.test.ts`.
    """
    path = baseline_path("agent_l4_trajectory", DEFAULT_MODEL_ID, _BASELINES_DIR)

    record = BaselineRecord.model_validate_json(path.read_text())

    assert record.evaluator_version == EVALUATOR_VERSION
