"""Which finished run may become the floor every later run is judged against.

``_run_uncapped_gate`` writes a NEW baseline whenever it finds none and nothing
failed, which is the only way the file is ever created. That made a starved run
a candidate: under ``provider_outage.BASELINE_LANE_CEILING`` a run is judgeable
— few enough boundary answers to trust what the rest measured — but a record
minted from it carries those cases' seven green columns as the standing floor,
and every later run is then compared against an outage (#1499).

Judging a run and minting from one are therefore different questions, and this
module answers the second: ANY starved case refuses the write. There is no share
to argue about, because there is no hurry — a refused mint costs one ungated
run, and the next clean uncapped run mints the record instead. The refusal is
returned as a gate failure rather than raised: the run reached the end, produced
numbers, and is red for a reason worth printing next to the others.

The TS side has the rule too since #1515. Its ``eval:gate`` still never writes
the record it is judged by (``gate-exit-code.ts:10``); a separate command mints
from the committed result file, and ``baseline-capture.ts`` refuses on any
starved case with this sentence, word for word. Nothing in ``stats-oracle.json``
pins either copy — there is no baseline-mint section, because until that card
only this module could write a record — so the two are kept in step by hand, as
the outage gate's blamed string is.
"""

from __future__ import annotations

from pathlib import Path

from animichi.tests.eval.baseline_record import BaselineRecord
from animichi.tests.eval.evaluators import EVALUATOR_VERSION
from animichi.tests.eval.gate import write_baseline_record
from animichi.tests.eval.gate_input import GateInput


def mint_baseline(
    gate_input: GateInput, *, layer: str, baselines_dir: Path
) -> list[str] | None:
    """``None`` once the record is on disk; the refusal when it is not."""
    refusal = baseline_mint_refusal(len(gate_input.starved), gate_input.evaluated_count)
    if refusal is not None:
        return [refusal]
    write_baseline_record(
        new_baseline(gate_input),
        layer=layer,
        model_id=gate_input.model,
        baselines_dir=baselines_dir,
    )
    return None


def new_baseline(gate_input: GateInput) -> BaselineRecord:
    """This run, in the shape every later run is compared against."""
    return BaselineRecord(
        model=gate_input.model,
        dataset=gate_input.dataset,
        tier=gate_input.tier,
        evaluator_version=EVALUATOR_VERSION,
        case_count=gate_input.case_count,
        evaluated_count=gate_input.evaluated_count,
        errored_count=gate_input.errored_count,
        scores=gate_input.scores,
        cases=gate_input.cases,
    )


def baseline_mint_refusal(starved: int, evaluated: int) -> str | None:
    """The gate's sentence when a starved run offered itself as the baseline."""
    if starved == 0:
        return None
    return (
        f"refusing to write a baseline from a run with {starved}/{evaluated} "
        "starved cases: the record would make an outage the floor every later "
        "run is judged against. Re-run the suite; a clean run mints it."
    )
