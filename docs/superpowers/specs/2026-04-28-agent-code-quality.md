# Agent Code Quality — Full Review Remediation

## Summary

Comprehensive review of all agent-related code identified 18 issues across
architecture, prompts, tools, tests, and eval. This spec covers all fixes,
ordered by severity.

Review sources: PydanticAI official `building-pydantic-ai-agents` skill,
Logfire traces (DeepSeek 400 error), E2E testing failures.

---

## P0 — Production Failures

### P0-1: `_sliding_window` breaks tool call/return pairs

**File:** `backend/agents/pilgrimage_agent.py:155-159`
**Impact:** DeepSeek returns 400 "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"

```python
# BROKEN — slices at arbitrary message boundary
def _sliding_window(messages):
    return messages[-COMPACT_THRESHOLD:]
```

PydanticAI docs warn: "When slicing the message history, you need to make sure
that tool calls and returns are paired."

**Fix:** Rewrite to slice on **turn boundaries**. A turn = UserPromptPart through
the next UserPromptPart (exclusive). Always include complete tool call + return pairs.

```python
from pydantic_ai.messages import ModelMessage, ModelRequest, UserPromptPart

def _sliding_window(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Keep last N messages, slicing on turn boundaries to preserve tool pairs."""
    if len(messages) <= COMPACT_THRESHOLD:
        return messages

    # Find turn boundaries (indices where UserPromptPart starts)
    turn_starts: list[int] = []
    for i, msg in enumerate(messages):
        if isinstance(msg, ModelRequest):
            if any(isinstance(p, UserPromptPart) for p in msg.parts):
                turn_starts.append(i)

    if not turn_starts:
        return messages[-COMPACT_THRESHOLD:]

    # Walk backwards from end, keeping complete turns until we exceed threshold
    keep_from = turn_starts[-1]
    for start in reversed(turn_starts):
        if len(messages) - start <= COMPACT_THRESHOLD:
            keep_from = start
        else:
            break

    return messages[keep_from:]
```

### P0-2: `_compress_request` drops ModelRequest fields

**File:** `backend/agents/pilgrimage_agent.py:136-142`
**Impact:** Loses `timestamp`, `instructions`, `run_id` — may cause provider errors.

```python
# BROKEN — only copies parts
return ModelRequest(parts=new_parts)
```

**Fix:** Copy all fields from original message, only replace parts.

```python
def _compress_request(msg: ModelRequest) -> ModelRequest:
    new_parts = [
        _compress_tool_return(p) if isinstance(p, ToolReturnPart) else p
        for p in msg.parts
    ]
    return ModelRequest(
        parts=new_parts,
        instructions=msg.instructions,
    )
```

Note: `ModelRequest` constructor accepts `parts` and `instructions`. `timestamp`
is auto-set if not provided. Check PydanticAI source for exact constructor signature.

### P0-3: Eval error guard ignores `report.failures`

**File:** `backend/tests/eval/test_agent_eval.py:349-356`
**Impact:** 615/617 cases crash, eval reports "100%" because failures are excluded from scoring.

```python
# BROKEN — only checks report.cases, not report.failures
errored = sum(1 for c in report.cases if c.output is None)
```

**Fix:**

```python
total = len(report.cases) + len(report.failures)
errored = len(report.failures)
error_rate = errored / total if total > 0 else 1.0
if error_rate > 0.20:
    pytest.fail(
        f"{errored}/{total} cases failed ({error_rate:.0%}). "
        "Check API key and model endpoint."
    )
```

Also validate baseline write — record `evaluated_count`:

```python
write_baseline(_LAYER, _EVAL_MODEL_ID, current_scores,
    case_count=len(CASES),
    evaluated_count=len(report.cases),
    errored_count=len(report.failures),
)
```

### P0-4: History processor tests don't test pair preservation

**File:** `backend/tests/unit/test_history_processors.py`
**Impact:** The exact bug (P0-1) is not caught by tests.

**Fix:** Add test that constructs a proper tool call/return pair, runs
`_sliding_window`, and verifies the pair stays intact. Also add a test that
a sliding window cut point never leaves an orphaned ToolReturnPart without
its preceding ToolCallPart.

---

## P1 — Should Fix This Iteration

### P1-5: plan_route can't read previous turn's search results

**Files:** `pilgrimage_tools.py:290-297`, `pilgrimage_runner.py:26-53`
**Impact:** User says "帮我规划路线" in Turn 3, agent sees history (knows it's 凉宫),
calls plan_route, but plan_route reads from `tool_state["search_bangumi"]` which is
empty (tool_state is per-request, `_seed_tool_state` only restores `last_search_data`
from session context_delta).

**Fix:** In `_seed_tool_state`, when `last_search_data` is present, also populate
`tool_state["search_bangumi"]` directly (not just under `last_search_data` key).
Currently the code does:

```python
raw = context.get("last_search_data")
for key in ("search_bangumi", "search_nearby"):
    value = raw.get(key)
    if isinstance(value, dict):
        deps.tool_state[key] = value
```

This expects `last_search_data` to be `{"search_bangumi": {...}}` (nested).
But `extract_context_delta` stores it as the raw search result dict directly.
Verify the structure matches.

### P1-6: Sub-agent silently swallows exceptions

**File:** `route_area_splitter.py:127-128`

```python
except Exception:
    return None  # Silent failure
```

**Fix:**

```python
except Exception:
    logger.warning("split_into_areas_failed", point_count=len(points), exc_info=True)
    return None
```

### P1-7: Eval max_concurrency too high

**File:** `test_agent_eval.py:341`

`max_concurrency=50` hammers external APIs, causing mass rate-limit failures.

**Fix:** `max_concurrency=10` with `retry_task={'stop': stop_after_attempt(2)}`

### P1-8: No integration test for message_history roundtrip

**Impact:** The serialize → store → deserialize → pass to agent chain is untested.

**Fix:** Add integration test that:
1. Calls `run_pilgrimage_agent(text="凉宫")` → get AgentResult with new_messages
2. Serializes `new_messages` with `to_jsonable_python`
3. Deserializes with `ModelMessagesTypeAdapter.validate_python`
4. Calls `run_pilgrimage_agent(text="涼宮ハルヒの憂鬱", message_history=deserialized)`
5. Verifies agent doesn't re-clarify (uses history context)

Use `TestModel` or `FunctionModel` to avoid real API calls.

### P1-9: Mutable default in clarify tool

**File:** `pilgrimage_tools.py:364`

```python
options: list[str] = []  # noqa: B006
```

**Fix:** Use `None` default and convert inside:

```python
options: list[str] | None = None
...
normalized_options = list(options) if options else []
```

---

## P2 — Follow-up

### P2-10: pilgrimage_tools.py exceeds 300 line limit

500 lines vs CLAUDE.md max 300. Extract `web_search` and `translate_anime_title`
into `backend/agents/web_tools.py`.

### P2-11: web_search blocks thread pool

`loop.run_in_executor` for sync DuckDuckGo. Should use async HTTP client or
add concurrency limit.

### P2-12: Generic error handling for ModelHTTPError

`public_api.py` `except Exception` shows "The runtime failed" for 502 errors.
Should catch `ModelHTTPError` specifically and return "AI service temporarily
unavailable, please retry."

### P2-13: Instructions complexity

Clarify rules (B4) are over-specified. Simplify to: `ambiguous=true → clarify`.
Remove "2-character query" heuristic.

### P2-14: Duplicate enrich_candidates tool

Both `clarify` tool (internal enrichment) and `enrich_candidates` tool (explicit)
exist. LLM might call both. Consider removing the explicit one.

### P2-15: _summarize_for_llm returns None

`pilgrimage_tools.py:148` — when `result.data` is None, returns None but return
type is `dict[str, object]`. Should return empty dict or the error fallback.

### P2-16: Eval baseline doesn't verify evaluated_count

`read_baseline` checks `case_count` matches dataset size but not how many cases
actually ran. Baseline created with 2/617 cases appears valid.

### P2-17: route_planner_agent no usage tracking

Sub-agent doesn't share `usage` with parent. Need architecture change to pass
RunUsage through handler chain.

### P2-18: Prompt instructions for multi-turn route planning

Instructions say "ALL THREE steps required" but with message_history, agent might
skip resolve+search (already done). Need conditional instructions: "If previous
search results exist in history, you may call plan_route directly."

---

## Implementation Order

| Phase | Issues | Effort |
|-------|--------|--------|
| Phase 1 | P0-1, P0-2, P0-4 (history processors) | S — 1 file + tests |
| Phase 2 | P0-3, P1-7, P2-16 (eval fixes) | S — 1 file |
| Phase 3 | P1-5, P2-18 (tool_state + instructions) | S — 2 files |
| Phase 4 | P1-6, P1-9, P2-15 (tool fixes) | S — 2 files |
| Phase 5 | P1-8 (integration test) | M — new test file |
| Phase 6 | P2-10, P2-11, P2-14 (cleanup) | M — file restructure |
| Phase 7 | P2-12, P2-13, P2-17 (error handling + instructions) | M |
