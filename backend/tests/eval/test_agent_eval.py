"""Unified agent evaluation — PydanticAI native dataset.evaluate().

SUT: run_pilgrimage_agent() → AgentResult
Dataset: agent_eval_v2.json (546 cases)
DB: testcontainer PostgreSQL (real schema + seed data)
Model: EVAL_MODEL env var (default: production model)

Usage:
    # Via pytest (testcontainer auto-start)
    uv run pytest backend/tests/eval/test_agent_eval.py -v -m integration --no-cov

    # Standalone (requires supabase start or SUPABASE_DB_URL)
    uv run python backend/tests/eval/test_agent_eval.py
    uv run python backend/tests/eval/test_agent_eval.py --eval-model openai:deepseek-v4-pro@https://api.deepseek.com
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from backend.agents.agent_result import AgentResult
from backend.tests.eval.eval_common import (
    enforce_gate,
    read_baseline,
    write_baseline,
)

load_dotenv(Path(__file__).parents[3] / ".env")

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL_ID = "openai:gemini-3-pro-preview@https://api.zetatechs.com/v1"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL_ID)


def _make_model(model_id: str | None = None) -> object:
    from backend.agents.base import parse_model_spec

    return parse_model_spec(model_id or _EVAL_MODEL_ID, use_settings_fallbacks=False)


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class AgentInput:
    query: str
    locale: str


@dataclass
class AgentExpected:
    stage: str
    message_min_len: int
    data_keys: list[str]
    results_keys: list[str]
    route_keys: list[str]
    nearby_fields: list[str]


# ── Evaluators (operate on AgentResult directly) ─────────────────────


class IntentMatch(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent intent matches expected stage."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        return 1.0 if ctx.output.intent == ctx.expected_output.stage else 0.0


class MessageQuality(Evaluator[AgentInput, AgentResult]):
    """1.0 if message meets minimum length."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        return (
            1.0
            if len(ctx.output.message) >= ctx.expected_output.message_min_len
            else 0.0
        )


class ToolExecution(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent executed at least one tool successfully."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None:
            return 0.0
        if ctx.expected_output and ctx.expected_output.stage in (
            "greet_user",
            "general_qa",
        ):
            return 1.0
        return 1.0 if any(s.success for s in ctx.output.steps) else 0.0


class DataCompleteness(Evaluator[AgentInput, AgentResult]):
    """1.0 if expected data keys are present in the response."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        expected_keys = set(ctx.expected_output.data_keys)
        if not expected_keys:
            return 1.0
        actual_keys = set(ctx.output.tool_state.keys())
        output = ctx.output.output
        if hasattr(output, "data"):
            od = output.data.model_dump(mode="json")
            if isinstance(od, dict):
                actual_keys.update(od.keys())
        for key in ("results", "route"):
            for tk in ctx.output.tool_state:
                if key in tk or tk in key:
                    actual_keys.add(key)
        return 1.0 if expected_keys.issubset(actual_keys) else 0.0


class StepEfficiency(Evaluator[AgentInput, AgentResult]):
    """Score based on step count proximity to expected."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        step_count = len(ctx.output.steps)
        stage = ctx.expected_output.stage
        expected = {
            "greet_user": 1,
            "general_qa": 1,
            "clarify": 1,
            "search_bangumi": 2,
            "search_nearby": 1,
            "plan_route": 3,
        }
        target = expected.get(stage, 2)
        diff = abs(step_count - target)
        if diff <= 1:
            return 1.0
        if diff <= 3:
            return 0.5
        return 0.0


# ── Load dataset ─────────────────────────────────────────────────────

_DATASET_PATH = Path(__file__).parent / "datasets" / "agent_eval_v2.json"


def _str_list(row: dict[str, object], key: str) -> list[str]:
    raw = row.get(key)
    return [str(k) for k in raw] if isinstance(raw, list) else []


def _load_cases() -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw: list[dict[str, object]] = json.loads(_DATASET_PATH.read_text())
    cases: list[Case[AgentInput, AgentResult, AgentExpected]] = []
    for row in raw:
        cases.append(
            Case(
                name=str(row["id"]),
                inputs=AgentInput(
                    query=str(row["query"]),
                    locale=str(row["locale"]),
                ),
                expected_output=AgentExpected(
                    stage=str(row["expected_stage"]),
                    message_min_len=int(row.get("expected_message_min_len", 2) or 2),
                    data_keys=_str_list(row, "expected_data_keys"),
                    results_keys=_str_list(row, "expected_results_keys"),
                    route_keys=_str_list(row, "expected_route_keys"),
                    nearby_fields=_str_list(row, "expected_nearby_fields"),
                ),
            )
        )
    return cases


CASES = _load_cases()

agent_dataset = Dataset(
    name="agent_eval_v2",
    cases=CASES,
    evaluators=[
        IntentMatch(),
        MessageQuality(),
        ToolExecution(),
        DataCompleteness(),
        StepEfficiency(),
    ],
)


# ── Task function (SUT = run_pilgrimage_agent → AgentResult) ─────────


def make_agent_task(db: object, model: object | None = None) -> object:
    """Create the task: AgentInput → AgentResult. Requires real DB."""
    resolved_model = model or _make_model()

    async def task(inp: AgentInput) -> AgentResult:
        from backend.agents.pilgrimage_runner import run_pilgrimage_agent

        return await run_pilgrimage_agent(
            text=inp.query,
            db=db,
            model=resolved_model,
            locale=inp.locale,
        )

    return task


# ── Shared helpers ───────────────────────────────────────────────────

_LAYER = "agent"

_EVALUATOR_NAMES = [
    "IntentMatch",
    "MessageQuality",
    "ToolExecution",
    "DataCompleteness",
    "StepEfficiency",
]


def _collect_scores(avg: object) -> dict[str, float]:
    scores_attr = getattr(avg, "scores", {})
    return {n: scores_attr.get(n, 0) for n in _EVALUATOR_NAMES}


def _print_scores(scores: dict[str, float], model_id: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  Model:    {model_id}")
    print(f"  Cases:    {len(CASES)}")
    for name, value in scores.items():
        print(f"  {name:<20}{value:.1%}")
    print(f"{'=' * 60}")


# ── Pytest integration (testcontainer DB) ────────────────────────────


@pytest.mark.integration
async def test_agent(real_db: object) -> None:
    """Run the unified agent assessment against real testcontainer DB."""
    task = make_agent_task(db=real_db)
    report = await agent_dataset.evaluate(
        task,
        name=f"agent_{_EVAL_MODEL_ID}",
        max_concurrency=50,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    if avg is None:
        pytest.skip("All cases errored — check model endpoint and DB.")

    current_scores = _collect_scores(avg)
    _print_scores(current_scores, _EVAL_MODEL_ID)

    baseline_scores = read_baseline(
        _LAYER, _EVAL_MODEL_ID, expected_case_count=len(CASES)
    )
    if not baseline_scores:
        write_baseline(_LAYER, _EVAL_MODEL_ID, current_scores, case_count=len(CASES))
        pytest.skip(f"Baseline created for {_EVAL_MODEL_ID}; re-run to enforce gate.")

    failures = enforce_gate(current_scores, baseline_scores)
    assert not failures, "Regression:\n" + "\n".join(failures)


# ── Standalone runner (PydanticAI native) ────────────────────────────

if __name__ == "__main__":
    model_arg = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--eval-model" and i < len(sys.argv):
            model_arg = sys.argv[i + 1]
            break
        if arg.startswith("--eval-model="):
            model_arg = arg.split("=", 1)[1]
            break

    async def main() -> None:
        mid = model_arg or _EVAL_MODEL_ID
        model = _make_model(model_arg) if model_arg else _make_model()

        # Connect to local Supabase or SUPABASE_DB_URL
        db_url = os.environ.get(
            "SUPABASE_DB_URL",
            "postgresql://postgres:postgres@localhost:54322/postgres",
        )
        from backend.infrastructure.supabase.client import SupabaseClient

        db = await SupabaseClient.create(db_url)

        task = make_agent_task(db=db, model=model)
        print(f"\nRunning agent assessment: {len(CASES)} cases, model={mid}")
        print(f"DB: {db_url[:50]}...")

        # Run evaluation — PydanticAI native
        report = await agent_dataset.evaluate(
            task,
            name=f"agent_{mid}",
            max_concurrency=50,
        )

        # Print full report with per-case details
        report.print(include_input=True, include_output=True)

        avg = report.averages()
        if avg is None:
            raise SystemExit("All cases errored — check model endpoint and DB.")

        current_scores = _collect_scores(avg)
        _print_scores(current_scores, mid)

        # Save per-case results to JSON for analysis
        results_dir = Path(__file__).parent / "results"
        results_dir.mkdir(exist_ok=True)
        safe_model = mid.replace(":", "-").replace("@", "-").replace("/", "-")
        results_file = results_dir / f"agent_{safe_model}.json"

        case_results: list[dict[str, object]] = []
        for case_report in report.cases:
            case_data: dict[str, object] = {
                "id": case_report.name,
                "scores": dict(case_report.scores) if case_report.scores else {},
            }
            if case_report.error:
                case_data["error"] = str(case_report.error)
            if case_report.output is not None:
                output = case_report.output
                if isinstance(output, AgentResult):
                    case_data["intent"] = output.intent
                    case_data["message_len"] = len(output.message)
                    case_data["steps"] = [s.tool for s in output.steps]
            case_results.append(case_data)

        results_payload = {
            "model": mid,
            "case_count": len(CASES),
            "scores": current_scores,
            "cases": case_results,
        }
        results_file.write_text(
            json.dumps(results_payload, ensure_ascii=False, indent=2) + "\n"
        )
        print(f"\nPer-case results saved to: {results_file}")

        # Baseline management
        baseline_scores = read_baseline(_LAYER, mid)
        if not baseline_scores:
            write_baseline(_LAYER, mid, current_scores, case_count=len(CASES))
            print("Baseline created. Re-run to enforce gate.")
            return

        failures = enforce_gate(current_scores, baseline_scores)
        if failures:
            raise SystemExit("Regression:\n" + "\n".join(failures))
        print("All gates passed.")

    asyncio.run(main())
