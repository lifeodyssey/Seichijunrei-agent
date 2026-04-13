"""Shared eval infrastructure for all eval layers.

Provides dataset loading, baseline management, gate enforcement,
and model precheck utilities.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

CASE_TIMEOUT_S = 60

_DEFAULT_BASELINES_DIR = Path(__file__).parent / "baselines"


@dataclass
class EvalCase:
    """A single eval case loaded from a dataset JSON file."""

    id: str
    query: str
    locale: str
    expected_steps: list[str]
    expected_intent: str


def load_dataset(path: Path) -> list[EvalCase]:
    """Load a dataset JSON file and return typed EvalCase objects.

    Raises FileNotFoundError when the file does not exist.
    """
    text = path.read_text()
    rows: list[dict[str, object]] = json.loads(text)
    cases: list[EvalCase] = []
    for row in rows:
        raw_steps = row["expected_steps"]
        steps = list(raw_steps) if isinstance(raw_steps, list) else []
        cases.append(
            EvalCase(
                id=str(row["id"]),
                query=str(row["query"]),
                locale=str(row["locale"]),
                expected_steps=steps,
                expected_intent=str(row["expected_intent"]),
            )
        )
    return cases


def _baseline_filename(layer: str, model_id: str) -> str:
    safe_model = model_id.replace(":", "-").replace("@", "-").replace("/", "-")
    return f"{layer}_{safe_model}.json"


def read_baseline(
    layer: str,
    model_id: str,
    *,
    baselines_dir: Path = _DEFAULT_BASELINES_DIR,
    expected_case_count: int | None = None,
) -> dict[str, float]:
    """Read baseline scores from a JSON file.

    Returns empty dict when the file is missing or case_count is stale.
    """
    path = baselines_dir / _baseline_filename(layer, model_id)
    if not path.exists():
        return {}
    data: dict[str, object] = json.loads(path.read_text())
    if expected_case_count is not None:
        stored_count = data.get("case_count")
        if stored_count is not None and stored_count != expected_case_count:
            return {}
    scores = data.get("scores")
    if isinstance(scores, dict):
        return {str(k): float(v) for k, v in scores.items()}
    return {}


def write_baseline(
    layer: str,
    model_id: str,
    scores: dict[str, float],
    *,
    case_count: int,
    baselines_dir: Path = _DEFAULT_BASELINES_DIR,
) -> None:
    """Write baseline scores to a JSON file."""
    baselines_dir.mkdir(parents=True, exist_ok=True)
    path = baselines_dir / _baseline_filename(layer, model_id)
    payload = {
        "model": model_id,
        "case_count": case_count,
        "scores": scores,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def enforce_gate(
    current: dict[str, float],
    baseline: dict[str, float],
    tolerance: float = 0.10,
) -> list[str]:
    """Compare current scores against baseline. Return failure descriptions.

    Returns an empty list when all scores pass (within tolerance of baseline).
    """
    if not baseline:
        return []
    failures: list[str] = []
    for name, score in current.items():
        baseline_score = baseline.get(name)
        if baseline_score is None:
            continue
        minimum = baseline_score - tolerance
        if score < minimum:
            failures.append(
                f"{name}: {score:.1%} < baseline-{tolerance:.0%} "
                f"({minimum:.1%}, baseline {baseline_score:.1%})"
            )
    return failures


async def precheck_model(model_id: str) -> None:
    """Verify that the model endpoint is reachable.

    Raises RuntimeError when the model cannot be reached.
    """
    from backend.agents.base import parse_model_spec

    model = parse_model_spec(model_id, use_settings_fallbacks=False)
    if model is None:
        raise RuntimeError(f"Cannot build model for {model_id}")
