# Agent Code Quality Remediation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> - REQUIRED REFERENCE SKILL: Use `ai:building-pydantic-ai-agents` — load the relevant reference doc (Input and History, Testing and Debugging, Tools Advanced, etc.) before implementing each task. This ensures code follows PydanticAI official patterns.
> - REFERENCE SKILL: Use `logfire:instrumentation` when touching observability code.

**Goal:** Fix 18 issues found in agent code review — from P0 production failures (broken message history, eval scoring) to P2 cleanup (file splitting, error handling).

**Architecture:** Fix history processors to preserve tool call/return pairs, fix eval error guard to count `report.failures`, fix tool_state seeding for cross-turn search results, then clean up tools and instructions. All changes must follow PydanticAI official patterns from the `building-pydantic-ai-agents` skill references.

**Tech Stack:** PydanticAI 1.69+, pytest, pydantic_evals

**Key PydanticAI references (in skill `ai:building-pydantic-ai-agents`):**
- Tasks 1-2: [Input and History](references/INPUT-AND-HISTORY.md) — history_processors, message pairing
- Tasks 3: [Orchestration and Integrations](references/ORCHESTRATION-AND-INTEGRATIONS.md) — evals
- Tasks 4-5: [Tools Advanced](references/TOOLS-ADVANCED.md) — retries, ModelRetry, tool defaults
- Task 8: [Testing and Debugging](references/TESTING-AND-DEBUGGING.md) — TestModel, FunctionModel, capture_run_messages

---

## File Map

| File | Changes |
|------|---------|
| `backend/agents/pilgrimage_agent.py` | Rewrite `_sliding_window`, fix `_compress_request`, update instructions |
| `backend/tests/unit/test_history_processors.py` | Add pair-preservation tests |
| `backend/tests/eval/test_agent_eval.py` | Fix error guard, add retry_task, lower concurrency |
| `backend/tests/eval/eval_common.py` | Update baseline schema (evaluated_count) |
| `backend/agents/pilgrimage_runner.py` | Fix `_seed_tool_state` search data restoration |
| `backend/agents/route_area_splitter.py` | Add exception logging |
| `backend/agents/pilgrimage_tools.py` | Fix clarify default, fix None return, remove duplicate tool |
| `backend/interfaces/public_api.py` | Catch ModelHTTPError for friendly 502 message |
| `backend/agents/web_tools.py` | NEW — extract web_search + translate_anime_title |

---

### Task 1: Fix `_sliding_window` to preserve tool pairs

**Files:**
- Modify: `backend/agents/pilgrimage_agent.py:155-159`
- Test: `backend/tests/unit/test_history_processors.py`

- [ ] **Step 1: Write failing test — sliding window preserves tool call/return pairs**

```python
# In backend/tests/unit/test_history_processors.py, add:

class TestSlidingWindowPairPreservation:
    def test_preserves_tool_call_return_pair(self) -> None:
        """Sliding window must not orphan a ToolReturnPart from its ToolCallPart."""
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [
            _make_user_request("q1"),
            _make_response("a1"),
            _make_user_request("q2"),
            _make_tool_call_response("search_bangumi", "call_1"),
            _make_request_with_tool_return("search_bangumi", "results", "call_1"),
            _make_response("found 76 spots"),
            _make_user_request("q3"),
            _make_response("a3"),
            _make_user_request("q4"),
            _make_response("a4"),
            _make_user_request("q5"),
            _make_response("a5"),
            _make_user_request("q6"),
            _make_response("a6"),
        ]
        result = _sliding_window(messages)

        # Verify: every ToolReturnPart has a preceding ToolCallPart
        for i, msg in enumerate(result):
            if isinstance(msg, ModelRequest):
                for part in msg.parts:
                    if isinstance(part, ToolReturnPart):
                        # There must be a preceding ModelResponse with matching ToolCallPart
                        found_call = False
                        for prev in result[:i]:
                            if isinstance(prev, ModelResponse):
                                for pp in prev.parts:
                                    if isinstance(pp, ToolCallPart) and pp.tool_call_id == part.tool_call_id:
                                        found_call = True
                        assert found_call, (
                            f"ToolReturnPart '{part.tool_name}' at index {i} "
                            f"has no preceding ToolCallPart with id '{part.tool_call_id}'"
                        )

    def test_sliding_window_cuts_on_user_turn_boundary(self) -> None:
        """Window should start at a UserPromptPart, not mid-turn."""
        from backend.agents.pilgrimage_agent import _sliding_window

        messages: list[ModelMessage] = [
            _make_user_request("old1"),
            _make_tool_call_response("resolve_anime", "c1"),
            _make_request_with_tool_return("resolve_anime", "data", "c1"),
            _make_response("resolved"),
            _make_user_request("old2"),
            _make_response("a2"),
            _make_user_request("recent1"),
            _make_response("r1"),
            _make_user_request("recent2"),
            _make_response("r2"),
            _make_user_request("recent3"),
            _make_response("r3"),
        ]
        result = _sliding_window(messages)

        # First message in result should be a UserPromptPart, not a ToolCallPart
        first = result[0]
        assert isinstance(first, ModelRequest)
        assert any(isinstance(p, UserPromptPart) for p in first.parts)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest backend/tests/unit/test_history_processors.py::TestSlidingWindowPairPreservation -v`
Expected: FAIL

- [ ] **Step 3: Rewrite `_sliding_window` with turn-boundary slicing**

In `backend/agents/pilgrimage_agent.py`, replace lines 155-159:

```python
def _sliding_window(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Keep last ~COMPACT_THRESHOLD messages, slicing on turn boundaries.

    A turn starts at a UserPromptPart and includes all subsequent messages
    (tool calls, tool returns, responses) until the next UserPromptPart.
    This ensures tool call/return pairs are never orphaned.
    """
    if len(messages) <= COMPACT_THRESHOLD:
        return messages

    # Find turn start indices (messages containing UserPromptPart)
    turn_starts: list[int] = []
    for i, msg in enumerate(messages):
        if isinstance(msg, ModelRequest) and any(
            isinstance(p, UserPromptPart) for p in msg.parts
        ):
            turn_starts.append(i)

    if not turn_starts:
        return messages[-COMPACT_THRESHOLD:]

    # Walk backwards, keeping complete turns within budget
    keep_from = turn_starts[-1]
    for start in reversed(turn_starts):
        if len(messages) - start <= COMPACT_THRESHOLD:
            keep_from = start
        else:
            break

    return messages[keep_from:]
```

Add import at top if not present: `UserPromptPart` (already imported via `from pydantic_ai.messages import ...`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest backend/tests/unit/test_history_processors.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agents/pilgrimage_agent.py backend/tests/unit/test_history_processors.py
git commit -m "fix: rewrite _sliding_window to preserve tool call/return pairs"
```

---

### Task 2: Fix `_compress_request` to preserve ModelRequest fields

**Files:**
- Modify: `backend/agents/pilgrimage_agent.py:136-142`
- Test: `backend/tests/unit/test_history_processors.py`

- [ ] **Step 1: Write failing test**

```python
# In backend/tests/unit/test_history_processors.py, add:

class TestCompressRequestPreservesFields:
    def test_preserves_instructions_field(self) -> None:
        from backend.agents.pilgrimage_agent import _compress_request

        original = ModelRequest(
            parts=[ToolReturnPart(tool_name="search", content="x" * 300, tool_call_id="c1")],
            instructions="You are a helpful assistant.",
        )
        compressed = _compress_request(original)
        assert compressed.instructions == "You are a helpful assistant."
        # Content should be compressed
        part = compressed.parts[0]
        assert isinstance(part, ToolReturnPart)
        assert "[search: completed]" in str(part.content)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/unit/test_history_processors.py::TestCompressRequestPreservesFields -v`
Expected: FAIL — `compressed.instructions` is None

- [ ] **Step 3: Fix `_compress_request`**

In `backend/agents/pilgrimage_agent.py`, replace `_compress_request`:

```python
def _compress_request(msg: ModelRequest) -> ModelRequest:
    """Replace large ToolReturnParts with compact placeholders, preserving all fields."""
    new_parts = [
        _compress_tool_return(p) if isinstance(p, ToolReturnPart) else p
        for p in msg.parts
    ]
    return ModelRequest(
        parts=new_parts,
        instructions=msg.instructions,
    )
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_history_processors.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agents/pilgrimage_agent.py backend/tests/unit/test_history_processors.py
git commit -m "fix: _compress_request preserves ModelRequest instructions field"
```

---

### Task 3: Fix eval error guard

**Files:**
- Modify: `backend/tests/eval/test_agent_eval.py:316-356`
- Modify: `backend/tests/eval/eval_common.py` (if baseline write needs update)
- Test: `backend/tests/unit/test_eval_common.py`

- [ ] **Step 1: Read current eval files**

Read `backend/tests/eval/test_agent_eval.py` and `backend/tests/eval/eval_common.py` fully before editing.

- [ ] **Step 2: Fix error guard in `test_agent_eval.py`**

Replace lines 349-356:

```python
    # Guard: refuse to proceed if >20% of cases errored
    total = len(report.cases) + len(report.failures)
    errored = len(report.failures)
    error_rate = errored / total if total > 0 else 1.0
    if error_rate > 0.20:
        pytest.fail(
            f"{errored}/{total} cases failed ({error_rate:.0%}). "
            "Check API key and model endpoint."
        )
```

- [ ] **Step 3: Fix per-case results to include failures**

Replace `errored` calculation in `_save_per_case_results` (around line 316):

```python
    errored = len(report.failures)
```

And update payload:

```python
    payload = {
        "model": model_id,
        "case_count": len(CASES),
        "evaluated_count": len(report.cases),
        "errored_count": errored,
        "scores": scores,
        "cases": case_results,
    }
```

- [ ] **Step 4: Add `retry_task` and lower `max_concurrency`**

In `test_agent` function, update the `evaluate` call:

```python
    from tenacity import stop_after_attempt, wait_exponential

    report = await agent_dataset.evaluate(
        task,
        name=f"agent_{_EVAL_MODEL_ID}",
        max_concurrency=10,
        retry_task={
            "stop": stop_after_attempt(2),
            "wait": wait_exponential(min=1, max=5),
        },
    )
```

Add `tenacity` import at the top of the file.

- [ ] **Step 5: Fix baseline validation**

In `read_baseline` (in `eval_common.py`), add check:

```python
evaluated = baseline.get("evaluated_count", baseline.get("case_count", 0))
if evaluated < expected_case_count * 0.80:
    return None  # Reject baseline created with too few cases
```

- [ ] **Step 6: Run unit tests**

Run: `make test`
Expected: ALL PASS (eval tests are integration, not run by `make test`)

- [ ] **Step 7: Commit**

```bash
git add backend/tests/eval/test_agent_eval.py backend/tests/eval/eval_common.py
git commit -m "fix: eval error guard counts report.failures, adds retry + lower concurrency"
```

---

### Task 4: Fix tool_state seeding for cross-turn search results

**Files:**
- Modify: `backend/agents/pilgrimage_runner.py:47-53`
- Modify: `backend/agents/pilgrimage_agent.py` (instructions update)
- Test: `backend/tests/unit/test_pilgrimage_runner.py`

- [ ] **Step 1: Write failing test**

```python
# In backend/tests/unit/test_pilgrimage_runner.py, add:

def test_seed_tool_state_restores_search_data_directly() -> None:
    """last_search_data should populate search_bangumi in tool_state for plan_route."""
    from unittest.mock import MagicMock

    deps = RuntimeDeps(db=MagicMock(), locale="en", query="plan route")
    context: dict[str, object] = {
        "last_search_data": {
            "rows": [{"bangumi_id": "485", "name": "北高校"}],
            "row_count": 1,
            "status": "ok",
        },
    }
    _seed_tool_state(deps, context)

    # search_bangumi should be populated so plan_route can read it
    assert "search_bangumi" in deps.tool_state
    search_data = deps.tool_state["search_bangumi"]
    assert isinstance(search_data, dict)
    assert search_data.get("row_count") == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/unit/test_pilgrimage_runner.py::test_seed_tool_state_restores_search_data_directly -v`
Expected: FAIL — `search_bangumi` not in tool_state (current code expects nested structure)

- [ ] **Step 3: Fix `_seed_tool_state`**

In `backend/agents/pilgrimage_runner.py`, replace lines 47-53:

```python
    raw = context.get("last_search_data")
    if not isinstance(raw, dict):
        return
    # If raw has nested keys (search_bangumi/search_nearby), use them
    for key in ("search_bangumi", "search_nearby"):
        value = raw.get(key)
        if isinstance(value, dict):
            deps.tool_state[key] = value
    # If raw itself looks like search results (has "rows"), populate directly
    if "rows" in raw and "search_bangumi" not in deps.tool_state:
        deps.tool_state["search_bangumi"] = raw
```

- [ ] **Step 4: Update instructions for multi-turn route planning**

In `backend/agents/pilgrimage_agent.py`, update the "Route planning" section in `_INSTRUCTIONS`:

```
### Route planning
- When the user asks for a route/itinerary/walking plan:
  1. If you can see search results in the conversation history (previous turn
     returned pilgrimage points), call plan_route directly — no need to re-search.
  2. Otherwise: resolve_anime → search_bangumi → plan_route (all three steps).
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/unit/test_pilgrimage_runner.py -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/agents/pilgrimage_runner.py backend/agents/pilgrimage_agent.py backend/tests/unit/test_pilgrimage_runner.py
git commit -m "fix: seed search_bangumi in tool_state for cross-turn route planning"
```

---

### Task 5: Fix tool issues (clarify default, exception logging, None return)

**Files:**
- Modify: `backend/agents/pilgrimage_tools.py:364,148,407-414`
- Modify: `backend/agents/route_area_splitter.py:127-128`
- Test: `backend/tests/unit/test_handlers.py`

- [ ] **Step 1: Fix mutable default in clarify tool**

In `backend/agents/pilgrimage_tools.py`, line 364:

```python
# BEFORE:
    options: list[str] = [],  # noqa: B006

# AFTER:
    options: list[str] | None = None,
```

And update line 383:

```python
    normalized_options = list(options) if options else []
```

- [ ] **Step 2: Fix `_summarize_for_llm` None return**

In `backend/agents/pilgrimage_tools.py`, line 148:

```python
# BEFORE:
    return _summarize_for_llm(tool, result.data) if result.data else result.data

# AFTER:
    return _summarize_for_llm(tool, result.data) if result.data else {}
```

- [ ] **Step 3: Remove duplicate `enrich_candidates` tool**

Delete the `enrich_candidates` tool registration (lines 407-414 in `pilgrimage_tools.py`). The `clarify` tool already enriches internally.

- [ ] **Step 4: Add exception logging in route_area_splitter**

In `backend/agents/route_area_splitter.py`, line 127-128:

```python
# BEFORE:
    except Exception:
        return None

# AFTER:
    except Exception:
        import structlog
        structlog.get_logger(__name__).warning(
            "split_into_areas_failed",
            point_count=len(points),
            exc_info=True,
        )
        return None
```

- [ ] **Step 5: Run full test suite**

Run: `make check`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/agents/pilgrimage_tools.py backend/agents/route_area_splitter.py
git commit -m "fix: clarify mutable default, None return, duplicate tool, silent exception"
```

---

### Task 6: Add ModelHTTPError handling for friendly 502 messages

**Files:**
- Modify: `backend/interfaces/public_api.py:285-299`
- Test: `backend/tests/unit/test_public_api_errors.py`

- [ ] **Step 1: Write failing test**

```python
# In backend/tests/unit/test_public_api_errors.py, add:

async def test_handle_returns_friendly_message_on_model_http_error() -> None:
    """ModelHTTPError (502) should return a user-friendly message, not generic pipeline error."""
    from pydantic_ai.exceptions import ModelHTTPError
    from backend.interfaces.public_api import RuntimeAPI

    api = RuntimeAPI(db=_make_mock_db())
    request = PublicAPIRequest(text="凉宫")

    with patch(
        "backend.interfaces.public_api.run_pilgrimage_agent",
        side_effect=ModelHTTPError(status_code=502, model_name="gpt-5.4", body={"message": "Network unstable"}),
    ):
        response = await api.handle(request)

    assert response.success is False
    assert "unavailable" in response.message.lower() or "try again" in response.message.lower()
    assert "pipeline" not in response.message.lower()
```

- [ ] **Step 2: Add ModelHTTPError catch in `_execute_pipeline`**

In `backend/interfaces/public_api.py`, add before the generic `except Exception`:

```python
        except TimeoutError:
            # ... existing timeout handler ...
        except ApplicationError as exc:
            # ... existing handler ...
        except Exception as exc:
            # Check if it's a model provider error (502, rate limit, etc.)
            error_msg = str(exc)
            is_provider_error = any(k in error_msg.lower() for k in ["502", "503", "rate limit", "network", "model"])
            record_exc = getattr(span, "record_exception", None)
            if callable(record_exc):
                record_exc(exc)
            if is_provider_error:
                logger.warning("provider_error", error=error_msg[:200])
                return (
                    None,
                    PublicAPIResponse(
                        success=False,
                        status="provider_error",
                        intent="error",
                        message="The AI service is temporarily unavailable. Please try again in a moment.",
                        errors=[
                            PublicAPIError(
                                code="provider_error",
                                message=error_msg[:500],
                            )
                        ],
                    ),
                    context_delta,
                )
            logger.error("pipeline_unhandled_exception", exc_info=exc)
            return (
                None,
                PublicAPIResponse(
                    success=False,
                    status="error",
                    intent="unknown",
                    message="The runtime failed before producing a pipeline result.",
                    # ... rest unchanged
```

- [ ] **Step 3: Run tests**

Run: `make test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add backend/interfaces/public_api.py backend/tests/unit/test_public_api_errors.py
git commit -m "fix: friendly error message for ModelHTTPError (502/503/rate limit)"
```

---

### Task 7: Extract web tools to separate module

**Files:**
- Create: `backend/agents/web_tools.py`
- Modify: `backend/agents/pilgrimage_tools.py` (remove web_search and translate_anime_title)
- Test: existing tests should still pass

- [ ] **Step 1: Create `backend/agents/web_tools.py`**

Move `web_search` (lines 417-465) and `translate_anime_title` (lines 468-500) from `pilgrimage_tools.py` to `web_tools.py`. Keep the `@pilgrimage_agent.tool` decorators — import `pilgrimage_agent` from `pilgrimage_agent.py`.

```python
"""Web-facing tool registrations (web_search, translate_anime_title).

Extracted from pilgrimage_tools.py to keep that file under 300 lines.
"""
from __future__ import annotations

from pydantic_ai import RunContext

from backend.agents.pilgrimage_agent import pilgrimage_agent
from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.translation import translate_title


@pilgrimage_agent.tool
async def web_search(
    ctx: RunContext[RuntimeDeps],
    *,
    query: str,
) -> str:
    # ... (move entire function body from pilgrimage_tools.py)


@pilgrimage_agent.tool
async def translate_anime_title(
    ctx: RunContext[RuntimeDeps],
    *,
    title: str,
    target_language: str,
) -> dict[str, object]:
    # ... (move entire function body from pilgrimage_tools.py)
```

- [ ] **Step 2: Import web_tools in runner to trigger registration**

In `backend/agents/pilgrimage_runner.py`, add:

```python
import backend.agents.web_tools as _web_tools  # noqa: F401
```

- [ ] **Step 3: Remove functions from pilgrimage_tools.py**

Delete the `web_search` and `translate_anime_title` functions from `pilgrimage_tools.py`.

- [ ] **Step 4: Run full test suite**

Run: `make check`
Expected: ALL PASS, `pilgrimage_tools.py` now under 350 lines

- [ ] **Step 5: Commit**

```bash
git add backend/agents/web_tools.py backend/agents/pilgrimage_tools.py backend/agents/pilgrimage_runner.py
git commit -m "refactor: extract web_search and translate_anime_title to web_tools.py"
```

---

### Task 8: Add message_history integration test

**Files:**
- Create: `backend/tests/unit/test_message_history_roundtrip.py`

- [ ] **Step 1: Write integration test**

```python
"""Integration test: message_history serialize → store → deserialize → use."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models.test import TestModel
from pydantic_core import to_jsonable_python

from backend.agents.pilgrimage_agent import pilgrimage_agent
from backend.interfaces.session_facade import build_message_history


def _build_session_with_messages(new_messages: list[ModelMessage]) -> dict[str, object]:
    """Build a fake session state containing serialized messages."""
    serialized = list(to_jsonable_python(new_messages))
    return {
        "interactions": [
            {
                "text": "test",
                "intent": "clarify",
                "status": "ok",
                "success": True,
                "context_delta": {},
                "new_messages": serialized,
            }
        ],
    }


class TestMessageHistoryRoundtrip:
    def test_serialize_deserialize_preserves_messages(self) -> None:
        """Messages survive JSON roundtrip through session storage."""
        from pydantic_ai import ModelMessagesTypeAdapter

        original: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="hello")]),
            ModelResponse(parts=[TextPart(content="hi there")]),
        ]
        serialized = list(to_jsonable_python(original))
        deserialized = ModelMessagesTypeAdapter.validate_python(serialized)

        assert len(deserialized) == 2
        assert isinstance(deserialized[0], ModelRequest)
        assert isinstance(deserialized[1], ModelResponse)

    def test_build_message_history_from_session(self) -> None:
        """build_message_history correctly collects from interactions."""
        messages: list[ModelMessage] = [
            ModelRequest(parts=[UserPromptPart(content="q1")]),
            ModelResponse(parts=[TextPart(content="a1")]),
        ]
        session = _build_session_with_messages(messages)
        history = build_message_history(session)
        assert len(history) == 2

    def test_empty_session_returns_empty_history(self) -> None:
        session: dict[str, object] = {"interactions": []}
        history = build_message_history(session)
        assert history == []

    def test_old_session_without_new_messages_returns_empty(self) -> None:
        """Sessions from before message_history feature return empty."""
        session: dict[str, object] = {
            "interactions": [
                {"text": "old", "intent": "search", "context_delta": {}}
            ]
        }
        history = build_message_history(session)
        assert history == []
```

- [ ] **Step 2: Run tests**

Run: `uv run pytest backend/tests/unit/test_message_history_roundtrip.py -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_message_history_roundtrip.py
git commit -m "test: message_history roundtrip integration tests"
```
