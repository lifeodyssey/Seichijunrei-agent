"""Unified agent evaluation — PydanticAI native dataset.evaluate().

SUT: run_pilgrimage_agent() → AgentResult (+ execute_selected_route for K-path)
Dataset: agent_eval_v3.json (~600 cases, 60 sub-paths)
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
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from backend.agents.agent_result import AgentResult
from backend.interfaces.public_api import detect_language
from backend.tests.eval.eval_common import (
    enforce_gate,
    read_baseline,
    write_baseline,
)

load_dotenv(Path(__file__).parents[3] / ".env")

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL_ID = "openai:deepseek-v4-pro@https://api.deepseek.com"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL_ID)


def _make_model(model_id: str | None = None) -> object:
    from backend.agents.base import parse_model_spec

    return parse_model_spec(model_id or _EVAL_MODEL_ID, use_settings_fallbacks=False)


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class AgentInput:
    query: str
    locale: str
    context: dict[str, object] | None = None
    selected_point_ids: list[str] | None = None


@dataclass
class AgentExpected:
    acceptable_stages: list[str]
    data_keys: list[str] = field(default_factory=list)
    message_min_len: int = 2


# ── Evaluators ───────────────────────────────────────────────────────


class IntentMatch(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent intent is in the list of acceptable stages."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        return (
            1.0 if ctx.output.intent in ctx.expected_output.acceptable_stages else 0.0
        )


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

    _NO_TOOL_STAGES = frozenset({"greet_user", "general_qa", "plan_selected"})

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None:
            return 0.0
        if ctx.expected_output and self._NO_TOOL_STAGES.intersection(
            ctx.expected_output.acceptable_stages
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

    _EXPECTED_STEPS: dict[str, int] = {
        "greet_user": 1,
        "general_qa": 1,
        "clarify": 1,
        "search_bangumi": 2,
        "search_nearby": 1,
        "plan_route": 3,
        "plan_selected": 1,
    }

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or ctx.expected_output is None:
            return 0.0
        step_count = len(ctx.output.steps)
        primary = (
            ctx.expected_output.acceptable_stages[0]
            if ctx.expected_output.acceptable_stages
            else "clarify"
        )
        target = self._EXPECTED_STEPS.get(primary, 2)
        diff = abs(step_count - target)
        if diff <= 1:
            return 1.0
        return 0.5 if diff <= 3 else 0.0


class ResponseLocale(Evaluator[AgentInput, AgentResult]):
    """1.0 if agent message language matches the requested locale."""

    def evaluate(self, ctx: EvaluatorContext[AgentInput, AgentResult]) -> float:
        if ctx.output is None or not ctx.output.message:
            return 0.0
        detected = detect_language(ctx.output.message)
        return 1.0 if detected == ctx.inputs.locale else 0.0


# ── Load dataset ─────────────────────────────────────────────────────

_DATASET_PATH = Path(__file__).parent / "datasets" / "agent_eval_v3.json"


def _str_list(row: dict[str, object], key: str) -> list[str]:
    raw = row.get(key)
    return [str(k) for k in raw] if isinstance(raw, list) else []


def _load_cases() -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw: list[dict[str, object]] = json.loads(_DATASET_PATH.read_text())
    cases: list[Case[AgentInput, AgentResult, AgentExpected]] = []
    for row in raw:
        raw_ctx = row.get("context")
        ctx = dict(raw_ctx) if isinstance(raw_ctx, dict) else None
        raw_ids = row.get("selected_point_ids")
        sel_ids = [str(i) for i in raw_ids] if isinstance(raw_ids, list) else None
        cases.append(
            Case(
                name=str(row["id"]),
                inputs=AgentInput(
                    query=str(row.get("query", "")),
                    locale=str(row.get("locale", "ja")),
                    context=ctx,
                    selected_point_ids=sel_ids,
                ),
                expected_output=AgentExpected(
                    acceptable_stages=_str_list(row, "acceptable_stages"),
                    data_keys=_str_list(row, "expected_data_keys"),
                    message_min_len=int(row.get("expected_message_min_len", 2) or 2),
                ),
            )
        )
    return cases


CASES = _load_cases()

agent_dataset = Dataset(
    name="agent_eval_v3",
    cases=CASES,
    evaluators=[
        IntentMatch(),
        MessageQuality(),
        ToolExecution(),
        DataCompleteness(),
        StepEfficiency(),
        ResponseLocale(),
    ],
)


# ── Task function ────────────────────────────────────────────────────


def make_agent_task(db: object, model: object | None = None) -> object:
    """Create the task: AgentInput → AgentResult. Handles both agent and selected-route."""
    resolved_model = model or _make_model()

    async def task(inp: AgentInput) -> AgentResult:
        if inp.selected_point_ids:
            from backend.agents.selected_route import execute_selected_route

            return await execute_selected_route(
                point_ids=inp.selected_point_ids,
                origin=None,
                locale=inp.locale,
                db=db,
            )
        from backend.agents.pilgrimage_runner import run_pilgrimage_agent

        return await run_pilgrimage_agent(
            text=inp.query,
            db=db,
            model=resolved_model,
            locale=inp.locale,
            context=inp.context,
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
    "ResponseLocale",
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


def _save_per_case_results(report: object, model_id: str) -> Path:
    """Save per-case results JSON for post-hoc analysis."""
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(exist_ok=True)
    safe_model = model_id.replace(":", "-").replace("@", "-").replace("/", "-")
    results_file = results_dir / f"agent_{safe_model}.json"

    case_results: list[dict[str, object]] = []
    for cr in report.cases:
        case_data: dict[str, object] = {"id": cr.name}
        scores_dict = dict(cr.scores) if cr.scores else {}
        case_data["scores"] = {
            k: v.value if hasattr(v, "value") else v for k, v in scores_dict.items()
        }
        if hasattr(cr, "task_error") and cr.task_error:
            case_data["error"] = str(cr.task_error)
        if cr.output is not None and isinstance(cr.output, AgentResult):
            case_data["intent"] = cr.output.intent
            case_data["message"] = cr.output.message[:200]
            case_data["message_locale"] = detect_language(cr.output.message)
            case_data["steps"] = [s.tool for s in cr.output.steps]
            case_data["step_count"] = len(cr.output.steps)
        if cr.inputs:
            case_data["query"] = cr.inputs.query[:100]
            case_data["locale"] = cr.inputs.locale
        if cr.expected_output:
            case_data["expected_stages"] = cr.expected_output.acceptable_stages
        case_results.append(case_data)

    avg = report.averages()
    scores = _collect_scores(avg) if avg else {}
    errored = len(report.failures)

    payload = {
        "model": model_id,
        "case_count": len(CASES),
        "evaluated_count": len(report.cases),
        "errored_count": errored,
        "scores": scores,
        "cases": case_results,
    }
    results_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"\nPer-case results saved to: {results_file}")
    return results_file


# ── Pytest integration ───────────────────────────────────────────────


@pytest.mark.integration
async def test_agent(real_db: object) -> None:
    """Run the unified agent assessment against real testcontainer DB."""
    from tenacity import stop_after_attempt, wait_exponential

    task = make_agent_task(db=real_db)
    report = await agent_dataset.evaluate(
        task,
        name=f"agent_{_EVAL_MODEL_ID}",
        max_concurrency=10,
        retry_task={
            "stop": stop_after_attempt(2),
            "wait": wait_exponential(min=1, max=5),
        },
    )
    report.print(include_input=True, include_output=True)
    _save_per_case_results(report, _EVAL_MODEL_ID)

    avg = report.averages()
    if avg is None:
        pytest.skip("All cases errored — check model endpoint and DB.")

    # Guard: refuse to proceed if >20% of cases errored (API down, bad key, etc.)
    total = len(report.cases) + len(report.failures)
    errored = len(report.failures)
    error_rate = errored / total if total > 0 else 1.0
    if error_rate > 0.20:
        pytest.fail(
            f"{errored}/{total} cases errored ({error_rate:.0%}). "
            "Check API key and model endpoint."
        )

    current_scores = _collect_scores(avg)
    _print_scores(current_scores, _EVAL_MODEL_ID)

    baseline_scores = read_baseline(
        _LAYER, _EVAL_MODEL_ID, expected_case_count=len(CASES)
    )
    if not baseline_scores:
        write_baseline(
            _LAYER,
            _EVAL_MODEL_ID,
            current_scores,
            case_count=len(CASES),
            evaluated_count=len(report.cases),
        )
        pytest.skip(f"Baseline created for {_EVAL_MODEL_ID}; re-run to enforce gate.")

    failures = enforce_gate(current_scores, baseline_scores)
    assert not failures, "Regression:\n" + "\n".join(failures)


# ── Standalone runner ────────────────────────────────────────────────

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

        db_url = os.environ.get(
            "SUPABASE_DB_URL",
            "postgresql://postgres:postgres@localhost:54322/postgres",
        )
        from backend.infrastructure.supabase.client import SupabaseClient

        db = SupabaseClient(db_url)
        await db.connect()

        task = make_agent_task(db=db, model=model)
        print(f"\nRunning agent assessment: {len(CASES)} cases, model={mid}")
        print(f"DB: {db_url[:50]}...")

        from tenacity import stop_after_attempt, wait_exponential

        report = await agent_dataset.evaluate(
            task,
            name=f"agent_{mid}",
            max_concurrency=10,
            retry_task={
                "stop": stop_after_attempt(2),
                "wait": wait_exponential(min=1, max=5),
            },
        )
        report.print(include_input=True, include_output=True)

        avg = report.averages()
        if avg is None:
            raise SystemExit("All cases errored — check model endpoint and DB.")

        current_scores = _collect_scores(avg)
        _print_scores(current_scores, mid)
        _save_per_case_results(report, mid)

        baseline_scores = read_baseline(_LAYER, mid)
        if not baseline_scores:
            write_baseline(
                _LAYER,
                mid,
                current_scores,
                case_count=len(CASES),
                evaluated_count=len(report.cases),
            )
            print("Baseline created. Re-run to enforce gate.")
            return

        failures = enforce_gate(current_scores, baseline_scores)
        if failures:
            raise SystemExit("Regression:\n" + "\n".join(failures))
        print("All gates passed.")

    asyncio.run(main())
