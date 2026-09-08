"""The Python numbers the TypeScript gate port is pinned against.

``packages/eval/src/gate/`` re-implements ``stats.py`` and ``gate.py`` for the
Node runner. A TS test that only checks its own arithmetic proves nothing about
parity, so this module writes the reference outputs — Mersenne Twister draws,
bootstrap intervals, exact binomial bounds, gate failures and the warnings the
gate logs — into a JSON fixture the TS tests assert against.

This module owns the ``stats.py`` half and the file itself; ``gate_oracle.py``
owns the baseline, gate and staleness half, and ``strata_oracle.py`` owns what
``load_case_strata`` answers for a dataset with or without a ``path`` column.

The numbers depend on the interpreter: CPython 3.12 gave the builtin ``sum()``
Neumaier's correction (gh-100425), and ``stats.py`` means every bootstrap sample
with it. ``apps/agent`` ships on ``python:3.11.13-slim`` and CI pins 3.11, so the
oracle is defined against 3.11 and refuses to be written by anything else.

Usage: ``uv run python -m animichi.tests.eval.stats_oracle <output.json>``
Consumer: ``packages/eval/fixtures/stats-oracle.json``.
"""

from __future__ import annotations

import json
import random
import sys
from collections.abc import Sequence
from pathlib import Path

from animichi.tests.eval.baseline_oracle import baseline_sections
from animichi.tests.eval.gate_oracle import ORACLE_ITERATIONS, gate_sections
from animichi.tests.eval.stats import (
    Comparison,
    PairedScore,
    clopper_pearson_interval,
    proportion_comparison,
    stratified_paired_comparison,
)
from animichi.tests.eval.strata_oracle import strata_sections

#: The interpreter the oracle is defined against — the one apps/agent ships on.
ORACLE_PYTHON = (3, 11)
ITERATIONS = ORACLE_ITERATIONS
SEED = 309
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


def _interval_json(result: Comparison) -> dict[str, float]:
    return {"lower": result.interval.lower, "upper": result.interval.upper}


def _comparison_json(result: Comparison) -> dict[str, object]:
    return {
        "verdict": result.verdict,
        "estimate": result.estimate,
        "interval": _interval_json(result),
        "sample_size": result.sample_size,
        "method": result.method,
    }


def _pair_json(pair: PairedScore) -> dict[str, object]:
    return {
        "baseline": pair.baseline,
        "current": pair.current,
        "stratum": pair.stratum,
    }


def _alternating_pairs(deltas: Sequence[float]) -> list[PairedScore]:
    """``test_stats.py``'s ``_pairs``: two strata, assigned round-robin."""
    return [
        PairedScore(delta, 0.0, f"path-{index % 2}")
        for index, delta in enumerate(deltas)
    ]


def _rare_regression_pairs() -> list[PairedScore]:
    """Every regression sits in a two-case stratum.

    Stratified resampling keeps that stratum at a tenth of the weight, so the
    interval collapses onto the true 0.1; pooling the deltas lets it wander to
    zero. It is the fixture the "ignore strata" mutation dies on.
    """
    rare = [PairedScore(1.0, 0.0, "rare") for _ in range(2)]
    return rare + [PairedScore(0.0, 0.0, "common") for _ in range(18)]


def _graded_pairs() -> list[PairedScore]:
    """Twenty distinct deltas, so every bootstrap percentile is an arbitrary
    real: a resampling order that differs from Python's moves the interval."""
    return [PairedScore(index / 20.0, 0.0, f"path-{index % 3}") for index in range(20)]


def _paired_case(name: str, pairs: Sequence[PairedScore]) -> dict[str, object]:
    result = stratified_paired_comparison(pairs, iterations=ITERATIONS)
    return {
        "name": name,
        "pairs": [_pair_json(pair) for pair in pairs],
        "iterations": ITERATIONS,
        "confidence": 0.95,
        "seed": SEED,
        "min_effect": 0.01,
        "comparison": _comparison_json(result),
    }


def _paired_cases() -> list[dict[str, object]]:
    overlap = [1.0] * 10 + [-1.0] * 10
    return [
        _paired_case("clear_regression", _alternating_pairs([1.0] * 20)),
        _paired_case("clear_improvement", _alternating_pairs([-1.0] * 20)),
        _paired_case("no_change", _alternating_pairs([0.0] * 20)),
        _paired_case("overlap", _alternating_pairs(overlap)),
        _paired_case("rare_stratum_regression", _rare_regression_pairs()),
        _paired_case("graded", _graded_pairs()),
    ]


def _random_stream() -> dict[str, object]:
    """``random.Random(309)`` drives every bootstrap draw; pin its raw output."""
    bits = random.Random(SEED)
    five, two, one = random.Random(SEED), random.Random(SEED), random.Random(SEED)
    letters = ["a", "b", "c", "d", "e"]
    return {
        "seed": SEED,
        "getrandbits_32": [bits.getrandbits(32) for _ in range(8)],
        "choice_of_five": [five.choice(letters) for _ in range(16)],
        "choice_of_two": [two.choice(["a", "b"]) for _ in range(16)],
        "choice_of_one": [one.choice(["a"]) for _ in range(4)],
    }


def _clopper_pearson_cases() -> list[dict[str, object]]:
    counts = [(1, 10), (0, 10), (10, 10), (20, 50), (0, 50), (4, 20), (2, 20)]
    return [_clopper_pearson_case(events, total) for events, total in counts]


def _clopper_pearson_case(events: int, total: int) -> dict[str, object]:
    interval = clopper_pearson_interval(events, total)
    return {
        "events": events,
        "total": total,
        "confidence": 0.95,
        "interval": {"lower": interval.lower, "upper": interval.upper},
    }


def _proportion_cases() -> list[dict[str, object]]:
    counts = [(20, 50, 0, 50), (2, 20, 4, 20), (4, 20, 2, 20), (5, 100, 4, 100)]
    return [_proportion_case(*count) for count in counts]


def _proportion_case(
    current_events: int, current_total: int, base_events: int, base_total: int
) -> dict[str, object]:
    result = proportion_comparison(
        current_events, current_total, base_events, base_total
    )
    return {
        "current_events": current_events,
        "current_total": current_total,
        "baseline_events": base_events,
        "baseline_total": base_total,
        "confidence": 0.95,
        "min_effect": 0.02,
        "comparison": _comparison_json(result),
    }


def _number_text() -> dict[str, object]:
    """The three float renderings the gate emits: ``.4f``, ``.0%`` and ``repr``."""
    return {
        "fixed_4": [{"value": v, "text": f"{v:.4f}"} for v in FIXED_VALUES],
        "percent_0": [{"value": v, "text": f"{v:.0%}"} for v in PERCENT_VALUES],
        "repr": [{"value": v, "text": repr(v)} for v in REPR_VALUES],
    }


def build_oracle() -> dict[str, object]:
    """Every reference value the TS port is asserted against."""
    return {
        "number_text": _number_text(),
        "random_stream": _random_stream(),
        "paired_comparisons": _paired_cases(),
        "clopper_pearson_intervals": _clopper_pearson_cases(),
        "proportion_comparisons": _proportion_cases(),
        **gate_sections(),
        **baseline_sections(),
        **strata_sections(),
    }


def _require_pinned_interpreter() -> None:
    """Refuse to write numbers a different CPython would not reproduce."""
    running = sys.version_info[:2]
    if running == ORACLE_PYTHON:
        return
    raise RuntimeError(_wrong_interpreter(running))


def _wrong_interpreter(running: tuple[int, int]) -> str:
    pinned = f"{ORACLE_PYTHON[0]}.{ORACLE_PYTHON[1]}"
    return (
        f"stats-oracle.json is defined against Python {pinned}, the interpreter "
        f"apps/agent ships on; this is {running[0]}.{running[1]}, whose builtin "
        "sum() rounds differently (Neumaier since 3.12). Re-run with: "
        f"uv run --python {pinned} python -m animichi.tests.eval.stats_oracle <path>"
    )


def write_stats_oracle(path: Path) -> Path:
    _require_pinned_interpreter()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(build_oracle(), indent=2, ensure_ascii=False) + "\n")
    return path


if __name__ == "__main__":
    print(write_stats_oracle(Path(sys.argv[1])))
