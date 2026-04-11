# BUG-03 + BUG-03b: Route Planning Empty Response & Clarify Rendering

**Status:** IN PROGRESS (Wave 1 merged, Waves 2-3 pending)

> **Update (2026-04-11):** Wave 1 complete: PR #80 (session_facade context delta) and PR #81 (clarify SSE forward) both merged. Wave 2 (Card 2 + Card 5) and Wave 3 (Card 3 + Card 6) remaining.

## Context

QA testing revealed two related bugs in the route planning flow:

1. **BUG-03**: When a user asks for a route after a previous search (e.g., "show spots for Liz and the Blue Bird" then "plan a route"), the pipeline returns an empty response with `success=False`. Root cause is a 5-layer cascading failure where session search results are not injected into the executor context, the planner validator rejects `plan_route` because `search_bangumi` is missing from the current turn's history, and the handler falls back to empty rows.

2. **BUG-03b**: When `plan_route` returns a clarify response (e.g., ambiguous origin station), the frontend silently drops it. The SSE stream emits a `clarify` event type but the frontend only handles `step`, `done`, and `error` events. The `QAData` type and `isQAData` guard already support `needs_clarification` status but nothing renders it.

## Goals

- Multi-turn route planning works: user searches in turn 1, requests route in turn 2, gets a valid route
- Clarification responses from `plan_route` (ambiguous origin) render as interactive question bubbles in chat
- No regressions to single-turn flows (search + route in one request)

## Non-Goals

- Changing the ReAct planner's LLM prompt or model
- Adding new tools to the executor
- Redesigning the session state schema
- Supporting clarification for tools other than `plan_route` (future iteration)

## Architecture

### BUG-03 fix: Session context injection

The context block built by `build_context_block()` in `session_facade.py` already extracts `current_bangumi_id` and `last_location` from session history. The fix requires two changes:

1. **`pipeline.py:56-58`** -- When `context` contains `current_bangumi_id`, seed `executor_context` with a synthetic `search_bangumi` entry so `plan_route` handler finds rows. This requires the context block to also carry the last successful `search_bangumi` result data.

2. **`session_facade.py` (extract_context_delta)** -- Persist the `search_bangumi` step result data in the interaction's `context_delta` so it survives across turns. Currently only `bangumi_id`, `anime_title`, and `location` are saved.

3. **`planner_agent.py:263-271`** -- The validator checks `history` (current turn observations) for prerequisites. When session context already satisfies a dependency (e.g., `search_bangumi` data exists in `executor_context`), the validator must accept it.

### BUG-03b fix: Clarify event rendering

The `react_loop` already yields `ReactStepEvent(type="clarify", ...)` at `pipeline.py:154-166`. Two layers drop it:

1. **`pipeline.py:201` (run_pipeline)** -- The `on_step` callback fires only for `event.type == "step"`. The `clarify` event must also be forwarded so SSE emits it.

2. **`frontend/lib/api.ts:251-272` (consume)** -- The SSE consumer ignores `clarify` events. It must handle `event === "clarify"` and surface the data to the chat UI.

3. **`frontend/components/chat/MessageBubble.tsx`** -- Must render `needs_clarification` status as a question bubble with selectable options.

## Task Breakdown

### Task 1: Persist search results in session context delta

- **Scope:** Extend `extract_context_delta` to save `search_bangumi` / `search_nearby` result data alongside existing `bangumi_id` / `anime_title`. Extend `build_context_block` to reconstruct it.
- **Files changed:**
  - `backend/interfaces/session_facade.py` (extract_context_delta, build_context_block)
- **AC:**
  - [ ] Happy path: After a successful `search_bangumi` step, `extract_context_delta` returns a dict containing `last_search_data` with the full search result payload -> unit
  - [ ] Happy path: `build_context_block` reconstructs `last_search_data` from the most recent interaction's `context_delta` -> unit
  - [ ] Null/empty: When no search step exists in results, `extract_context_delta` returns delta without `last_search_data` key -> unit
  - [ ] Null/empty: When session has no interactions, `build_context_block` returns None (existing behavior preserved) -> unit
  - [ ] Error path: When `context_delta.last_search_data` is malformed (not a dict), `build_context_block` ignores it gracefully -> unit

### Task 2: Inject session search data into executor context

- **Scope:** At pipeline startup, seed `executor_context` with session's last search results so `plan_route` handler can find rows without re-executing `search_bangumi`.
- **Files changed:**
  - `backend/agents/pipeline.py` (react_loop, lines 56-58)
- **AC:**
  - [ ] Happy path: When `context` contains `last_search_data` with tool `search_bangumi`, `executor_context["search_bangumi"]` is pre-populated before the first turn -> unit
  - [ ] Happy path: When `context` contains `last_search_data` with tool `search_nearby`, `executor_context["search_nearby"]` is pre-populated -> unit
  - [ ] Null/empty: When `context` is None or has no `last_search_data`, executor_context only contains `locale` (existing behavior) -> unit
  - [ ] Error path: When `last_search_data` is present but `rows` is empty list, executor_context is still seeded (plan_route will handle empty rows with its own error) -> unit

### Task 3: Update planner validator to accept session-satisfied dependencies

- **Scope:** The output validator at `planner_agent.py:263-271` rejects actions whose dependencies aren't in the current turn's `history`. It must also accept dependencies that are already satisfied by session context (i.e., data exists in `executor_context`).
- **Files changed:**
  - `backend/agents/planner_agent.py` (output_validator, ~line 262-271)
  - `backend/agents/pipeline.py` (pass context to planner so validator can check it)
- **AC:**
  - [ ] Happy path: When session context has `search_bangumi` data and planner emits `plan_route`, validator accepts without `ModelRetry` -> unit
  - [ ] Happy path: Single-turn flow (search + route in same request) still works -- validator accepts `plan_route` when `search_bangumi` is in current history -> integration
  - [ ] Null/empty: When no session context and no history entry for dependency, validator raises `ModelRetry` (existing behavior preserved) -> unit
  - [ ] Error path: When session context key exists but is None/empty, validator still rejects (dependency not truly satisfied) -> unit

### Task 4: Forward clarify events through run_pipeline to SSE

- **Scope:** The `run_pipeline` wrapper must forward `clarify` events via `on_step` so the SSE endpoint emits them. Also set the correct intent and status on the `PipelineResult`.
- **Files changed:**
  - `backend/agents/pipeline.py` (run_pipeline function, lines 194-261)
- **AC:**
  - [ ] Happy path: When react_loop yields a `clarify` event, `on_step` is called with tool="clarify" and data containing `question` and `options` -> unit
  - [ ] Happy path: `PipelineResult` for a clarify flow has `intent="clarify"` and `final_output.status="needs_clarification"` -> unit
  - [ ] Null/empty: When no clarify event occurs, pipeline behavior is unchanged -> unit
  - [ ] Error path: When `on_step` is None and clarify event fires, no crash (graceful skip) -> unit

### Task 5: Handle clarify SSE event in frontend API layer

- **Scope:** The `sendMessageStream` consumer must handle `event === "clarify"` by treating it as a `done` event with `status: "needs_clarification"` so the response reaches the chat UI.
- **Files changed:**
  - `frontend/lib/api.ts` (consume function, ~line 247-274)
- **AC:**
  - [ ] Happy path: When SSE emits `event: clarify` with `{question, options, status}`, `sendMessageStream` resolves with a `RuntimeResponse` where `status === "needs_clarification"` and `data` contains the question/options -> unit
  - [ ] Null/empty: When SSE emits `event: clarify` with empty options array, response still resolves (empty options is valid) -> unit
  - [ ] Error path: When clarify payload is malformed JSON, stream error is thrown (existing JSON parse error path) -> unit

### Task 6: Render clarification bubble in MessageBubble

- **Scope:** When a response has `status === "needs_clarification"` and `data` matches `QAData` with clarification fields, render a question with tappable option buttons that re-send the selected option as user input.
- **Files changed:**
  - `frontend/components/chat/MessageBubble.tsx`
  - `frontend/hooks/useChat.ts` (minor: accept `onOptionSelect` or re-use `send`)
- **AC:**
  - [ ] Happy path: When response has `status="needs_clarification"` and `data.options=["Tokyo Station", "Tokyo Tower"]`, message bubble renders question text and two option buttons -> browser
  - [ ] Happy path: Tapping an option button sends the selected text as a new user message -> browser
  - [ ] Null/empty: When `data.options` is empty or missing, message renders question text only without buttons -> browser
  - [ ] Error path: When `data.question` is missing, falls back to generic message text from response -> browser
  - [ ] i18n: Clarification question text comes from backend (already localized by `plan_route` handler) -- no new i18n keys needed, verify Japanese renders correctly -> browser

## Verification Plan

1. **Unit tests**: Tasks 1-4 each have unit tests covering happy, null, and error paths
2. **Integration test**: Multi-turn route planning scenario:
   - Turn 1: "リズと青い鳥の聖地を教えて" -> returns search results
   - Turn 2: "ルートを作って" -> returns valid route (not empty)
3. **Browser test**: Clarification rendering:
   - Trigger ambiguous origin in route plan -> see question bubble with options
   - Tap option -> new message sent
4. **Regression**: Existing single-turn route tests still pass (`make test`)

## Dependencies

- No external dependencies or migrations
- Tasks 1-3 are sequential (session delta -> context injection -> validator update)
- Task 4 can proceed in parallel with Tasks 1-3
- Tasks 5-6 depend on Task 4 (need clarify events to reach frontend)

## Risk Assessment

- **Session data size**: Persisting full `search_bangumi` result data in session could bloat session storage. Mitigated by the existing `compact_session_interactions` mechanism that prunes old interactions.
- **Validator bypass**: Accepting session context as satisfied dependencies could let the planner skip necessary re-searches when data is stale. Mitigated by only seeding from the most recent interaction's search data, not arbitrary history.
- **Frontend type safety**: The `RuntimeResponse` type union (`SearchResultData | RouteData | QAData`) already includes `QAData` with `needs_clarification`, so no type changes needed. Risk is low.
- **Backward compatibility**: The SSE `clarify` event is already emitted by the backend but ignored by the frontend. Adding a handler is additive, no breaking changes.
