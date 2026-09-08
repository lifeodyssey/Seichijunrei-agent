"""A starved run never becomes the floor every later run is judged against.

``_run_uncapped_gate`` creates the baseline whenever it finds none and nothing
failed — the only way the file is ever written. Under
``provider_outage.BASELINE_LANE_CEILING`` a run with a few boundary answers is
still judgeable, and minting from it would carry those cases' green columns into
the record every later run is compared against (#1499).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from animichi.tests.eval import eval_gate_flow
from animichi.tests.eval.baseline_mint import baseline_mint_refusal, new_baseline
from animichi.tests.eval.eval_gate_flow import _run_gate
from animichi.tests.eval.gate import baseline_path, write_baseline_record
from animichi.tests.eval.gate_input import GateInput

_MODEL = "fixture"
_LAYER = "agent"
_METRIC = "metric"
_CASE_COUNT = 10


@pytest.fixture(autouse=True)
def smoke_flag_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_run_gate` refuses EVAL_SMOKE=1 on the uncapped path before anything."""
    monkeypatch.delenv("EVAL_SMOKE", raising=False)
    monkeypatch.setattr(eval_gate_flow, "METRIC_NAMES", [_METRIC])


def make_gate_input(starved: frozenset[str] = frozenset()) -> GateInput:
    return GateInput(
        model=_MODEL,
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=_CASE_COUNT,
        evaluated_count=_CASE_COUNT,
        scores={_METRIC: 1.0},
        cases={f"case-{index}": {_METRIC: 1.0} for index in range(_CASE_COUNT)},
        starved=starved,
    )


def test_a_starved_run_is_refused_the_baseline_by_name(tmp_path: Path) -> None:
    failures = _run_gate(
        make_gate_input(frozenset({"case-0"})), _LAYER, tmp_path, is_capped=False
    )

    assert failures == [baseline_mint_refusal(1, _CASE_COUNT)]
    assert "1/10 starved cases" in failures[0]
    assert not baseline_path(_LAYER, _MODEL, tmp_path).exists()


def test_a_clean_run_still_mints_the_baseline(tmp_path: Path) -> None:
    """The control: drop the refusal and the case above finds a file on disk."""
    assert _run_gate(make_gate_input(), _LAYER, tmp_path, is_capped=False) is None
    assert baseline_path(_LAYER, _MODEL, tmp_path).exists()


def test_a_starved_run_leaves_an_established_baseline_as_it_found_it(
    tmp_path: Path,
) -> None:
    path = write_baseline_record(
        new_baseline(make_gate_input()),
        layer=_LAYER,
        model_id=_MODEL,
        baselines_dir=tmp_path,
    )
    established = path.read_text()

    failures = _run_gate(
        make_gate_input(frozenset({"case-0"})), _LAYER, tmp_path, is_capped=False
    )

    assert failures == []
    assert path.read_text() == established
