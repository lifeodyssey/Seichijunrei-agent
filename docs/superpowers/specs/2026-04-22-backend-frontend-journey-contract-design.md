# Backend → Frontend Journey Contract Alignment

**Status:** READY

## Context

PR #166 started as a backend RED-phase contract test PR, but the actual problem is broader than a missing field. The frontend has already evolved into a chat-first, multi-stage product journey, while the backend runtime still reflects an older split architecture:

- deterministic intent classifier
- ReAct planner loop
- deterministic executor
- thin response adapter

That architecture is internally valid, but it is now fighting two things at once:

1. the frontend journey contract
2. the way PydanticAI is intended to be used

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

The approved product direction from discussion is:
- Journey model: **hybrid-driven**
- Chat role: express intent, explain, clarify
- Result panel role: explore results, compare, select points, plan route
- Search handoff: **chat summarizes first, then panel takes over**
- Clarification: **must be resolved inside chat**, not by pushing the user into the panel
- Completion model: **depends on the query** — some searches end at discovery, some at route planning

## Problem Statement

The current backend has two distinct problems.

### 1. Contract mismatch with the frontend

The largest visible mismatch is the clarify stage:
- the frontend already supports a rich clarify bubble with `question`, `candidates[]`, and fallback `options[]`
- the backend clarify path only reliably exposes `question`, `options`, and `status`
- the current public response shaping drops clarify payload fields from `data`
- the frontend currently compensates by reading clarify information from SSE step events, not from a complete authoritative final response

As a result, clarify is not a fully supported backend contract yet.

Search and route are closer to correct, but they still have backend-first shape rather than frontend-stage shape.

### 2. Runtime architecture mismatch with the intended PydanticAI usage

The current runtime uses PydanticAI primarily as a structured-output LLM wrapper inside a custom orchestration stack.

In practice, the main workflow is split across:
- `backend/agents/planner_agent.py`
- `backend/agents/pipeline.py`
- `backend/agents/executor_agent.py`
- `backend/interfaces/response_builder.py`

This makes the system feel awkward for three reasons:
- deterministic tools live outside the main PydanticAI agent abstraction
- message generation is not naturally coupled to tool results
- frontend-stage contract shaping is treated as a post-processing concern instead of a first-class runtime output

If PR #166 is meant to align the backend to the actual frontend journey, the cleanest direction is **not** to bolt on another layer such as a separate Solver. The cleanest direction is to migrate the runtime toward a more idiomatic PydanticAI structure:

- one main agent
- deterministic capabilities exposed as tools
- typed output models for stage contracts
- thin application-layer orchestration for session, SSE, and persistence

## Architectural Decision

### Decision: PR #166 adopts a PydanticAI-native runtime direction

PR #166 should **not** add a separate Solver layer.

Instead, it should move the runtime toward this structure:

```text
Public API / Session / SSE
          │
          ▼
single pilgrimage_agent
    ├── deterministic tools
    ├── tool-driven reasoning / clarification
    └── typed final stage output
          │
          ▼
thin response adapter / transport
```

This is the important shift:

### From

```text
classifier → ReAct planner → deterministic executor → response builder
```

### To

```text
public_api → pilgrimage_agent.run(...) → typed stage output → transport response
```

## Why This Direction Is Cleaner

### 1. It fits the frontend better

The frontend needs one authoritative final state per turn:
- clarify
- search
- route
- QA / greeting

A single PydanticAI agent that calls tools and then directly emits a typed final response is a better fit for that requirement than a split planner/executor/runtime with extra synthesis layers.

### 2. It fits PydanticAI better

PydanticAI is strongest when used as:
- one agent
- typed deps
- deterministic `@tool` functions
- typed output model(s)

That is closer to the official examples and easier to reason about than the current custom loop + external dispatcher structure.

### 3. It removes the need for a separate Solver

Once the main agent itself can see deterministic tool results and then emit the final typed response, a separate Solver is redundant.

Message synthesis becomes a natural part of the final model output, not an extra architectural phase.

## Goals

1. Make the backend public contract align with the frontend’s actual journey stages.
2. Make `clarify` a first-class frontend-supported stage.
3. Migrate the runtime toward a **single main PydanticAI agent with deterministic tools**.
4. Make typed stage outputs the source of truth for clarify/search/route/qa/greeting behavior.
5. Keep session, SSE, persistence, and transport concerns in the application layer.
6. Confirm that `route` behaves like a complete completion state with `timed_itinerary`.
7. Use frontend-stage requirements, not internal tool names, as the primary contract lens.
8. Add eval coverage so this migration is safe rather than aspirational.

## Non-Goals

- No additional outer `IntentAgent` layer.
- No separate Solver layer.
- No full rewrite of persistence, session compaction, or route history storage.
- No broad frontend redesign work; the frontend journey is taken as already designed.
- No large taxonomy cleanup across every old runtime helper in this PR.
- No requirement that the external HTTP schema immediately become a typed union at the transport layer; typed unions are required first at the agent/runtime output layer.

## Frontend Stages as Contract Source of Truth

The backend contract should be evaluated against these frontend stages.

| Stage | Frontend expectation | Backend contract responsibility |
|---|---|---|
| Streaming in progress | Show step progress, then transition to final stage | SSE `step` and complete `done` envelope |
| Clarify in chat | Stay in chat, render question + selectable candidates | Return complete clarify payload in final response |
| Search summary + panel handoff | Chat summarizes; panel receives full results | Return `message` + `data.results` + correct `ui.component` |
| Route result | Render route as a completion state | Return `data.route` including `timed_itinerary` |
| QA / greet | Render simple answer state | Return `message` and stable UI mapping |

## API Surface to Review and Update

The frontend does not call an abstract "backend". It currently depends on a small concrete API surface:

### Core runtime APIs
- `POST /v1/runtime`
- `POST /v1/runtime/stream`

These two endpoints power nearly all user-journey transitions:
- chat query
- clarify
- search handoff
- route creation
- selected-point route creation

### Supporting APIs
- `GET /v1/bangumi/popular` — welcome screen anime chips and cover row
- `GET /v1/conversations` — conversation drawer list
- `GET /v1/conversations/{session_id}/messages` — session hydration
- `PATCH /v1/conversations/{session_id}` — rename conversation
- `GET /v1/routes` — route history

The runtime migration must be designed against these concrete endpoints, not only against internal Python modules.

## Frontend-Derived Data Currently Guessed in UI

The frontend is currently rendering some real states with guessed, hardcoded, or fallback-derived data. Those should be pulled back into backend-owned contract where appropriate.

### 1. Clarify candidates are sometimes synthetic

Current frontend behavior:
- if `candidates[]` is missing, `Clarification.tsx` converts `options[]` into synthetic candidates with:
  - `cover_url = null`
  - `spot_count = 0`
  - `city = ""`

This is a useful fallback, but it should not be the normal contract path.

**Backend-owned target:**
- final clarify response should normally include real `candidates[]`
- frontend synthetic candidates remain fallback-only

### 2. Nearby radius is currently hardcoded in UI

Current frontend behavior:
- `NearbyBubble.tsx` currently hardcodes `const radius = "1km"`

**Backend-owned target:**
- nearby responses should include the actual search radius in machine-readable form, e.g. `radius_m`
- frontend formats the label from backend-provided value instead of assuming `1km`

### 3. Nearby anime grouping is currently guessed from point rows

Current frontend behavior:
- `NearbyBubble.tsx` groups `results.rows[]` into anime cards in the UI
- the card image is currently derived from `firstPoint.screenshot_url`, which is a point screenshot, not true anime cover metadata
- the closest distance is computed on the client from row distances

**Backend-owned target:**
- nearby responses should expose explicit anime-level aggregation for bubble/card rendering, for example:
  - `nearby_groups[]`
  - `bangumi_id`
  - `title`
  - `cover_url`
  - `points_count`
  - `closest_distance_m`

This allows the frontend to render nearby suggestion cards without reverse-engineering them from row-level data.

### 4. Search-level anime metadata is currently inferred from the first row

Current frontend behavior:
- `PilgrimageGrid.tsx` derives the main anime title from `results.rows[0]`

**Backend-owned target:**
- search responses should expose stable search-level metadata, for example:
  - `results.metadata.anime_title`
  - `results.metadata.anime_title_cn`
  - optional `results.metadata.cover_url`

The frontend should not need to infer search-level identity from the first row.

### 5. Route cover metadata is currently reconstructed in the frontend

Current frontend behavior:
- `RoutePlannerWizard.tsx` constructs anime cover URL from `bangumi_id`
- `RoutePlannerWizard.tsx` also carries an `EMPTY_ITINERARY` fallback object in case route payload is incomplete

**Backend-owned target:**
- route responses should expose route-level metadata explicitly, including:
  - `cover_url`
  - optional `anime_title`
  - optional `anime_title_cn`
- `timed_itinerary` should be contract-required for route-stage responses, so `EMPTY_ITINERARY` stays defensive only, not part of the expected happy path

### 6. Media / image URL ownership is currently split and partially leaked into the frontend

Current backend behavior:
- `bangumi.cover_url` is seeded from Bangumi subject metadata and stored as a URL
- point screenshots are seeded from Anitabi point payloads and stored as URLs
- the Worker exposes `/img/*` as an edge proxy + cache over `https://image.anitabi.cn/...`

Current frontend behavior:
- some components use backend-provided `cover_url`
- some components derive imagery from point screenshot rows
- some components reconstruct image URLs from `bangumi_id`

**Backend-owned target:**
- frontend should receive image URLs as contract data, not reconstruct them from `bangumi_id`
- route-stage and nearby-group stage payloads should expose their own `cover_url`
- backend should treat media URLs as part of the response contract
- frontend should not need to know whether the URL points directly to an upstream asset or to our Worker `/img/*` proxy path

**Explicit non-goal for this PR:**
- this PR does **not** introduce first-party image ingestion into our own object storage/CDN (for example R2 or Cloudflare Images)
- current media model remains URL persistence + optional Worker proxy/cache

### 7. Session hydration currently relies on DB-stored legacy response shape

Current frontend behavior:
- `hydrateResponseData()` converts DB-stored `final_output` blobs into a `RuntimeResponse`-shaped object for hydrated chat history

**Backend-owned target:**
- conversation message persistence should converge toward storing response payloads that match the new stage-oriented contract closely enough that hydration is straightforward
- if a compatibility bridge remains, it should be explicitly documented as transitional

## Endpoint-by-Endpoint Backend Changes

### `POST /v1/runtime`

**Current role:**
- synchronous runtime execution for chat queries and selected-point route creation

**Must change:**
- stop depending on the old planner/executor split as the primary runtime path
- call the new main PydanticAI runtime agent
- return final stage-oriented response payloads that already match the frontend journey

**Must preserve:**
- request shape from `PublicAPIRequest`
- selected-point route behavior via `selected_point_ids`
- session_id support
- origin / origin_lat / origin_lng support

**Must add or stabilize:**
- clarify responses with full `candidates[]`
- search responses with stable search-level metadata
- nearby responses with server-owned radius and nearby grouping metadata
- route responses with route-level metadata and guaranteed `timed_itinerary`

### `POST /v1/runtime/stream`

**Current role:**
- SSE runtime path for streaming progress and final response

**Must change:**
- source step/done/error events from the new runtime path
- ensure the final `done` payload is complete enough that frontend does not need clarify step merging for correctness

**Must preserve:**
- `planning` event
- `step` event shape
- `done` event shape
- `error` event shape

**Must add or stabilize:**
- clarify final payload in `done`
- final message quality consistent with sync runtime
- step-event data should be informative, but the final state must not depend on it

### `GET /v1/bangumi/popular`

**Current role:**
- welcome screen anime chip row and cover row

**Must review:**
- whether the current payload is sufficient for the new welcome-state UX
- whether title + cover_url + bangumi_id are enough, or whether title_cn / city / points_count should also be exposed

**Current frontend fallback to replace eventually:**
- `WelcomeScreen.tsx` still has hardcoded fallback covers in UI

**Backend-owned target:**
- this endpoint should be reliable enough that frontend hardcoded cover fallback becomes optional rather than primary

### `GET /v1/conversations`

**Current role:**
- conversation drawer list

**Must preserve:**
- current list behavior and auth shape

**Must review:**
- whether titles generated by the new runtime remain compatible with current drawer UX
- no schema expansion required unless journey design later calls for richer previews

### `GET /v1/conversations/{session_id}/messages`

**Current role:**
- session hydration for historical chat replay

**Must change or be explicitly bridged:**
- historical assistant messages should hydrate cleanly into the new stage-oriented response shape
- either persisted `response_data` is updated to better match the new contract, or the compatibility hydration layer is explicitly retained as migration glue

**Important:**
This endpoint is part of the user journey because old sessions reopen into active UI state. If hydration is wrong, the UI will regress even if live runtime responses are correct.

### `PATCH /v1/conversations/{session_id}`

**Current role:**
- rename conversation title

**Must preserve:**
- existing frontend behavior

No contract expansion required for PR #166.

### `GET /v1/routes`

**Current role:**
- route history list for saved route access

**Must review:**
- whether the route history payload should surface route-level metadata now being formalized elsewhere (title, cover, summary)
- whether current fields remain enough for frontend route history UX

This is lower priority than the runtime endpoints, but should be reviewed so route-stage contract cleanup does not leave route history behind.

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

**Current gap:**
The frontend currently compensates for clarify by reading step events. After this PR, clarify/search/route must all be represented completely in the final `done` payload.

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
Clarify enrichment should become a deterministic tool capability, not a hidden response-builder trick.

That means:
- the agent decides clarification is needed
- a deterministic tool enriches candidate titles into frontend-renderable candidates
- the final agent output includes the full clarify response

**Data source rule:**
Candidate enrichment must be **DB first, then gateway fallback, then write-through** where appropriate.

That rule matters because user queries are not guaranteed to refer only to anime already present in our DB.

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
      metadata?: {
        anime_title?: string,
        anime_title_cn?: string,
        cover_url?: string | null,
        radius_m?: number,
      },
      nearby_groups?: Array<{
        bangumi_id: string,
        title: string,
        cover_url: string | null,
        points_count: number,
        closest_distance_m: number,
      }>,
    },
  },
  ui: {
    component: "PilgrimageGrid" | "NearbyMap" | "NearbyBubble",
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
      cover_url?: string | null,
      anime_title?: string,
      anime_title_cn?: string,
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

| Area | Current backend state | Assessment |
|---|---|---|
| Runtime shape | Custom classifier + planner loop + executor + response adapter | structurally awkward for current product requirements |
| Clarify payload | partial fields, no robust candidate enrichment, dropped by response shaping | **P0 gap** |
| Search / nearby | largely present, but chat summary quality is weak and stage output is backend-shaped | **P1 gap** |
| Route | `timed_itinerary` appears present, but must be treated as hard contract | moderate gap |
| SSE semantics | frontend still compensates for partial final state | **P0 gap** |
| Eval coverage | planner eval exists, but runtime migration + message/contract eval do not | **P0 gap** |

## Recommended Scope for PR #166

This iteration should focus on making the frontend journey supportable **and** moving the runtime to a cleaner, more idiomatic PydanticAI structure.

### In Scope

1. **Replace the current split runtime with a single main PydanticAI agent path**
   - one main runtime agent
   - deterministic capabilities exposed as tools
   - typed final stage outputs

2. **Make clarify a real supported stage**
   - enrich title options into `candidates[]`
   - expose `question`, `options`, `candidates`, and `status` in the final response

3. **Make the final agent output directly carry chat-stage messaging**
   - no separate Solver
   - final response message comes from the main agent after tool use

4. **Upgrade response shaping to reflect frontend stages explicitly**
   - clarify → clarify payload
   - search → results payload
   - route → route payload
   - qa/greet → empty data payload

5. **Confirm route contract stability**
   - ensure `timed_itinerary` is always present where route UI depends on it

6. **Add eval and contract tests as migration safety rails**
   - planner / branching behavior
   - final response contracts
   - message quality and fallback behavior

### Out of Scope

1. Rebuilding every historical helper into the new architecture in one pass if it is not on the main runtime path.
2. Rewriting session persistence or route-history storage.
3. Broad frontend routing cleanup.
4. A separate outer intent-routing agent.
5. A separate Solver layer.

## Target Runtime Shape

### New runtime architecture

```text
Public API / Session / SSE
          │
          ▼
pilgrimage_agent.run(...)
    ├── tool: resolve_anime
    ├── tool: search_bangumi
    ├── tool: search_nearby
    ├── tool: plan_route
    ├── tool: plan_selected
    ├── tool: enrich_clarify_candidates
    ├── tool: answer_question
    └── tool: greet_user
          │
          ▼
Typed stage output
  = ClarifyResponse
  | SearchResponse
  | RouteResponse
  | QAResponse
  | GreetingResponse
          │
          ▼
transport / persistence / SSE adapter
```

### Old runtime components to deprecate from the main path

These are the pieces that should stop being the primary orchestration path after the migration:
- `backend/agents/planner_agent.py`
- `backend/agents/pipeline.py`
- `backend/agents/executor_agent.py`
- `backend/agents/messages.py`

They may remain temporarily as compatibility shims during the migration, but they should no longer define the canonical runtime shape.

## File-Level Implementation Boundary

### Must change
- `backend/interfaces/public_api.py` — become thin orchestration over the new single-agent path
- `backend/interfaces/response_builder.py` — shape frontend-facing `data` correctly from typed final outputs
- `backend/interfaces/routes/runtime.py` — preserve SSE contract while sourcing events from the new runtime path
- `backend/infrastructure/supabase/repositories/bangumi.py` — richer candidate lookup by titles / IDs
- `backend/agents/base.py` — reused as model/provider factory; may need small ergonomic support for the new main agent

### Must create
- `backend/agents/pilgrimage_agent.py` — the new main PydanticAI runtime agent
- `backend/agents/runtime_models.py` — typed output models for clarify/search/route/qa/greet
- `backend/agents/runtime_deps.py` — deps object for DB/gateways/session-relevant runtime dependencies
- `backend/agents/tools.py` — deterministic tool definitions used by the main agent

### Likely needs support changes
- `backend/infrastructure/gateways/bangumi.py` — candidate enrichment support beyond single `search_by_title`
- `backend/agents/handlers/resolve_anime.py` — logic reused or moved into tools
- `backend/agents/handlers/search_bangumi.py`
- `backend/agents/handlers/search_nearby.py`
- `backend/agents/handlers/plan_route.py`
- `backend/agents/handlers/plan_selected.py`
- `backend/agents/handlers/answer_question.py`

### Validate but do not broaden unless necessary
- `backend/agents/route_optimizer.py`
- `backend/interfaces/session_facade.py`
- `backend/interfaces/routes/bangumi.py`

## Implementation Strategy

### 1. Typed runtime outputs become the source of truth

Define internal output models that directly match the frontend stage needs.

The important point is not whether the outer HTTP layer immediately serializes a formal Python union. The important point is that the **runtime thinks in stage outputs**, not ad hoc dict merges.

Recommended internal model family:
- `ClarifyResponseModel`
- `SearchResponseModel`
- `RouteResponseModel`
- `QAResponseModel`
- `GreetingResponseModel`

All should include:
- `intent`
- `message`
- `data`
- optional `ui`

### 2. Deterministic capabilities become tools

Existing deterministic logic should be reused, not reinvented, but surfaced through `@agent.tool` on the main agent.

This keeps:
- DB access deterministic
- route planning deterministic
- fallback logic deterministic

while letting the main agent naturally see tool results before composing the final stage response.

### 3. Clarify enrichment becomes a first-class tool

This tool is essential to the new architecture because clarify is not just a planner-side concept anymore. It is a frontend stage with concrete rendering requirements.

Responsibility:
- take planner/agent-discovered candidate titles
- lookup DB matches first
- use Bangumi gateway fallback where necessary
- write-through where appropriate
- return final `candidates[]` objects usable by the frontend

### 4. Response builder becomes thin again

The response builder should stop acting like a lossy field picker.

Instead, it should:
- map typed stage outputs to `PublicAPIResponse`
- preserve `message`
- preserve stage-specific `data`
- attach stable `ui.component`

### 5. public_api becomes the single convergence point

`backend/interfaces/public_api.py` should remain the outer control surface for:
- session loading
- context injection
- agent execution
- session persistence
- route persistence
- request logging
- SSE/JSON transport conversion

But it should no longer own multi-layer planner/executor orchestration logic.

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
- final `done` response is sufficient on its own

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

### D. Final message is produced naturally by the main agent
For all journey stages, the final `message` is produced by the main agent after tool use, not by a separate Solver layer and not by static templates.

### E. SSE semantics remain stage-safe
- `step` = progress only
- `done` = authoritative final response
- frontend can transition to clarify/search/route without reconstructive guesswork

### F. Eval coverage exists for the migration
The PR adds coverage for:
- ambiguous anime → clarify
- nearby with missing location → clarify
- nearby with valid location → search_nearby
- route query → route stage
- clarify candidate enrichment with DB miss / fallback behavior
- final response contract correctness
- session hydration compatibility for stored assistant responses under the new stage-oriented contract

## Implementation Order

### Step 1 — Define typed runtime outputs
Start by defining the internal stage output models the new runtime will produce.

### Step 2 — Build the main PydanticAI agent shell
Create the new main runtime agent with deps, instructions, and typed output family.

### Step 3 — Move deterministic runtime actions into tools
Expose existing deterministic business capabilities as tools without changing their core logic unnecessarily.

### Step 4 — Make clarify enrichment real
Add the clarify candidate enrichment tool and repository/gateway support required to populate `candidates[]` correctly.

### Step 5 — Cut public_api over to the new runtime path
Make `public_api.py` call the new main agent and map the resulting typed output into the existing public API response shell.

### Step 6 — Preserve SSE contract
Ensure the existing `step` / `done` / `error` frontend contract still holds even though the runtime implementation changed.

### Step 7 — Add migration evals and contract tests
Lock the new behavior down before deleting or sidelining the old runtime path.

## Risks

1. **Scope creep** — a PydanticAI-native migration can become a total runtime rewrite if boundaries are not enforced.
2. **Double-runtime drift** — keeping both runtimes half-alive for too long will create confusion and hidden regressions.
3. **Clarify fallback complexity** — candidate enrichment must handle DB hit, DB miss + gateway hit, and full miss cleanly.
4. **SSE regressions** — changing runtime internals while preserving streaming semantics is easy to get subtly wrong.
5. **Eval blind spots** — a clean-looking migration without runtime evals will regress in exactly the places the frontend depends on most.
6. **Over-ambitious typed transport refactor** — trying to make the external HTTP schema fully union-typed in the same PR is likely unnecessary scope.

## Success Definition

This work succeeds if the backend public API meaningfully shifts from:
- exposing internal agent outputs with thin, lossy translation
- using a custom split runtime that treats PydanticAI mainly as a plan generator

to:
- supplying stable, frontend-stage-oriented contracts for clarify, search, and route
- using a cleaner single-agent PydanticAI-native runtime with deterministic tools
- preserving session/SSE/persistence behavior at the application layer
- adding eval coverage strong enough to make this migration safe

That is the threshold for saying the backend has started to support the existing frontend journey with an architecture that matches both the product shape and the chosen framework.
