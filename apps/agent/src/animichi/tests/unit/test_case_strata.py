"""What ``load_case_strata`` answers for a dataset with, and without, a path.

Also where the answer ends up: a pooled set's warning has to survive the log and
land in the saved result, which is the file anyone reads after the run (#1478).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic_evals.reporting import EvaluationReport

from animichi.tests.eval import eval_gate_flow
from animichi.tests.eval.baseline_oracle import EVAL_DIR
from animichi.tests.eval.eval_gate_flow import finish_cli_report
from animichi.tests.eval.exec_tiers import EvalTierTarget
from animichi.tests.eval.stats import (
    UNSTRATIFIED,
    CaseStrata,
    MalformedEvalDataset,
    case_strata_from_text,
    load_case_strata,
    pooled_stratum_warning,
)
from animichi.tests.eval.strata_first_run import (
    evaluate_after_strata,
    preflight_strata,
)

DATASETS_DIR = EVAL_DIR / "datasets"

#: Every canonical set with no ``path`` column anywhere — the #1303 double run
#: crashed on the first three, and the other two would have crashed next.
POOLED_SETS = [
    "injection_g1_v1",
    "input_guard_v1",
    "phase1c_selection_v1",
    "runtime_journey_v1",
    "translation_v1",
]


@pytest.fixture
def pooled_dataset(tmp_path: Path) -> Path:
    path = tmp_path / "pooled_set.json"
    path.write_text(json.dumps([{"id": "a"}, {"id": "b"}]))
    return path


def _dataset_path(set_name: str) -> Path:
    return DATASETS_DIR / f"{set_name}.json"


@pytest.mark.parametrize("set_name", POOLED_SETS)
def test_a_set_without_a_path_column_is_one_stratum(set_name: str) -> None:
    strata = load_case_strata(_dataset_path(set_name))
    assert set(strata.by_case.values()) == {UNSTRATIFIED}


@pytest.mark.parametrize("set_name", POOLED_SETS)
def test_a_pooled_set_says_so(set_name: str) -> None:
    strata = load_case_strata(_dataset_path(set_name))
    assert strata.warnings == [pooled_stratum_warning(set_name)]


def test_the_stratified_set_keeps_its_behaviour_paths() -> None:
    strata = load_case_strata(_dataset_path("agent_eval_v3"))
    assert strata.by_case["A1_ja_001"] == "exact_db_api_ok"
    assert strata.warnings == []


def test_a_row_missing_its_path_is_refused_when_others_have_one() -> None:
    with pytest.raises(MalformedEvalDataset, match='row 1 has no string "path"'):
        case_strata_from_text('[{"id": "a", "path": "p"}, {"id": "b"}]', "set")


def test_a_row_missing_its_id_is_refused() -> None:
    with pytest.raises(MalformedEvalDataset, match='row 1 has no string "id"'):
        case_strata_from_text('[{"id": "a"}, {}]', "set")


def test_a_dataset_that_is_not_a_list_is_refused() -> None:
    with pytest.raises(MalformedEvalDataset, match="must be a list of rows"):
        case_strata_from_text('{"id": "a"}', "set")


def test_a_dataset_that_is_not_json_is_refused_by_name() -> None:
    """A bare ``JSONDecodeError`` names no set and matches nothing TS says."""
    with pytest.raises(MalformedEvalDataset, match="^set: invalid JSON$"):
        case_strata_from_text('[{"id": "a", "path": "p"},', "set")


async def test_a_malformed_set_refuses_before_a_single_case_runs(
    tmp_path: Path,
) -> None:
    """#1478: the refusal must land before the run spends anything."""
    path = tmp_path / "broken.json"
    path.write_text('[{"id": "a", "path": "p"}, {"path": "q"}]')
    taken: list[str] = []

    async def evaluate() -> str:
        taken.append("turns")
        return "turns taken"

    with pytest.raises(MalformedEvalDataset, match='row 1 has no string "id"'):
        await evaluate_after_strata(path, evaluate)
    assert taken == []


def test_a_pooled_preflight_logs_what_the_interval_lost(
    pooled_dataset: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """A returned-but-never-said warning is a pooled interval nobody sees."""
    with caplog.at_level(
        logging.WARNING, logger="animichi.tests.eval.strata_first_run"
    ):
        preflight_strata(pooled_dataset)
    assert caplog.messages == [pooled_stratum_warning("pooled_set")]


def test_a_stratified_preflight_says_nothing(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(
        logging.WARNING, logger="animichi.tests.eval.strata_first_run"
    ):
        preflight_strata(_dataset_path("agent_eval_v3"))
    assert caplog.messages == []


async def test_a_pooled_set_still_runs_carrying_its_warning(
    pooled_dataset: Path,
) -> None:
    strata, report = await evaluate_after_strata(pooled_dataset, _one_turn)
    assert strata.warnings == [pooled_stratum_warning("pooled_set")]
    assert report == "turns taken"


async def _one_turn() -> str:
    return "turns taken"


def test_a_pooled_run_writes_its_warning_into_the_saved_result(
    finished_run: Callable[[CaseStrata], object],
) -> None:
    """The log is not the artifact: the result file is what is read later."""
    warning = pooled_stratum_warning("pooled_set")

    saved = finished_run(CaseStrata({}, [warning]))

    assert saved == {"warnings": [warning]}


def test_a_stratified_run_saves_no_warning(
    finished_run: Callable[[CaseStrata], object],
) -> None:
    saved = finished_run(CaseStrata({"a": "p"}, []))

    assert saved == {"warnings": []}


@pytest.fixture
def finished_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Callable[[CaseStrata], object]:
    """Run one capped report to its end and hand back the result file's warnings."""
    monkeypatch.delenv("EVAL_SMOKE", raising=False)
    monkeypatch.setattr(eval_gate_flow, "RESULTS_DIR", tmp_path / "results")
    monkeypatch.setattr(eval_gate_flow, "CASES", [])
    monkeypatch.setattr(eval_gate_flow, "DATASET_NAME", "pooled_set")
    monkeypatch.setattr(eval_gate_flow, "CAPPED", True)
    target = EvalTierTarget(object(), object, "agent_fixture", "trajectory", "fixture")

    def finish(strata: CaseStrata) -> object:
        empty = EvaluationReport(name="pooled", cases=[], failures=[])
        finish_cli_report(empty, target, "fixture:model", strata)
        saved = (tmp_path / "results" / "agent_fixture_fixture-model.json").read_text()
        return {"warnings": json.loads(saved)["warnings"]}

    return finish
