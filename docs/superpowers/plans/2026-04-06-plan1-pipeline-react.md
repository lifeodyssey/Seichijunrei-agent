# Plan 1: Pipeline + ReAct Loop Implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the pipeline from "plan all → execute all" to a multi-turn ReAct loop where the planner sees intermediate results and can decide the next step dynamically. Fix the registry mapping bug. Add collapsible thinking panel to the frontend.

**Architecture:** The planner currently outputs a full `ExecutionPlan` in one LLM call. We change it to output one `PlanStep` at a time, receive the executor's result as an observation, and decide the next action. The executor stays deterministic. SSE streaming already sends step events — we enrich them with thought/observation data.

**Tech Stack:** Python 3.11 / Pydantic AI / aiohttp SSE (backend), React 19 / Next.js 16 (frontend)

**Dependencies:** None — this plan can run in parallel with Plan 3 (Session) and Plan 4 (i18n).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/agents/models.py` | Modify | Add `ReactStep`, `DoneSignal`, `Observation` models |
| `backend/agents/planner_agent.py` | Modify | Change output_type to `ReactStep`, add `step()` method for multi-turn |
| `backend/agents/pipeline.py` | Rewrite | Replace `run_pipeline` with `react_loop` async generator |
| `backend/agents/executor_agent.py` | Modify | Add `format_observation()` method, keep `_execute_step` unchanged |
| `backend/interfaces/http_service.py` | Modify | Stream ReAct steps via SSE with richer data |
| `backend/interfaces/public_api.py:476-478` | Fix | `_UI_MAP["plan_route"]` → `"RoutePlannerWizard"` |
| `frontend/components/generative/registry.ts:57-58` | Fix | `intentToComponent("plan_route")` → `"RoutePlannerWizard"` |
| `frontend/components/chat/MessageBubble.tsx` | Modify | Replace `StepTrace` with `ThinkingProcess` component |
| `frontend/hooks/useChat.ts` | Modify | Handle richer step data (thought, observation) |
| `backend/tests/unit/test_pipeline_react.py` | Create | Tests for ReAct loop |
| `backend/tests/unit/test_planner_react.py` | Create | Tests for single-step planner |

---

### Task 1: Fix registry mapping bug — frontend + backend (5 min)

**Scope:** Two one-line fixes. The `plan_route` intent maps to the old `RouteVisualization` instead of `RoutePlannerWizard` in both frontend and backend.

**Files:**

- Modify: `frontend/components/generative/registry.ts:57-58`
- Modify: `backend/interfaces/public_api.py:476-478`

- [ ] **Step 1: Fix frontend registry**

In `frontend/components/generative/registry.ts`, change lines 57-58:

```typescript
// Before:
    case "plan_route":
    case "plan_selected":
      return "RouteVisualization";

// After:
    case "plan_route":
    case "plan_selected":
      return "RoutePlannerWizard";
```

- [ ] **Step 2: Fix backend UI map**

In `backend/interfaces/public_api.py`, find the `_UI_MAP` dict (~line 474-484) and change:

```python
# Before:
    "plan_route": "RouteVisualization",
    "plan_selected": "RouteVisualization",

# After:
    "plan_route": "RoutePlannerWizard",
    "plan_selected": "RoutePlannerWizard",
```

- [ ] **Step 3: Verify**

```bash
# Backend type check
make typecheck
# Frontend type check
cd frontend && npx tsc --noEmit
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/generative/registry.ts backend/interfaces/public_api.py
git commit -m "fix(registry): map plan_route to RoutePlannerWizard in frontend + backend"
```

---

### Task 2: Add ReAct models to models.py (10 min)

**Scope:** Add `ReactStep` (union of `PlanStep | DoneSignal`) and `Observation` model. These are the new types the planner outputs and receives.

**Files:**

- Modify: `backend/agents/models.py`
- Test: `backend/tests/unit/test_models.py` (verify new models work)

- [ ] **Step 1: Write the test**

Create or append to `backend/tests/unit/test_models.py`:

```python
"""Tests for ReAct models."""
from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)


def test_react_step_plan_step():
    """ReactStep can hold a PlanStep."""
    step = ReactStep(
        thought="User wants Hibike spots, need to resolve anime first",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
    )
    assert step.thought.startswith("User wants")
    assert step.action.tool == ToolName.RESOLVE_ANIME
    assert step.done is None


def test_react_step_done():
    """ReactStep can signal done."""
    step = ReactStep(
        thought="Found 12 spots and planned route",
        done=DoneSignal(message="Created a route with 12 stops."),
    )
    assert step.done is not None
    assert step.action is None


def test_observation_from_step_result():
    """Observation formats a step result summary."""
    obs = Observation(
        tool="resolve_anime",
        success=True,
        summary="Resolved to bangumi_id=115908 (響け！ユーフォニアム)",
    )
    assert obs.tool == "resolve_anime"
    assert "115908" in obs.summary
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent
source .venv/bin/activate
python -m pytest backend/tests/unit/test_models.py -v -k "react"
```

Expected: `ImportError: cannot import name 'DoneSignal'`

- [ ] **Step 3: Add models to models.py**

Add after the `ExecutionPlan` class (~line 41):

```python
class DoneSignal(BaseModel):
    """Planner signals that it has enough information to respond."""

    message: str = Field(description="Final message to show the user")


class Observation(BaseModel):
    """Executor's result fed back to the planner as an observation."""

    tool: str
    success: bool
    summary: str = Field(description="1-2 sentence summary of the step result")
    data_keys: list[str] = Field(
        default_factory=list,
        description="Top-level keys available in step result data",
    )


class ReactStep(BaseModel):
    """One turn of the ReAct loop — the planner's output per iteration.

    Either `action` (execute a tool) or `done` (finish) must be set, not both.
    """

    thought: str = Field(description="Chain-of-thought reasoning for this step")
    action: PlanStep | None = Field(
        default=None, description="Tool to execute (None if done)"
    )
    done: DoneSignal | None = Field(
        default=None, description="Signal to finish (None if action)"
    )
```

- [ ] **Step 4: Run test — expect PASS**

```bash
python -m pytest backend/tests/unit/test_models.py -v -k "react"
```

Expected: 3 tests PASS.

- [ ] **Step 5: Type check**

```bash
make typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/agents/models.py backend/tests/unit/test_models.py
git commit -m "feat(models): add ReactStep, DoneSignal, Observation for ReAct loop"
```

---

### Task 3: Add format_observation to ExecutorAgent (15 min)

**Scope:** Add a method that converts a `StepResult` into an `Observation` string the planner can understand. The executor stays deterministic — no architecture change here.

**Files:**

- Modify: `backend/agents/executor_agent.py`
- Test: `backend/tests/unit/test_executor_observation.py`

- [ ] **Step 1: Write the test**

Create `backend/tests/unit/test_executor_observation.py`:

```python
"""Tests for ExecutorAgent.format_observation."""
from backend.agents.executor_agent import ExecutorAgent, StepResult


def test_format_observation_resolve_anime():
    result = StepResult(
        tool="resolve_anime",
        success=True,
        data={"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    )
    obs = ExecutorAgent.format_observation(result)
    assert obs.tool == "resolve_anime"
    assert obs.success is True
    assert "115908" in obs.summary
    assert "響け" in obs.summary


def test_format_observation_search_with_count():
    result = StepResult(
        tool="search_bangumi",
        success=True,
        data={
            "row_count": 577,
            "status": "ok",
            "rows": [{"name": "宇治橋"}],
        },
    )
    obs = ExecutorAgent.format_observation(result)
    assert "577" in obs.summary
    assert obs.success is True


def test_format_observation_failure():
    result = StepResult(
        tool="resolve_anime",
        success=False,
        error="No anime found matching 'asdfghjkl'",
    )
    obs = ExecutorAgent.format_observation(result)
    assert obs.success is False
    assert "No anime found" in obs.summary


def test_format_observation_plan_route():
    result = StepResult(
        tool="plan_route",
        success=True,
        data={
            "timed_itinerary": {"spot_count": 12, "total_minutes": 150},
            "point_count": 12,
        },
    )
    obs = ExecutorAgent.format_observation(result)
    assert "12" in obs.summary
    assert obs.success is True
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
python -m pytest backend/tests/unit/test_executor_observation.py -v
```

Expected: `AttributeError: type object 'ExecutorAgent' has no attribute 'format_observation'`

- [ ] **Step 3: Add format_observation as a static method**

In `backend/agents/executor_agent.py`, add after the `execute` method (around line 148):

```python
    @staticmethod
    def format_observation(step_result: StepResult) -> Observation:
        """Convert a StepResult into an Observation for the planner.

        The planner needs a 1-2 sentence summary, not raw data.
        """
        from backend.agents.models import Observation

        tool = step_result.tool
        success = step_result.success
        data = step_result.data if isinstance(step_result.data, dict) else {}
        data_keys = list(data.keys()) if isinstance(data, dict) else []

        if not success:
            summary = f"Failed: {step_result.error or 'unknown error'}"
            return Observation(
                tool=tool, success=False, summary=summary, data_keys=data_keys
            )

        # Tool-specific summaries
        if tool == "resolve_anime":
            bangumi_id = data.get("bangumi_id", "unknown")
            title = data.get("title", "")
            summary = f"Resolved to bangumi_id={bangumi_id}"
            if title:
                summary += f" ({title})"

        elif tool in ("search_bangumi", "search_nearby"):
            count = data.get("row_count", len(data.get("rows", [])))
            status = data.get("status", "ok")
            summary = f"Found {count} spots (status: {status})"

        elif tool in ("plan_route", "plan_selected"):
            point_count = data.get("point_count", 0)
            itinerary = data.get("timed_itinerary")
            if isinstance(itinerary, dict):
                minutes = itinerary.get("total_minutes", 0)
                summary = f"Route planned: {point_count} stops, ~{minutes}min"
            else:
                summary = f"Route planned: {point_count} stops"

        elif tool == "clarify":
            question = data.get("question", "")
            summary = f"Asked user: {question[:80]}"

        elif tool in ("greet_user", "answer_question"):
            summary = "Response generated"

        else:
            summary = f"Completed with keys: {', '.join(data_keys[:5])}"

        return Observation(
            tool=tool, success=success, summary=summary, data_keys=data_keys
        )
```

- [ ] **Step 4: Run test — expect PASS**

```bash
python -m pytest backend/tests/unit/test_executor_observation.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/executor_agent.py backend/tests/unit/test_executor_observation.py
git commit -m "feat(executor): add format_observation for ReAct planner feedback"
```

---

### Task 4: Refactor planner for single-step output (30 min)

**Scope:** Change the planner from outputting a full `ExecutionPlan` to outputting one `ReactStep` per call. Add a `step()` method that accepts conversation history (previous thoughts + observations). Keep `create_plan()` for backward compatibility.

**Files:**

- Modify: `backend/agents/planner_agent.py`
- Test: `backend/tests/unit/test_planner_react.py`

- [ ] **Step 1: Write the test**

Create `backend/tests/unit/test_planner_react.py`:

```python
"""Tests for ReActPlannerAgent single-step mode."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.planner_agent import ReActPlannerAgent


@pytest.fixture
def mock_agent():
    """Create a planner with a mocked LLM agent."""
    with patch("backend.agents.planner_agent.create_agent") as mock_create:
        mock_inner = MagicMock()
        mock_create.return_value = mock_inner
        planner = ReActPlannerAgent.__new__(ReActPlannerAgent)
        planner._plan_agent = mock_inner
        # Create a separate mock for the step agent
        planner._step_agent = MagicMock()
        yield planner


@pytest.mark.asyncio
async def test_step_returns_action(mock_agent):
    """First step should return an action (PlanStep)."""
    expected = ReactStep(
        thought="User wants Hibike spots",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
    )
    mock_result = MagicMock()
    mock_result.output = expected
    mock_agent._step_agent.run = AsyncMock(return_value=mock_result)

    result = await mock_agent.step(
        text="響けの聖地", locale="ja", history=[]
    )
    assert result.action is not None
    assert result.action.tool == ToolName.RESOLVE_ANIME
    assert result.done is None


@pytest.mark.asyncio
async def test_step_returns_done_after_observations(mock_agent):
    """After enough observations, planner should signal done."""
    expected = ReactStep(
        thought="Have all the data, returning results",
        done=DoneSignal(message="Found 577 pilgrimage spots."),
    )
    mock_result = MagicMock()
    mock_result.output = expected
    mock_agent._step_agent.run = AsyncMock(return_value=mock_result)

    history = [
        Observation(tool="resolve_anime", success=True, summary="Resolved to 115908"),
        Observation(tool="search_bangumi", success=True, summary="Found 577 spots"),
    ]
    result = await mock_agent.step(
        text="響けの聖地", locale="ja", history=history
    )
    assert result.done is not None
    assert result.action is None


def test_format_history_empty():
    """Empty history should produce no observation lines."""
    from backend.agents.planner_agent import _format_react_history
    assert _format_react_history([]) == ""


def test_format_history_with_observations():
    """History should format as Observation blocks."""
    from backend.agents.planner_agent import _format_react_history
    history = [
        Observation(tool="resolve_anime", success=True, summary="Got 115908"),
    ]
    formatted = _format_react_history(history)
    assert "Observation" in formatted
    assert "resolve_anime" in formatted
    assert "115908" in formatted
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
python -m pytest backend/tests/unit/test_planner_react.py -v
```

Expected: ImportError or AttributeError (no `step` method, no `_format_react_history`).

- [ ] **Step 3: Update planner_agent.py**

Replace the class and add the helper function. Keep the existing `PLANNER_SYSTEM_PROMPT` and `_format_context_block` unchanged. Add after `_format_context_block`:

```python
REACT_SYSTEM_PROMPT = PLANNER_SYSTEM_PROMPT + """

## ReAct mode

You are operating in ReAct (Reason + Act) mode. Each turn, you:
1. Think about what to do next based on the user's request and any observations so far
2. Either emit an action (tool call) or signal done

When you have enough information to respond to the user, set `done` with the final message.
When you need more information, set `action` with the next tool to call.

Never emit both `action` and `done` in the same turn.
Maximum 8 turns per conversation.
"""


def _format_react_history(history: list[Observation]) -> str:
    """Format observation history for planner prompt injection."""
    if not history:
        return ""
    lines: list[str] = []
    for i, obs in enumerate(history, 1):
        status = "✓" if obs.success else "✗"
        lines.append(f"Observation {i} [{obs.tool} {status}]: {obs.summary}")
    return "\n".join(lines)
```

Then update the `ReActPlannerAgent` class:

```python
class ReActPlannerAgent:
    """LLM-driven planner with ReAct loop support.

    Two modes:
    - create_plan(): one-shot, returns full ExecutionPlan (backward compat)
    - step(): single-step ReAct, returns ReactStep with thought + action/done
    """

    def __init__(self, model: Model | str | None = None) -> None:
        selected_model: Model | str = get_default_model() if model is None else model
        self._plan_agent = create_agent(
            selected_model,
            system_prompt=PLANNER_SYSTEM_PROMPT,
            output_type=ExecutionPlan,
            retries=2,
        )
        self._step_agent = create_agent(
            selected_model,
            system_prompt=REACT_SYSTEM_PROMPT,
            output_type=ReactStep,
            retries=2,
        )

    async def create_plan(
        self,
        text: str,
        locale: str = "ja",
        context: dict[str, object] | None = None,
    ) -> ExecutionPlan:
        """One-shot plan generation (backward compat)."""
        context_prefix = _format_context_block(context)
        prompt = (
            f"{context_prefix}\n[locale={locale}] {text}"
            if context_prefix
            else f"[locale={locale}] {text}"
        )
        result = await self._plan_agent.run(prompt)
        return result.output

    async def step(
        self,
        text: str,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        history: list[Observation] | None = None,
    ) -> ReactStep:
        """Single ReAct step: observe history, emit next action or done."""
        context_prefix = _format_context_block(context)
        history_prefix = _format_react_history(history or [])

        parts: list[str] = []
        if context_prefix:
            parts.append(context_prefix)
        if history_prefix:
            parts.append(history_prefix)
        parts.append(f"[locale={locale}] {text}")

        prompt = "\n".join(parts)
        result = await self._step_agent.run(prompt)
        return result.output
```

Update the import at the top to include new types:

```python
from backend.agents.models import ExecutionPlan, Observation, ReactStep
```

- [ ] **Step 4: Run test — expect PASS**

```bash
python -m pytest backend/tests/unit/test_planner_react.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Type check + existing tests**

```bash
make typecheck
python -m pytest backend/tests/unit/ -v --no-cov -x
```

Expected: all PASS (backward compat via `create_plan` preserved).

- [ ] **Step 6: Commit**

```bash
git add backend/agents/planner_agent.py backend/tests/unit/test_planner_react.py
git commit -m "feat(planner): add ReAct step() method for multi-turn reasoning"
```

---

### Task 5: Rewrite pipeline.py as ReAct async generator (30 min)

**Scope:** Replace `run_pipeline` with `react_loop` that yields `ReactStepEvent` objects. Keep `run_pipeline` as a wrapper for backward compat.

**Files:**

- Rewrite: `backend/agents/pipeline.py`
- Test: `backend/tests/unit/test_pipeline_react.py`

- [ ] **Step 1: Write the test**

Create `backend/tests/unit/test_pipeline_react.py`:

```python
"""Tests for ReAct loop pipeline."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.executor_agent import StepResult
from backend.agents.pipeline import react_loop, ReactStepEvent


@pytest.mark.asyncio
async def test_react_loop_single_step_done():
    """Simple query that completes in one step."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Planner immediately returns done
    step1 = ReactStep(
        thought="Just a greeting",
        done=DoneSignal(message="Hello! I can help with pilgrimage planning."),
    )
    mock_planner.step = AsyncMock(return_value=step1)

    events: list[ReactStepEvent] = []
    async for event in react_loop(
        text="hi",
        planner=mock_planner,
        executor=mock_executor,
        locale="en",
    ):
        events.append(event)

    assert len(events) == 1
    assert events[0].type == "done"
    assert "Hello" in events[0].message


@pytest.mark.asyncio
async def test_react_loop_multi_step():
    """Query requiring resolve → search → done."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Step 1: resolve_anime
    step1 = ReactStep(
        thought="Need to resolve anime title",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
    )
    # Step 2: search_bangumi
    step2 = ReactStep(
        thought="Now search for spots",
        action=PlanStep(tool=ToolName.SEARCH_BANGUMI, params={}),
    )
    # Step 3: done
    step3 = ReactStep(
        thought="Have the results",
        done=DoneSignal(message="Found 577 spots."),
    )
    mock_planner.step = AsyncMock(side_effect=[step1, step2, step3])

    # Executor results
    result1 = StepResult(
        tool="resolve_anime", success=True,
        data={"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    )
    result2 = StepResult(
        tool="search_bangumi", success=True,
        data={"row_count": 577, "status": "ok", "rows": []},
    )
    mock_executor._execute_step = AsyncMock(side_effect=[result1, result2])
    mock_executor.format_observation = MagicMock(side_effect=[
        Observation(tool="resolve_anime", success=True, summary="Got 115908"),
        Observation(tool="search_bangumi", success=True, summary="577 spots"),
    ])

    events = []
    async for event in react_loop(
        text="響けの聖地",
        planner=mock_planner,
        executor=mock_executor,
        locale="ja",
    ):
        events.append(event)

    assert len(events) == 3  # step, step, done
    assert events[0].type == "step"
    assert events[0].tool == "resolve_anime"
    assert events[1].type == "step"
    assert events[1].tool == "search_bangumi"
    assert events[2].type == "done"


@pytest.mark.asyncio
async def test_react_loop_max_steps():
    """Loop stops after max_steps even if planner keeps emitting actions."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Planner always returns an action (infinite loop)
    action = ReactStep(
        thought="Keep going",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "x"}),
    )
    mock_planner.step = AsyncMock(return_value=action)

    result = StepResult(tool="resolve_anime", success=True, data={})
    mock_executor._execute_step = AsyncMock(return_value=result)
    mock_executor.format_observation = MagicMock(
        return_value=Observation(tool="resolve_anime", success=True, summary="ok")
    )

    events = []
    async for event in react_loop(
        text="test", planner=mock_planner, executor=mock_executor,
        locale="ja", max_steps=3,
    ):
        events.append(event)

    # Should stop at max_steps + 1 forced done event
    assert events[-1].type == "done"
    step_events = [e for e in events if e.type == "step"]
    assert len(step_events) <= 3
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
python -m pytest backend/tests/unit/test_pipeline_react.py -v
```

Expected: `ImportError: cannot import name 'react_loop'`

- [ ] **Step 3: Rewrite pipeline.py**

```python
"""Pipeline — ReAct loop: think → act → observe → repeat."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

import structlog
from pydantic_ai.models import Model

from backend.agents.executor_agent import ExecutorAgent, PipelineResult, StepResult
from backend.agents.models import (
    DoneSignal,
    ExecutionPlan,
    Observation,
    PlanStep,
    ReactStep,
)
from backend.agents.planner_agent import ReActPlannerAgent

logger = structlog.get_logger(__name__)

MAX_REACT_STEPS = 8


@dataclass
class ReactStepEvent:
    """One event yielded by the ReAct loop for SSE streaming."""

    type: str  # "step", "done", "clarify", "error"
    thought: str = ""
    tool: str = ""
    status: str = ""
    observation: str = ""
    message: str = ""
    data: dict[str, object] = field(default_factory=dict)
    step_result: StepResult | None = None


async def react_loop(
    text: str,
    planner: ReActPlannerAgent,
    executor: ExecutorAgent,
    *,
    locale: str = "ja",
    context: dict[str, object] | None = None,
    max_steps: int = MAX_REACT_STEPS,
) -> AsyncIterator[ReactStepEvent]:
    """ReAct loop: planner thinks → executor acts → observe → repeat.

    Yields ReactStepEvent for each step (for SSE streaming).
    """
    history: list[Observation] = []
    accumulated_results: list[StepResult] = []
    executor_context: dict[str, object] = {"locale": locale}
    if context and context.get("last_location"):
        executor_context["last_location"] = context["last_location"]

    for turn in range(max_steps):
        # 1. Planner thinks
        react_step = await planner.step(
            text=text, locale=locale, context=context, history=history
        )

        logger.info(
            "react_turn",
            turn=turn,
            thought=react_step.thought[:100],
            has_action=react_step.action is not None,
            has_done=react_step.done is not None,
        )

        # 2. If done, yield final event and stop
        if react_step.done is not None:
            yield ReactStepEvent(
                type="done",
                thought=react_step.thought,
                message=react_step.done.message,
                data={"step_results": [r.data for r in accumulated_results if r.data]},
            )
            return

        # 3. If action, execute it
        if react_step.action is not None:
            step = react_step.action
            tool_name = step.tool.value if hasattr(step.tool, "value") else str(step.tool)

            # Yield "running" event
            yield ReactStepEvent(
                type="step",
                thought=react_step.thought,
                tool=tool_name,
                status="running",
            )

            # Execute
            step_result = await executor._execute_step(step, executor_context)
            accumulated_results.append(step_result)

            # Update executor context (same as original pipeline)
            if step_result.success and hasattr(step, "tool"):
                executor_context[step.tool.value] = step_result.data

            # Format observation for planner
            obs = ExecutorAgent.format_observation(step_result)
            history.append(obs)

            # Yield "done" event for this step
            yield ReactStepEvent(
                type="step",
                thought=react_step.thought,
                tool=tool_name,
                status="done",
                observation=obs.summary,
                data=step_result.data if isinstance(step_result.data, dict) else {},
                step_result=step_result,
            )

            # If step failed, stop the loop
            if not step_result.success:
                yield ReactStepEvent(
                    type="error",
                    thought=react_step.thought,
                    message=f"Step {tool_name} failed: {step_result.error}",
                )
                return

            # If clarify, pause and wait for user input
            if tool_name == "clarify":
                yield ReactStepEvent(
                    type="clarify",
                    thought=react_step.thought,
                    tool="clarify",
                    data=step_result.data if isinstance(step_result.data, dict) else {},
                    message=step_result.data.get("question", "") if isinstance(step_result.data, dict) else "",
                )
                return

    # Max steps reached — force done
    yield ReactStepEvent(
        type="done",
        thought="Maximum reasoning steps reached",
        message="I've completed my analysis. Here are the results so far.",
        data={"step_results": [r.data for r in accumulated_results if r.data]},
    )


async def run_pipeline(
    text: str,
    db: object,
    *,
    model: Model | str | None = None,
    locale: str = "ja",
    context: dict[str, object] | None = None,
    on_step: Callable[[str, str, dict[str, object]], Awaitable[None]] | None = None,
) -> PipelineResult:
    """Backward-compatible wrapper: runs ReAct loop and collects into PipelineResult."""
    planner = ReActPlannerAgent(model)
    executor = ExecutorAgent(db)

    all_step_results: list[StepResult] = []
    final_message = ""

    async for event in react_loop(
        text=text,
        planner=planner,
        executor=executor,
        locale=locale,
        context=context,
    ):
        if on_step is not None and event.type == "step":
            await on_step(event.tool, event.status, event.data)

        if event.step_result is not None:
            all_step_results.append(event.step_result)

        if event.type == "done":
            final_message = event.message

    # Build a PipelineResult from accumulated results
    # Infer intent from the last successful tool execution
    intent = "answer_question"
    for sr in reversed(all_step_results):
        if sr.success and sr.tool not in ("resolve_anime", "greet_user"):
            intent = sr.tool
            break

    plan = ExecutionPlan(
        steps=[],  # ReAct doesn't produce a pre-computed plan
        reasoning="ReAct loop",
        locale=locale,
    )
    result = PipelineResult(intent=intent, plan=plan)
    result.step_results = all_step_results

    # Build final_output from the last successful step's data
    last_data: dict[str, object] = {}
    for sr in reversed(all_step_results):
        if sr.success and isinstance(sr.data, dict):
            last_data = sr.data
            break

    result.final_output = {
        "success": bool(all_step_results and all_step_results[-1].success),
        "status": "ok" if all_step_results else "empty",
        "message": final_message,
        **last_data,
    }

    return result
```

- [ ] **Step 4: Run test — expect PASS**

```bash
python -m pytest backend/tests/unit/test_pipeline_react.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run all unit tests**

```bash
python -m pytest backend/tests/unit/ -v --no-cov -x
```

Expected: all PASS (backward compat via `run_pipeline` wrapper).

- [ ] **Step 6: Commit**

```bash
git add backend/agents/pipeline.py backend/tests/unit/test_pipeline_react.py
git commit -m "feat(pipeline): ReAct loop with async generator + backward-compat wrapper"
```

---

### Task 6: Wire ReAct loop into SSE streaming (20 min)

**Scope:** Update `http_service.py` to use the ReAct loop's richer events for SSE streaming. Add `thought` and `observation` fields to SSE step events.

**Files:**

- Modify: `backend/interfaces/http_service.py:196-221` (SSE handler)
- Modify: `backend/interfaces/public_api.py` (handle method needs to yield events)

- [ ] **Step 1: Update SSE handler in http_service.py**

In `http_service.py`, find the SSE streaming section (~lines 196-221). Replace:

```python
# Before (lines 207-219):
    try:
        await emit("planning", {"status": "running"})
        response = await runtime_api.handle(
            api_request, user_id=user_id, on_step=on_step
        )
        await emit("done", response.model_dump(mode="json"))
    except Exception as exc:
        await emit("error", {"message": str(exc)})

# After:
    try:
        await emit("planning", {"status": "running"})
        response = await runtime_api.handle(
            api_request,
            user_id=user_id,
            on_step=on_step,
        )
        await emit("done", response.model_dump(mode="json"))
    except Exception as exc:
        # Sanitize error — never expose raw Python exceptions
        logger.exception("sse_pipeline_error", error=str(exc))
        await emit("error", {
            "code": "internal_error",
            "message": "Something went wrong. Please try again.",
        })
```

- [ ] **Step 2: Update on_step callback to include thought/observation**

The `on_step` callback in `http_service.py:204` currently sends `{"tool": tool, "status": status, "data": data}`. Update the emit to include `thought` and `observation`:

```python
    async def on_step(
        tool: str, status: str, data: dict[str, object],
        thought: str = "", observation: str = "",
    ) -> None:
        await emit("step", {
            "tool": tool,
            "status": status,
            "thought": thought,
            "observation": observation,
            "data": data,
        })
```

And update `public_api.py`'s call to `on_step` to pass the extra fields when available from `ReactStepEvent`.

- [ ] **Step 3: Type check + test**

```bash
make typecheck
python -m pytest backend/tests/unit/ -v --no-cov -x
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/interfaces/http_service.py backend/interfaces/public_api.py
git commit -m "feat(sse): stream ReAct thought + observation in step events, sanitize errors"
```

---

### Task 7: Frontend ThinkingProcess component (30 min)

**Scope:** Replace the `StepTrace` in MessageBubble with a collapsible `ThinkingProcess` that shows thought/action/observation for each ReAct step.

**Files:**

- Create: `frontend/components/chat/ThinkingProcess.tsx`
- Modify: `frontend/components/chat/MessageBubble.tsx` (replace StepTrace)
- Modify: `frontend/hooks/useChat.ts` (handle richer step data)

- [ ] **Step 1: Create ThinkingProcess component**

Create `frontend/components/chat/ThinkingProcess.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useDict } from "../../lib/i18n-context";

interface ThinkingStep {
  tool: string;
  status: "running" | "done";
  thought?: string;
  observation?: string;
}

interface ThinkingProcessProps {
  steps: ThinkingStep[];
  isStreaming: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  resolve_anime: "🔍",
  search_bangumi: "📍",
  search_nearby: "📍",
  plan_route: "🗺️",
  plan_selected: "🗺️",
  greet_user: "👋",
  answer_question: "💬",
  clarify: "❓",
};

export default function ThinkingProcess({
  steps,
  isStreaming,
}: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const t = useDict();

  if (steps.length === 0) return null;

  const summary = steps
    .filter((s) => s.status === "done")
    .map((s) => s.observation || s.tool)
    .join(" → ");

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <span className={isStreaming ? "animate-pulse" : ""}>🧠</span>
        <span>
          {isStreaming
            ? t.chat?.thinking || "Thinking..."
            : summary || t.chat?.thought_complete || "Done"}
        </span>
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-4 border-l-2 border-[var(--color-border)] pl-3 space-y-1.5">
          {steps.map((step, i) => {
            const icon = TOOL_ICONS[step.tool] || "⚙️";
            const isLast = i === steps.length - 1;
            const isRunning = step.status === "running";

            return (
              <div key={`${step.tool}-${i}`} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span>{icon}</span>
                  <span
                    className={
                      isRunning ? "text-[var(--color-primary)] animate-pulse" : ""
                    }
                  >
                    {step.thought || step.tool}
                  </span>
                  {!isRunning && (
                    <span className="text-green-600">✓</span>
                  )}
                </div>
                {step.observation && !isRunning && (
                  <div className="ml-5 text-[var(--color-muted)]">
                    → {step.observation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update MessageBubble to use ThinkingProcess**

In `frontend/components/chat/MessageBubble.tsx`:

Replace the `STEP_LABELS` dict and `StepTrace` rendering with:

```tsx
import ThinkingProcess from "./ThinkingProcess";

// Remove lines 89-95 (STEP_LABELS)
// Replace the StepTrace section with:
{message.steps && message.steps.length > 0 && (
  <ThinkingProcess
    steps={message.steps}
    isStreaming={message.loading}
  />
)}
```

- [ ] **Step 3: Update useChat.ts step handling**

In `frontend/hooks/useChat.ts`, update the `onStep` callback (~line 74-90) to capture `thought` and `observation`:

```typescript
// In the onStep handler, update the step structure:
const newStep = {
  tool: data.tool as string,
  status: data.status as "running" | "done",
  thought: (data.thought as string) || "",
  observation: (data.observation as string) || "",
};
```

- [ ] **Step 4: Add i18n keys**

Add to `frontend/lib/dictionaries/en.json`:
```json
"thinking": "Thinking...",
"thought_complete": "Done"
```

Same for `ja.json`:
```json
"thinking": "考え中...",
"thought_complete": "完了"
```

And `zh.json`:
```json
"thinking": "思考中...",
"thought_complete": "完成"
```

- [ ] **Step 5: Type check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/chat/ThinkingProcess.tsx \
  frontend/components/chat/MessageBubble.tsx \
  frontend/hooks/useChat.ts \
  frontend/lib/dictionaries/
git commit -m "feat(ui): collapsible ThinkingProcess replaces StepTrace with ReAct display"
```

---

## Verification

After all 7 tasks:

```bash
# Backend
make check

# Frontend
cd frontend && npx tsc --noEmit && npm run build

# Manual test: the pipeline should still work end-to-end
# with the backward-compat run_pipeline wrapper
```

The ReAct loop is now the foundation. Plans 2-7 build on top of this.
