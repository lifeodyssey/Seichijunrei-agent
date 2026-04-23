# Backend → Frontend Journey Contract Alignment

**Status:** READY

## Context

PR #166 started as a backend RED-phase contract test PR, but the real issue is broader than a missing field. The frontend has already evolved into a chat-first, multi-stage product journey, while the backend public API still behaves mostly like a thin adapter over internal agent outputs.

The current frontend journey is:

1. User enters from landing/auth gate into a chat-first app shell.
2. User starts with a query, quick action, or popular anime chip.
3. Backend streams progress via SSE.
4. The UI branches into one of several frontend stages:
   - clarify (stay in chat)
   - search summary + result panel handoff
   - route planning result
   - QA / greeting
5. The result panel then supports exploration, point selection, and route decisions.

This means the real source of truth for the backend contract should no longer be the internal agent tool list alone. It should be the frontend stages that must render successfully.

The approved product direction from discussion is:
- Journey model: **hybrid-driven**
- Chat role: express intent, explain, clarify
- Result panel role: explore results, compare, select points, plan route
- Search handoff: **chat summarizes first, then panel takes over**
- Clarification: **must be resolved inside chat**, not by pushing the user into the panel
- Completion model: **depends on the query** — some searches end at discovery, some at route planning

## Problem Statement

The backend currently exposes internal outputs that are only partially translated into frontend-ready payloads.

The largest visible mismatch is the clarify stage:
- the frontend already supports a rich clarify bubble with `question`, `candidates[]`, and fallback `options[]`
- the backend clarify handler returns `question`, `options: list[str]`, and `status`, but `options` contains only plain string titles — no enriched candidate metadata
- the response builder (`response_builder.py:49-53`) uses a dict comprehension that only forwards `results` and `route` into `data` — clarify keys (`question`, `options`, `status`) are silently dropped
- the frontend currently receives clarify data only via SSE `step` events, not via the authoritative `done` response

As a result, the clarify stage is not a real supported frontend stage yet.

The deeper issues are structural:
- the agent runtime is internally valid
- but the public API has not yet become a journey-oriented application contract for the frontend
- the architecture follows a Plan-and-Execute pattern (ReActPlanner → deterministic ExecutorAgent) but lacks a **Solver step** — after execution completes, all user-facing messages come from static templates (`messages.py`) rather than LLM-generated summaries that reference execution results

## Goals

1. Make the backend public contract align with the frontend’s actual journey stages.
2. Make `clarify` a first-class frontend-supported stage.
3. Add a lightweight **Solver step** between executor and response builder so that `message` fields are LLM-generated from execution results, not static templates.
4. Preserve the existing planner → executor architecture; Solver is additive, not a rewrite.
5. Treat the public response layer as a journey-state translator, not a field picker.
6. Confirm that `route` already behaves like a complete completion state with `timed_itinerary`.
7. Use frontend-stage requirements, not agent-internal tool names, as the primary contract lens.

## Non-Goals

- No rewrite of the planner/executor ReAct architecture. The Solver is a new additive step, not a modification of the existing planner or executor.
- No full redesign of planner step schemas in this iteration.
- No broad rename of all intent aliases in this iteration.
- No full domain-model refactor into `ClarifyPayload`, `SearchPayload`, `RoutePayload` Python classes yet.
- No large frontend redesign work; the frontend journey is taken as already designed.
- Solver is not a general-purpose "chat agent" — it generates a single `message` string per response, nothing more.

## Frontend Stages as Contract Source of Truth

The backend contract should be evaluated against these frontend stages.

| Stage | Frontend expectation | Backend contract responsibility |
|---|---|---|
| Streaming in progress | Show step progress, then transition to final stage | SSE `step` and complete `done` envelope |
| Clarify in chat | Stay in chat, render question + selectable candidates | Return `clarify` payload in `data` |
| Search summary + panel handoff | Chat summarizes; panel receives full results | Return `message` + `data.results` + correct `ui.component` |
| Route result | Render route as a completion state | Return `data.route` including `timed_itinerary` |
| QA / greet | Render simple answer state | Return `message` and stable UI mapping |

## Required Stage Contracts

### 1. Streaming Stage

**Frontend needs:**
- `step` events for progress
- `done` event carrying a full final response
- `error` event for failure

**Required contract direction:**
- `step` remains progress-only
- `done` must be the authoritative final `RuntimeResponse`
- the frontend should not need to reconstruct the final state from partial events

**Note on current dual-path behavior:**
The frontend currently reads clarify data from both SSE `step` events (`tool: "clarify"`) and the final `done` event, merging them. After this PR, the `done` event must carry the complete, authoritative clarify payload so the frontend does not depend on step-event extraction for correctness.

### 2. Clarify Stage

Clarify is a conversation stage, not a panel stage.

**Frontend needs:**
- `intent = "clarify"`
- `message`
- `data.status = "needs_clarification"`
- `data.question`
- `data.candidates[]`
- optional `data.options[]` fallback

**Required minimal shape:**

```ts
{
  intent: "clarify",
  message: string,
  data: {
    status: "needs_clarification",
    question: string,
    candidates: Array<{
      title: string,
      cover_url: string | null,
      spot_count: number,
      city: string,
    }>,
    options?: string[],
  },
}
```

**Key design choice:**
- the planner continues deciding *that* clarification is needed
- the executor/handler enriches planner options into frontend-renderable candidates
- the planner is not responsible for fetching presentation metadata

### 3. Search Stage

Search is a handoff stage: chat summarizes, panel explores.

**Frontend needs:**
- `message` suitable for chat summary
- `data.results.rows[]`
- `row_count`
- stable row fields for grid/map/panel use
- nearby search must include `distance_m`
- `ui.component` should match the view the frontend should activate

**Required minimal shape:**

```ts
{
  intent: "search_bangumi" | "search_nearby",
  message: string,
  data: {
    results: {
      rows: PilgrimagePoint[],
      row_count: number,
      strategy?: string,
      status?: string,
    },
  },
  ui: {
    component: "PilgrimageGrid" | "NearbyMap",
  },
}
```

`PilgrimagePoint` must include the fields the frontend already consumes, including:
- `id`
- `name`
- optional `name_cn`
- `bangumi_id`
- optional `title` / `title_cn`
- optional `episode`
- optional `screenshot_url`
- `latitude`
- `longitude`
- optional `distance_m`

### 4. Route Stage

Route is the strongest completion state in the current journey.

**Frontend needs:**
- `data.route.ordered_points[]`
- `data.route.point_count`
- `data.route.timed_itinerary`

**Required minimal shape:**

```ts
{
  intent: "plan_selected" | "plan_route",
  message: string,
  data: {
    route: {
      ordered_points: PilgrimagePoint[],
      point_count: number,
      timed_itinerary: {
        stops: object[],
        legs: object[],
        total_minutes: number,
        total_distance_m: number,
        pacing?: string,
        export_google_maps_url?: string[],
        export_ics?: string,
      },
    },
  },
  ui: {
    component: "RoutePlannerWizard",
  },
}
```

**Decision:**
For journey purposes, `timed_itinerary` should be treated as part of the route stage contract, not as an optional enhancement.

### 5. QA / Greeting Stage

**Frontend needs:**
- simple answer rendering
- stable `message`
- explicit or compatible UI mapping

**Required minimal shape:**

```ts
{
  intent: "general_qa" | "greet_user",
  message: string,
  data: {},
}
```

If frontend routing does not explicitly support `greet_user`, the backend should ensure it maps to a compatible answer UI rather than falling into clarify-style fallback behavior.

## Current Gap Analysis

| Stage | Current backend state | Assessment |
|---|---|---|
| Streaming | Present, frontend already compensates for variations; clarify data consumed via SSE step merge | usable but dual-path should be normalized |
| Clarify | Handler returns `question`+`options`+`status` but response builder drops them; no `candidates` enrichment | **P0 gap** |
| Search | Search results are largely present and forwarded | mostly aligned |
| Route | `timed_itinerary` already appears to be generated and forwarded via `route` | likely aligned |
| QA / greeting | QA mostly aligned; greet mapping is weak | minor gap |
| Message generation | All stages use static templates from `messages.py`; no post-execution LLM synthesis | **P1 gap** — blocks chat-first journey |

## Recommended Scope for PR #166

This iteration should focus on making the existing frontend journey actually supportable without broad architectural churn.

### In Scope

1. **Make clarify a real supported stage**
   - enrich planner `options[]` into `candidates[]`
   - expose `question`, `options`, `candidates`, and `status` in `data`

2. **Add a lightweight Solver step (ReWOO Solver pattern)**
   - single LLM call after executor completes
   - generates context-aware `message` string from execution results
   - replaces static templates in `messages.py` for all journey stages

3. **Upgrade the response builder into a minimal stage translator**
   - not a full refactor
   - but enough to support clarify/search/route stage shaping explicitly

4. **Confirm route contract stability**
   - ensure `timed_itinerary` is treated as expected route-stage output

5. **Use tests as frontend-stage contract guards**
   - especially for clarify and route

### Out of Scope

1. Rewriting planner step schemas.
2. Full journey-oriented payload model extraction into new domain objects.
3. Broad frontend UI routing cleanup.
4. Intent taxonomy cleanup across the whole stack.

## File-Level Implementation Boundary

### Must change
- `backend/agents/handlers/answer_question.py` — clarify enrichment (add DB lookup for candidates)
- `backend/interfaces/response_builder.py` — stage-aware data shaping (expand `data` dict beyond `results`/`route`)
- `backend/interfaces/public_api.py` — Solver integration at `_execute_pipeline()` convergence point (line ~249), covers both ReAct and synthetic plan paths

### Must create
- `backend/agents/solver.py` — Solver step (single LLM call for message synthesis)

### Likely needs support changes
- `backend/infrastructure/supabase/repositories/bangumi.py` — candidate lookup by title (current `find_bangumi_by_title` returns ID only; needs enrichment fields: cover_url, city, points_count)
- `backend/agents/messages.py` — Solver replaces static templates; becomes fallback-only

### Not changed (originally listed but incorrect)
- `backend/agents/executor_agent.py` — NOT the Solver integration point. Production path goes through `pipeline.py:run_pipeline()`, and both paths converge at `public_api.py:_execute_pipeline()` which is the correct single integration point.

### Validate but do not broaden unless necessary
- `backend/agents/pipeline.py` — no structural changes needed; Solver integrates at the caller level (`public_api.py`), not inside the pipeline
- `backend/agents/handlers/_helpers.py`
- `backend/agents/route_optimizer.py`
- `backend/interfaces/routes/bangumi.py`

## Implementation Strategy

### 1. Clarify enrichment happens in executor/handler layer

**Decision:** keep the planner simple.

- planner decides whether clarification is needed
- planner still emits question + option titles
- handler uses deterministic DB lookup to enrich those option titles into renderable `candidates[]`

This preserves the current architecture boundary:
- planner = decision
- executor = deterministic retrieval / shaping

### 2. Solver step generates context-aware messages (ReWOO Solver pattern)

**Architecture context:** Our current pipeline follows a Plan-and-Execute pattern (closest to ReWOO) but lacks the Solver — the third phase that takes all execution results and generates the user-facing answer via a single LLM call.

**Current flow:**
```
ReActPlanner (LLM) → ExecutorAgent (deterministic) → static templates → ResponseBuilder
```

**New flow:**
```
ReActPlanner (LLM) → ExecutorAgent (deterministic) → Solver (LLM) → ResponseBuilder
```

**Solver responsibilities:**
- Input: `intent`, structured execution data (search rows / route / clarify candidates), original query, locale
- Output: a single `message` string — the chat-facing natural language response
- No tool calls, no decisions, no data structure changes — synthesis only
- One LLM call per request (lightweight, focused prompt)

**Why not let the planner generate the message?**
The planner receives only summarized `Observation` objects (e.g., "Found 5 spots") — not enough data to write "在长野县找到了5处《你的名字》取景地". Pushing full result data into planner context would bloat tokens and pollute decision-making.

**Fallback:** If the Solver call fails (timeout, LLM error), fall back to the existing static template from `messages.py`. The Solver is additive — its failure should not break the pipeline.

**Stage-specific message expectations:**

| Stage | Solver input | Expected message quality |
|---|---|---|
| Clarify | enriched candidates (title, spot_count, city) | Reference candidate details: "你是指《忧郁》（12处，西宫市）还是《消失》（8处）？" |
| Search | result rows (names, locations, count) | Contextual summary: "在长野县找到了5处《你的名字》取景地" |
| Route | timed_itinerary (stops, total_minutes, distance) | Route narrative: "从秋叶原出发5站，全程4.2km，步行约50分钟" |
| QA / greet | original query | Natural answer (same as current planner-generated answer) |

### 3. Response builder becomes a minimal stage-aware adapter

Instead of only copying `results` and `route`, the response builder should start shaping `data` based on the resolved frontend stage.

Minimum expected behavior:
- clarify → `question/options/candidates/status`
- search → `results`
- route → `route`
- qa/greet → empty `data`

## Acceptance Criteria

The backend should be considered to have begun supporting the frontend journey when all of the following hold:

### A. Clarify stage is fully valid
For an ambiguous query such as “凉宫”:
- `intent == "clarify"`
- `message` exists
- `data.status == "needs_clarification"`
- `data.question` exists
- `data.candidates[]` exists and is frontend-renderable
- `data.options[]` remains available for fallback compatibility

### B. Search stage supports summary + handoff
For a clear anime or nearby search:
- chat can display a summary via `message`
- panel can render from `data.results.rows[]`
- nearby rows consistently include `distance_m`
- UI mapping remains consistent with current frontend expectations

### C. Route stage is a complete completion state
For route requests or selected-point route planning:
- `data.route.ordered_points[]` exists
- `data.route.point_count` exists
- `data.route.timed_itinerary` exists with `stops`, `legs`, `total_minutes`, `total_distance_m`

### D. Messages are context-aware (Solver)
For all journey stages, the `message` field should be a Solver-generated summary that references execution data, not a static template.
- clarify message references candidate metadata (spot count, city)
- search message references result context (location, anime title)
- route message references itinerary data (distance, time, stop count)
- if Solver fails, static template from `messages.py` is used as fallback

### E. SSE semantics remain stage-safe
- `step` = progress only
- `done` = authoritative final response (includes Solver-generated message)
- frontend can transition to clarify/search/route without reconstructive guesswork

## Implementation Order

### Step 1 — Clarify source data
Start by fixing the clarify handler and any required repository support so that the handler itself emits:
- `question`
- `options`
- `candidates` (enriched via DB lookup)
- `status`

### Step 2 — Solver step
Add `backend/agents/solver.py` with a single-responsibility LLM call:
- receives intent + execution data + query + locale
- returns a `message` string
- graceful fallback to static template on failure
- integrate into `public_api.py:_execute_pipeline()` at the convergence point (after both pipeline paths produce `PipelineResult`, before `pipeline_result_to_public_response()`)

### Step 3 — Response builder shaping
Update the response builder to expose clarify/search/route stage payloads correctly through `data`. The `message` field now comes from the Solver.

### Step 4 — Route verification
Confirm that route-stage responses consistently include `timed_itinerary`, and treat absence as a contract problem rather than an optional enhancement.

### Step 5 — Contract tests as stage validation
Use the PR #166 contract tests to validate that clarify, nearby, and route now behave as frontend stages, not just backend tool outputs. Include assertions that `message` is non-empty and contextually relevant (not a static template).

## Risks

1. **Scope creep** — clarify fixes can easily turn into a broader contract refactor. This iteration must stay focused.
2. **Planner schema temptation** — it will be tempting to upgrade planner clarify output immediately. That should be deferred.
3. **Partial journey support** — if clarify is enriched but response shaping stays weak, the stage still will not fully hold.
4. **False confidence from existing route code** — route appears healthy, but should still be validated against actual frontend contract needs.
5. **Solver latency** — adds one LLM call to the pipeline. Must be fast (small prompt, no tools). If latency is unacceptable, consider streaming the Solver output as a separate SSE event, or making the Solver async and letting the frontend render data first, message second.
6. **Solver over-engineering** — the Solver must remain a single-purpose message generator. Resist the temptation to have it modify data structures, make decisions, or become a second planner.

## Success Definition

This work succeeds if the backend public API meaningfully shifts from:
- exposing internal agent outputs with thin translation and static template messages

to:
- supplying stable, frontend-stage-oriented contracts for clarify, search, and route
- with context-aware, LLM-generated messages that support the chat-first journey

The architecture threshold: the pipeline evolves from Plan-and-Execute (missing Solver) to a complete ReWOO-style flow (Planner → Executor → Solver), where each component has a clear single responsibility:
- **Planner:** decides what to do
- **Executor:** does it deterministically
- **Solver:** explains what happened to the user
