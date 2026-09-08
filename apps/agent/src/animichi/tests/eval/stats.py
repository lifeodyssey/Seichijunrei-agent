"""Deterministic statistical comparisons for eval gates."""

from __future__ import annotations

import math
import random
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import partial
from typing import Literal

Verdict = Literal["pass", "fail", "indeterminate"]


@dataclass(frozen=True)
class Interval:
    """A closed confidence interval."""

    lower: float
    upper: float


@dataclass(frozen=True)
class Comparison:
    """A three-way gate comparison with uncertainty evidence."""

    verdict: Verdict
    estimate: float
    interval: Interval
    sample_size: int
    method: str


@dataclass(frozen=True)
class PairedScore:
    """One baseline/current score pair and its behavior-family stratum."""

    baseline: float
    current: float
    stratum: str


def stratified_paired_comparison(
    pairs: Sequence[PairedScore],
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 309,
    min_effect: float = 0.01,
) -> Comparison:
    """Compare paired scores while preserving behavior-family proportions."""
    deltas = _stratified_deltas(pairs)
    samples = _bootstrap_samples(deltas, iterations, seed)
    interval = _sample_interval(samples, confidence)
    estimate = _mean([pair.baseline - pair.current for pair in pairs])
    return Comparison(
        _paired_verdict(interval, min_effect),
        estimate,
        interval,
        len(pairs),
        "stratified-paired-bootstrap",
    )


def clopper_pearson_interval(
    events: int, total: int, *, confidence: float = 0.95
) -> Interval:
    """Return the exact binomial interval by inverting binomial tails."""
    _validate_proportion(events, total, confidence)
    alpha = (1.0 - confidence) / 2.0
    lower = 0.0 if events == 0 else _lower_bound(events, total, alpha)
    upper = 1.0 if events == total else _upper_bound(events, total, alpha)
    return Interval(lower, upper)


def proportion_comparison(
    current_events: int,
    current_total: int,
    baseline_events: int,
    baseline_total: int,
    *,
    confidence: float = 0.95,
    min_effect: float = 0.02,
) -> Comparison:
    """Compare harmful-event rates using exact small-sample intervals."""
    current = clopper_pearson_interval(
        current_events, current_total, confidence=confidence
    )
    baseline = clopper_pearson_interval(
        baseline_events, baseline_total, confidence=confidence
    )
    estimate = current_events / current_total - baseline_events / baseline_total
    interval = Interval(current.lower - baseline.upper, current.upper - baseline.lower)
    verdict = _proportion_verdict(estimate, interval, min_effect)
    return Comparison(verdict, estimate, interval, current_total, "clopper-pearson")


def _stratified_deltas(pairs: Sequence[PairedScore]) -> list[list[float]]:
    grouped: defaultdict[str, list[float]] = defaultdict(list)
    for pair in pairs:
        grouped[pair.stratum].append(pair.baseline - pair.current)
    return [grouped[name] for name in sorted(grouped)]


def _bootstrap_samples(
    strata: list[list[float]], iterations: int, seed: int
) -> list[float]:
    rng = random.Random(seed)
    count = max(iterations, 1)
    return sorted(_stratified_mean(strata, rng) for _ in range(count))


def _stratified_mean(strata: list[list[float]], rng: random.Random) -> float:
    sampled = [_resample(group, rng) for group in strata]
    return sum(map(sum, sampled)) / sum(map(len, sampled))


def _resample(values: list[float], rng: random.Random) -> list[float]:
    return [rng.choice(values) for _ in values]


def _sample_interval(samples: list[float], confidence: float) -> Interval:
    tail = (1.0 - confidence) / 2.0
    return Interval(_percentile(samples, tail), _percentile(samples, 1.0 - tail))


def _percentile(values: list[float], quantile: float) -> float:
    return values[int(quantile * (len(values) - 1))]


def _paired_verdict(interval: Interval, min_effect: float) -> Verdict:
    if interval.lower > min_effect:
        return "fail"
    if interval.upper <= min_effect:
        return "pass"
    return "indeterminate"


def _proportion_verdict(
    estimate: float, interval: Interval, min_effect: float
) -> Verdict:
    if estimate <= min_effect:
        return "pass"
    if interval.lower > min_effect:
        return "fail"
    return "indeterminate"


def _validate_proportion(events: int, total: int, confidence: float) -> None:
    if total <= 0:
        raise ValueError("total must be positive")
    if events < 0 or events > total:
        raise ValueError("events must be between zero and total")
    if confidence <= 0.0 or confidence >= 1.0:
        raise ValueError("confidence must be between zero and one")


def _lower_bound(events: int, total: int, alpha: float) -> float:
    return _bisect_probability(
        partial(_binomial_tail, events, total), alpha, is_increasing=True
    )


def _upper_bound(events: int, total: int, alpha: float) -> float:
    return _bisect_probability(
        partial(_binomial_cdf, events, total), alpha, is_increasing=False
    )


def _bisect_probability(
    probability: Callable[[float], float], target: float, *, is_increasing: bool
) -> float:
    lower, upper = 0.0, 1.0
    for _ in range(60):
        midpoint = (lower + upper) / 2.0
        lower, upper = _bisect_step(
            lower, upper, midpoint, probability(midpoint), target, is_increasing
        )
    return (lower + upper) / 2.0


def _bisect_step(
    lower: float,
    upper: float,
    midpoint: float,
    value: float,
    target: float,
    is_increasing: bool,
) -> tuple[float, float]:
    if (value < target) == is_increasing:
        return midpoint, upper
    return lower, midpoint


def _binomial_cdf(events: int, total: int, probability: float) -> float:
    return math.fsum(
        _binomial_mass(value, total, probability) for value in range(events + 1)
    )


def _binomial_tail(events: int, total: int, probability: float) -> float:
    return math.fsum(
        _binomial_mass(value, total, probability) for value in range(events, total + 1)
    )


def _binomial_mass(events: int, total: int, probability: float) -> float:
    return (
        math.comb(total, events)
        * probability**events
        * (1.0 - probability) ** (total - events)
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)
