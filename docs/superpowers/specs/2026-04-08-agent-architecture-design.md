# Agent Architecture v2: Full LLM ReAct with Proper Recovery

**Status:** LANDED

> **Update (2026-04-11):** All components implemented: intent classifier, result_validator, step dependency graph, failure recovery, streaming thought display. All 3 deterministic guards removed. Architecture fully deployed and verified in production.

## Context

The current ReAct pipeline has a foundational flaw: it aborts on any step failure instead of letting the planner recover. This cascades into 3 bolted-on deterministic guards, duplicate results, broken route planning, and invisible reasoning. Session testing revealed 8 architecture-level issues (issue #60).

**Current architecture problems:**
1. ReAct loop aborts on step failure (pipeline.py:232-239) — no retry, no recovery
2. 3 overlapping guards bypass the planner — fragile, non-composable
3. Step dependencies are implicit — plan_route silently fails when search hasn't run
4. User sees tool names + checkmarks, not reasoning
5. Eval reads plan.steps (always []) — zero coverage of ReAct behavior
6. Every query makes 2-3 sequential Gemini 2.5 Pro calls ($0.02, 8-15 seconds)

**Design decisions from /office-hours:**
- Keep full LLM for all queries (not hybrid deterministic)
- Streaming hybrid visibility: natural language thoughts + tool progress
- Intent classifier for known patterns, planner for novel queries

## Architecture

```
User query
    ↓
Intent Classifier (deterministic regex + keyword matching)
    ↓ (high confidence: tag directly)
    ↓ (low confidence: let planner disambiguate)
    ↓
ReAct Planner (Gemini 2.5 Pro + Pydantic AI)
    ↓ result_validator checks:
    ↓   - reject done if required steps missing
    ↓   - reject action if prerequisites unmet
    ↓   - retry with feedback (up to 2 retries)
    ↓
Step Dependency Check (declarative graph)
    ↓ prerequisites met? → execute
    ↓ prerequisites unmet? → validator tells planner "do X first"
    ↓
Executor (deterministic handler dispatch)
    ↓ success → add to context, continue
    ↓ failure → create failure observation → feed to planner
    ↓ max 2 consecutive failures → hard stop
    ↓
SSE Streaming to User
    ↓ thought: natural language (planner's reasoning)
    ↓ step: tool name + status + compact progress
    ↓ done: final message + data
```

## Component Design

### 1. Intent Classifier

**Location:** `backend/agents/intent_classifier.py` (new file)

```python
class QueryIntent(str, Enum):
    ANIME_SEARCH = "anime_search"
    NEARBY_SEARCH = "nearby_search"
    ROUTE_PLAN = "route_plan"
    QA = "qa"
    GREETING = "greeting"
    AMBIGUOUS = "ambiguous"

def classify_intent(query: str, locale: str) -> tuple[QueryIntent, float]:
    """Classify query intent with confidence score.

    Returns (intent, confidence). If confidence < 0.7, returns AMBIGUOUS.
    """
```

**Implementation:** Keyword matching + regex patterns from the planner prompt rules (line 50-56). No LLM call. ~1ms.

**When confidence >= 0.7:** Pass intent tag to the ReAct loop as context. The `result_validator` uses this to enforce step completion.

**When confidence < 0.7 (AMBIGUOUS):** The planner's first thought disambiguates. The `result_validator` waits for the first action to infer intent.

### 2. Pydantic AI result_validator

**Location:** `backend/agents/planner_agent.py`

Replace all 3 deterministic guards with one native Pydantic AI validator:

```python
@step_agent.result_validator
async def validate_react_step(ctx: RunContext[ReActDeps], result: ReactStep) -> ReactStep:
    history = ctx.deps.history
    intent = ctx.deps.classified_intent

    # 1. Reject premature "done" when required work isn't complete
    if result.done is not None:
        has_search = any(o.tool in ("search_bangumi", "search_nearby") and o.success for o in history)
        needs_search = intent in (QueryIntent.ANIME_SEARCH, QueryIntent.ROUTE_PLAN)

        if needs_search and not has_search:
            raise ModelRetry(
                "You resolved the anime but haven't searched for spots yet. "
                "Call search_bangumi with the bangumi_id from your resolve_anime observation."
            )

        has_route = any(o.tool == "plan_route" and o.success for o in history)
        if intent == QueryIntent.ROUTE_PLAN and not has_route and has_search:
            raise ModelRetry(
                "The user asked for a route but you only searched for spots. "
                "Call plan_route with the search results."
            )

    # 2. Reject actions with unmet prerequisites
    if result.action is not None:
        tool = result.action.tool
        deps = STEP_DEPENDENCIES.get(tool, [])
        for dep in deps:
            if not any(o.tool == dep.value and o.success for o in history):
                raise ModelRetry(
                    f"{tool.value} requires {dep.value} to run first. "
                    f"Call {dep.value} before {tool.value}."
                )

    return result
```

**Key advantage:** The LLM gets natural language feedback ("you haven't searched yet") and retries with understanding, rather than the pipeline silently injecting steps it didn't ask for.

### 3. Step Dependency Graph

**Location:** `backend/agents/models.py`

```python
STEP_DEPENDENCIES: dict[ToolName, list[ToolName]] = {
    ToolName.SEARCH_BANGUMI: [ToolName.RESOLVE_ANIME],
    ToolName.PLAN_ROUTE: [ToolName.SEARCH_BANGUMI],
    ToolName.PLAN_SELECTED: [],
    ToolName.SEARCH_NEARBY: [],
    ToolName.RESOLVE_ANIME: [],
    ToolName.GREET_USER: [],
    ToolName.ANSWER_QUESTION: [],
    ToolName.CLARIFY: [],
}
```

Declarative, not imperative. The `result_validator` reads this graph to validate prerequisites. No guards needed.

### 4. Failure Recovery in ReAct Loop

**Location:** `backend/agents/pipeline.py`

Replace the early return with observation feedback:

```python
# In react_loop, when step fails:
if not step_result.success:
    failure_count += 1
    if failure_count >= MAX_CONSECUTIVE_FAILURES:
        yield ReactStepEvent(type="error", message="Too many failures. Please try again.")
        return

    # Feed failure observation back to planner
    fail_obs = ExecutorAgent.format_observation(step_result)
    history.append(fail_obs)

    yield ReactStepEvent(
        type="step", tool=tool_name, status="failed",
        thought=f"Step failed: {step_result.error}",
        observation=fail_obs.summary,
    )
    continue  # planner will see the failure and decide what to do
```

### 5. Streaming Thought Display

**Location:** `frontend/components/chat/ThinkingProcess.tsx` (rewrite)

Replace tool-name checkmarks with natural language thoughts:

```
Current:   🔍 resolve_anime ✓
           📍 search_bangumi ✓

Proposed:  "Your Name の聖地を検索しています..."
           🔍 タイトル解決中... ✓ (bangumi_id: 262243)
           📍 111件の聖地を取得中... ✓
           "111件見つかりました！地図に表示します。"
```

The planner's `thought` field is the user-facing message. Tool steps appear as compact sub-items. Failed steps show in red with the error.

**SSE event format change:**
```json
{"event": "step", "thought": "Your Name の聖地を検索しています...", "tool": "resolve_anime", "status": "running"}
{"event": "step", "thought": "", "tool": "resolve_anime", "status": "done", "observation": "Resolved to bangumi_id=262243"}
{"event": "step", "thought": "111件の聖地が見つかりました。", "tool": "search_bangumi", "status": "done"}
```

### 6. Remove All Deterministic Guards

Delete these code blocks from `pipeline.py`:
- Lines 74-126: post-done search_bangumi injection guard
- Lines 143-199: pre-execution resolve_anime injection guard

These are replaced by the `result_validator` which achieves the same goal through the LLM rather than around it.

## Migration Plan

### Phase 1: Foundation (no behavior change)
- Add `intent_classifier.py`
- Add `STEP_DEPENDENCIES` to `models.py`
- Add `result_validator` to step agent (alongside existing guards)
- Add `failure_count` and `continue` on failure in react_loop

### Phase 2: Cutover
- Remove all 3 deterministic guards
- Verify `result_validator` catches all cases guards caught
- Run eval (160 cases) against both versions, compare scores

### Phase 3: User Visibility
- Rewrite `ThinkingProcess.tsx` for streaming thoughts
- Update SSE event format to include `thought` field
- Update `MessageBubble.tsx` to show thoughts above tool steps

### Phase 4: Eval-Driven Verification
- Run 160 eval cases with both gemini-2.5-pro and local model
- Gate: score >= baseline for all 4 evaluators
- Add specific cases for: failure recovery, route after search, premature done rejection

## Success Criteria

1. "plan a route for Your Name from Shinjuku" → planner recovers from initial plan_route failure → resolve → search → plan_route → RoutePlannerWizard renders
2. Zero deterministic guards in pipeline.py (all replaced by result_validator)
3. User sees natural language thoughts during processing, not tool names
4. Eval score >= baseline on all 160 cases
5. No duplicate results (guard double-fire eliminated)

## Open Questions

1. Should the intent classifier use a small LLM (gemini-2.0-flash) instead of regex for better accuracy on multilingual queries?
2. Should the planner prompt include explicit step recipes for common intents (e.g., "for anime search: always resolve → search")?
3. How to handle the transition period: run validator + guards in parallel until confident validator catches everything?

## Dependencies

- Pydantic AI `result_validator` requires the step agent to use `deps` parameter for context injection
- SSE event format change requires frontend + backend coordinated deploy
- Eval harness must be working (issue #48) before Phase 2 cutover
