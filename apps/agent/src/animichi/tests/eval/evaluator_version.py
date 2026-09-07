"""The name of the vocabulary the evaluators score in.

Its own module so that reading it costs nothing: `gate.py` compares a baseline
record against it on every read, and importing `evaluators.py` for one string
would drag pydantic_ai, pydantic_evals and `animichi.agents` behind it — a
thousand modules the baseline reader and the oracle exporter have no use for.
`evaluators.py` re-exports it, so every existing importer keeps working.

`packages/eval/src/evaluators/agent-evaluator.ts` carries the same string. Bump
both sides together or the two runners' baselines stop being comparable — and
each runner then refuses the other's record rather than comparing across them
(`gate.py::_scored_by_another_evaluator`, `baseline-store.ts`, #1303).
"""

from __future__ import annotations

EVALUATOR_VERSION = "official-v2"
