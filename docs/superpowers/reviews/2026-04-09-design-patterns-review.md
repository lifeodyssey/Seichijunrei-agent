# Design Patterns & Clean Architecture Review

**Date:** 2026-04-09
**Scope:** `backend/interfaces/`, `backend/agents/retriever.py`, supporting modules
**Verdict:** Solid layered architecture with a few structural gaps to close

---

## 1. Current Architecture Diagram

```
                         ┌──────────────────────────────────────────────────────┐
                         │                   INTERFACES                        │
                         │                                                      │
                         │  fastapi_service.py  ─── schemas.py                 │
                         │        │                                             │
                         │        ▼                                             │
                         │  public_api.py (RuntimeAPI)                         │
                         │        │       ▲                                     │
                         │        │       │                                     │
                         │  response_builder.py   session_facade.py            │
                         └────────┼───────┼────────────────────────────────────┘
                                  │       │
                         ┌────────▼───────┼────────────────────────────────────┐
                         │                AGENTS                                │
                         │                                                      │
                         │  pipeline.py ─► planner_agent.py (LLM)             │
                         │       │                                              │
                         │       ▼                                              │
                         │  executor_agent.py ──► retriever.py                 │
                         │                            │                         │
                         │                    sql_agent.py                      │
                         │                                                      │
                         │  models.py  (shared types: ToolName, PlanStep, etc.) │
                         └────────────────────┼────────────────────────────────┘
                                              │
                         ┌────────────────────▼────────────────────────────────┐
                         │             APPLICATION                             │
                         │                                                      │
                         │  ports/bangumi.py (Protocol)                         │
                         │  ports/anitabi.py (Protocol)                         │
                         │  use_cases/fetch_bangumi_points.py                   │
                         │  use_cases/get_bangumi_subject.py                    │
                         │  errors.py                                           │
                         └────────────────────┼────────────────────────────────┘
                                              │
                         ┌────────────────────▼────────────────────────────────┐
                         │            INFRASTRUCTURE                            │
                         │                                                      │
                         │  supabase/client.py  ──► repositories/*             │
                         │  gateways/bangumi.py (BangumiClientGateway)         │
                         │  gateways/anitabi.py (AnitabiClientGateway)         │
                         │  session/base.py (SessionStore Protocol)            │
                         │  observability/*                                     │
                         └─────────────────────────────────────────────────────┘
                                              │
                         ┌────────────────────▼────────────────────────────────┐
                         │                 DOMAIN                               │
                         │                                                      │
                         │  entities.py  (Point, Bangumi, Station, Route, ...)  │
                         │  errors.py                                           │
                         │  llm_schemas.py                                      │
                         └─────────────────────────────────────────────────────┘
```

### Dependency flow (current)

```
fastapi_service ──► public_api ──► pipeline ──► planner + executor
                                                       │
                                                  retriever
                                                  │        │
                                         sql_agent    application/use_cases
                                                       │
                                              infrastructure/gateways
                                                       │
                                                    domain
```

---

## 2. Pattern-by-Pattern Analysis

### 2.1 Facade Pattern (public_api.py / RuntimeAPI)

**Status: GOOD -- proper Facade, not a God Object**

`RuntimeAPI` is correctly positioned as a thin orchestration facade. It:

- Delegates response building to `response_builder.py`
- Delegates session logic to `session_facade.py`
- Delegates pipeline execution to `agents/pipeline.py`
- Does not contain business logic itself

**Issue: Excessive `getattr()` duck-typing on `db`.**
`RuntimeAPI.__init__` accepts `db: object`, then uses `getattr(self._db, "insert_request_log", None)` and similar patterns 14+ times throughout the class. This hides the contract the facade actually needs from the database.

**Recommendation:** Define a `RuntimeDBPort` protocol (in `application/ports/`) with the methods `RuntimeAPI` actually calls: `insert_request_log`, `insert_message`, `upsert_conversation`, `upsert_session`, `save_route`, `get_user_memory`, `upsert_user_memory`, `update_conversation_title`. Then type `db` as `RuntimeDBPort` instead of `object`. This gives mypy coverage and documents the contract explicitly.

**Severity:** Medium. The `getattr` pattern works but sacrifices type safety and discoverability.

### 2.2 Strategy Pattern (retriever.py)

**Status: PARTIAL -- implicit strategy dispatch via dict, not decomposed**

`Retriever.choose_strategy()` is deterministic and correct. Strategy execution happens via a dispatch dict:

```python
handler = {
    RetrievalStrategy.SQL: self._execute_sql,
    RetrievalStrategy.GEO: self._execute_geo,
    RetrievalStrategy.HYBRID: self._execute_hybrid,
}[strategy]
```

This is a valid approach for three fixed strategies. However:

**Issue 1: Monolithic class.** At 551 lines, `Retriever` contains all three strategy implementations, the write-through fallback logic, metadata enrichment, geo row fetching, and merge logic. Each strategy handler has distinct dependencies (SQL uses `SQLAgent`, GEO uses `resolve_location` + DB geo methods, HYBRID combines both).

**Issue 2: Direct instantiation of external clients.** Line 371: `async with AnitabiClient() as client:` creates a concrete HTTP client inside the retriever. This bypasses the `AnitabiGateway` port that already exists in `application/ports/anitabi.py` and is used by `FetchBangumiPoints`.

**Issue 3: Raw SQL in retriever.** Lines 400-404 execute `UPDATE bangumi SET points_count = $1 WHERE id = $2` directly against the pool. This leaks infrastructure concerns into the agents layer.

**Recommendation:**

1. Extract `_write_through_bangumi_points`, `_ensure_bangumi_record`, `_load_bangumi_metadata`, `_fetch_bangumi_lite`, `_persist_points`, `_update_bangumi_points_count` into a dedicated `BangumiWriteThroughService` in the application layer. This is a use case, not a retrieval strategy.
2. Replace `AnitabiClient()` direct instantiation with the injected `AnitabiGateway` port.
3. Move raw SQL (`UPDATE bangumi SET points_count`) into `BangumiRepository`.

**Severity:** High for the raw SQL and client instantiation. Medium for class size.

### 2.3 Repository Pattern (infrastructure/supabase/)

**Status: GOOD -- well-decomposed repositories**

`SupabaseClient` delegates to seven domain repositories (`BangumiRepository`, `PointsRepository`, etc.), each with focused responsibility. The `__getattr__` fallback provides backward compatibility without code duplication.

**Issue: `__getattr__` delegation hides the API surface.** Callers use `getattr(db, "method_name", None)` everywhere instead of typed method calls. This is a consequence of `db: object` typing throughout the codebase.

**Recommendation:** The `__getattr__` approach is fine as a transitional shim but should be paired with explicit Protocol types at call sites (see 2.1). Long term, consumers should depend on repository protocols, not on the `SupabaseClient` aggregate.

**Severity:** Low. The pattern works; the gap is in the caller typing.

### 2.4 Dependency Injection (fastapi_service.py)

**Status: MIXED -- factory function is good, runtime state is ad-hoc**

`create_fastapi_app()` accepts optional `runtime_api`, `settings`, `db`, `session_store` parameters. This supports testing well. Dependencies are stored on `app.state` and retrieved via helper functions:

```python
def _get_runtime_api(request: Request) -> RuntimeAPI:
    return cast(RuntimeAPI, request.app.state.runtime_api)
```

**Issue 1: No FastAPI `Depends()` for core services.** `RuntimeAPI` and `db` are pulled from `request.app.state` via module-level helpers, not via FastAPI's dependency injection system. This means:

- No lazy instantiation or scoping
- No override mechanism via `app.dependency_overrides` for testing
- Endpoints like `handle_get_conversations` call `_get_db_from_request` + `_require_db_method` manually

**Issue 2: Module-level `app` singleton.** Line 639: `app = create_fastapi_app()` creates a module-level app with no configuration, which runs at import time. This is typical for uvicorn but makes the module harder to test in isolation.

**Issue 3: `_require_db_method` is runtime duck-typing.** Instead of a typed dependency, the service checks `hasattr(db, method_name)` at request time and raises HTTP 500 if missing. This should be a startup-time guarantee.

**Recommendation:**

1. Create FastAPI dependency providers:
   ```python
   async def get_runtime_api(request: Request) -> RuntimeAPI:
       return cast(RuntimeAPI, request.app.state.runtime_api)

   async def get_db(request: Request) -> RuntimeDBPort:
       return cast(RuntimeDBPort, request.app.state.db_client)
   ```

2. Use `Depends(get_runtime_api)` in endpoint signatures instead of `request: Request` + manual extraction.
3. Move `_require_db_method` checks to startup validation (assert all required methods exist before serving traffic).

**Severity:** Medium. Current approach works but does not leverage FastAPI's DI system.

### 2.5 Clean Architecture Layer Separation

**Status: MOSTLY CORRECT with specific violations**

#### Correct separations

- `domain/entities.py` has zero imports from other layers
- `application/ports/` defines Protocol interfaces for external gateways
- `application/use_cases/` depends only on ports and domain entities
- `infrastructure/gateways/` implements the port protocols
- `interfaces/schemas.py` is pure Pydantic with no business logic

#### Violations

**Violation 1: `agents/retriever.py` imports concrete infrastructure types.**

```python
from backend.infrastructure.gateways.anitabi import AnitabiClientGateway  # concrete
from backend.infrastructure.gateways.bangumi import BangumiClientGateway  # concrete
from backend.infrastructure.supabase.client import SupabaseClient         # concrete
from backend.clients.anitabi import AnitabiClient                         # HTTP client
```

The agents layer (which sits between interfaces and application) should not import concrete infrastructure implementations. It should depend on the `AnitabiGateway` / `BangumiGateway` protocols from `application/ports/`.

**Violation 2: `agents/retriever.py` line 400 -- raw SQL execution.**

```python
await execute(
    "UPDATE bangumi SET points_count = $1 WHERE id = $2",
    points_count, bangumi_id,
)
```

This is data access logic belonging in `BangumiRepository`, not in the agents layer.

**Violation 3: `interfaces/session_facade.py` imports from agents layer.**

```python
from backend.agents.base import create_agent, get_default_model
```

The session facade uses LLM agents for title generation and compaction. This creates a dependency from interfaces -> agents, which is correct directionally (outer -> inner), but the LLM usage is a business concern that should live in the application layer as a use case.

**Violation 4: `interfaces/public_api.py` directly instantiates `ExecutorAgent`.**

```python
result = await ExecutorAgent(self._db).execute(...)
```

The facade creates agent instances directly instead of receiving them via injection.

### 2.6 Command/Query Separation (CQS)

**Status: PARTIAL**

The FastAPI endpoints show a natural read/write split:

| Endpoint | Type |
|---|---|
| `GET /healthz` | Query |
| `GET /v1/conversations` | Query |
| `GET /v1/conversations/{id}/messages` | Query |
| `GET /v1/routes` | Query |
| `POST /v1/runtime` | Command (with response) |
| `POST /v1/feedback` | Command |
| `PATCH /v1/conversations/{id}` | Command |

**Issue:** `POST /v1/runtime` is a mixed command-query: it executes the pipeline (command), persists session/messages/routes (side effects), and returns the full result (query). This is acceptable for a conversational API but the `RuntimeAPI.handle()` method handles all of these in a single 200-line method.

**Recommendation:** Extract the persistence side effects into a `PostPipelineHook` or similar, keeping `handle()` focused on orchestration:

```
handle() -> plan -> execute -> build_response -> persist_side_effects -> return
```

The `finally` block in `handle()` (lines 238-289) does request logging and message persistence as a cleanup concern, which is pragmatic but makes the control flow harder to follow.

**Severity:** Low-medium. The method is long but the logic is sequential.

### 2.7 Interface Segregation

**Status: GOOD for protocols, WEAK for db typing**

The `application/ports/` layer correctly defines narrow protocols:

- `BangumiGateway`: 3 methods
- `AnitabiGateway`: 3 methods
- `SessionStore`: 3 methods (get/set/delete)

**Issue:** The `db: object` parameter throughout `RuntimeAPI`, `Retriever`, and `ExecutorAgent` is the anti-pattern of interface segregation. Every consumer gets access to the entire `SupabaseClient` surface area (7 repositories, 20+ methods) when it only needs a small subset.

**Recommendation:** Define per-consumer port protocols:

| Consumer | Needed Methods |
|---|---|
| `RuntimeAPI` | `insert_request_log`, `insert_message`, `upsert_conversation`, `save_route`, `get_user_memory`, `upsert_user_memory`, `update_conversation_title`, `upsert_session` |
| `Retriever` | `search_points_by_location`, `upsert_points_batch`, `upsert_bangumi`, `get_bangumi_by_area` |
| `ExecutorAgent` | `find_bangumi_by_title`, `upsert_bangumi_title` |

Each consumer declares a Protocol with only its required methods. `SupabaseClient` satisfies all of them via structural subtyping.

**Severity:** Medium. The `object` typing is the root cause of multiple downstream issues (getattr chains, missing type safety, hidden contracts).

---

## 3. Proposed Architecture Diagram

```
                         ┌──────────────────────────────────────────────────────┐
                         │                   INTERFACES                        │
                         │                                                      │
                         │  fastapi_service.py                                 │
                         │    Depends(get_runtime_api)                         │
                         │    Depends(get_db: ConversationDBPort)              │
                         │        │                                             │
                         │  schemas.py (request/response contracts)            │
                         └────────┼────────────────────────────────────────────┘
                                  │
                         ┌────────▼────────────────────────────────────────────┐
                         │              APPLICATION                            │
                         │                                                      │
                         │  runtime_api.py (RuntimeAPI -- moved here)          │
                         │    depends on: PipelinePort, SessionPort,           │
                         │                RuntimeDBPort, ResponseBuilder       │
                         │                                                      │
                         │  use_cases/                                          │
                         │    fetch_bangumi_points.py                           │
                         │    get_bangumi_subject.py                            │
                         │    write_through_bangumi.py   (NEW -- extracted)     │
                         │    generate_title.py          (NEW -- from facade)   │
                         │    compact_session.py         (NEW -- from facade)   │
                         │                                                      │
                         │  ports/                                              │
                         │    bangumi.py       (Protocol)                       │
                         │    anitabi.py       (Protocol)                       │
                         │    runtime_db.py    (NEW -- RuntimeDBPort Protocol)  │
                         │    retriever_db.py  (NEW -- RetrieverDBPort)         │
                         │    session.py       (re-export SessionStore)         │
                         │                                                      │
                         │  response_builder.py  (moved from interfaces)       │
                         │  session_facade.py    (pure functions, no LLM)       │
                         └────────┼────────────────────────────────────────────┘
                                  │
                         ┌────────▼────────────────────────────────────────────┐
                         │                AGENTS                                │
                         │                                                      │
                         │  pipeline.py ─► planner_agent.py (LLM)             │
                         │       │                                              │
                         │       ▼                                              │
                         │  executor_agent.py                                  │
                         │       │                                              │
                         │  retriever.py  (strategy dispatch only, ~200L)      │
                         │       │                                              │
                         │  sql_agent.py                                        │
                         │                                                      │
                         │  models.py  (shared types)                           │
                         └────────┼────────────────────────────────────────────┘
                                  │
                         ┌────────▼────────────────────────────────────────────┐
                         │            INFRASTRUCTURE                            │
                         │                                                      │
                         │  supabase/client.py  ──► repositories/*             │
                         │    (satisfies RuntimeDBPort, RetrieverDBPort, etc.) │
                         │  gateways/bangumi.py  (implements BangumiGateway)   │
                         │  gateways/anitabi.py  (implements AnitabiGateway)   │
                         │  session/*            (implements SessionStore)     │
                         │  observability/*                                     │
                         └────────┼────────────────────────────────────────────┘
                                  │
                         ┌────────▼────────────────────────────────────────────┐
                         │                 DOMAIN                               │
                         │                                                      │
                         │  entities.py  (Point, Bangumi, Station, Route, ...)  │
                         │  errors.py                                           │
                         └─────────────────────────────────────────────────────┘
```

### Key changes from current to proposed

1. `RuntimeAPI` moves from `interfaces/` to `application/` (it is orchestration, not transport)
2. Write-through, title generation, compaction become explicit use cases
3. `db: object` replaced with narrow Protocol ports
4. `Retriever` loses write-through responsibility (delegated to use case)
5. `fastapi_service.py` uses proper `Depends()` injection
6. No agents-layer code imports concrete infrastructure types

---

## 4. Specific Refactoring Recommendations

### R1: Eliminate `db: object` typing (HIGH PRIORITY)

**Files to create:**

- `backend/application/ports/runtime_db.py` -- `RuntimeDBPort` Protocol
- `backend/application/ports/retriever_db.py` -- `RetrieverDBPort` Protocol

**Files to modify:**

- `backend/interfaces/public_api.py` -- type `db` as `RuntimeDBPort`
- `backend/agents/retriever.py` -- type `db` as `RetrieverDBPort`
- `backend/agents/executor_agent.py` -- type `db` with appropriate port

**Impact:** Eliminates ~30 `getattr()` calls, gives mypy full coverage, documents contracts explicitly.

### R2: Extract write-through logic from Retriever (HIGH PRIORITY)

**Create:** `backend/application/use_cases/write_through_bangumi.py`

Move these methods from `Retriever`:

- `_write_through_bangumi_points`
- `_ensure_bangumi_record`
- `_load_bangumi_metadata`
- `_fetch_bangumi_lite`
- `_persist_points`
- `_update_bangumi_points_count`

This separates "how to get data" (retriever) from "how to backfill missing data" (use case).

**Create:** Move `_update_bangumi_points_count` raw SQL into `BangumiRepository.update_points_count()`.

### R3: Remove concrete infrastructure imports from agents (HIGH PRIORITY)

**File:** `backend/agents/retriever.py`

Remove:
```python
from backend.infrastructure.gateways.anitabi import AnitabiClientGateway
from backend.infrastructure.gateways.bangumi import BangumiClientGateway
from backend.infrastructure.supabase.client import SupabaseClient
from backend.clients.anitabi import AnitabiClient
```

Replace with port types:
```python
from backend.application.ports.anitabi import AnitabiGateway
from backend.application.ports.bangumi import BangumiGateway
```

Inject via constructor parameters (already partially done with `fetch_bangumi_points` and `get_bangumi_subject` callables).

### R4: FastAPI dependency injection (MEDIUM PRIORITY)

**File:** `backend/interfaces/fastapi_service.py`

Replace `_get_runtime_api(request)` pattern with:

```python
async def get_runtime_api(request: Request) -> RuntimeAPI:
    return cast(RuntimeAPI, request.app.state.runtime_api)

@router.post("/v1/runtime")
async def handle_runtime(
    api_request: PublicAPIRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
    runtime_api: Annotated[RuntimeAPI, Depends(get_runtime_api)],
) -> JSONResponse:
    response = await runtime_api.handle(api_request, user_id=auth.user_id)
    return _public_api_response(response)
```

This enables `app.dependency_overrides[get_runtime_api] = lambda: mock_api` in tests.

### R5: Extract LLM-dependent session operations (MEDIUM PRIORITY)

**File:** `backend/interfaces/session_facade.py`

Move `compact_session_interactions()` and `generate_and_save_title()` to:

- `backend/application/use_cases/compact_session.py`
- `backend/application/use_cases/generate_title.py`

These use LLM agents and are business logic, not interface concerns.

### R6: Decompose `RuntimeAPI.handle()` (LOW PRIORITY)

The 200-line `handle()` method has clear phases:

1. Load session
2. Execute pipeline
3. Build response
4. Persist side effects (session, messages, routes, user state)
5. Log request

Extract step 4 into a `_persist_pipeline_results()` method or a `PostPipelineHook` class.

---

## 5. Comparison with FastAPI / Pydantic AI Best Practices

### 5.1 FastAPI Community Patterns

| Practice | Status | Notes |
|---|---|---|
| Pydantic schemas for request/response | GOOD | `schemas.py` is clean and well-typed |
| `Depends()` for dependency injection | PARTIAL | Auth uses `Depends`, but core services do not |
| Lifespan context manager for startup/shutdown | GOOD | `create_fastapi_app` uses `@asynccontextmanager` correctly |
| APIRouter separation | GOOD | Single router is appropriate for this API surface |
| Exception handlers | GOOD | Comprehensive handlers for validation, HTTP, and unhandled errors |
| Background tasks | PARTIAL | Uses `asyncio.create_task()` for fire-and-forget; FastAPI's `BackgroundTasks` would be more idiomatic but functionally equivalent |
| Streaming (SSE) | GOOD | Clean `StreamingResponse` with proper cancellation handling |
| Settings via pydantic-settings | GOOD | `Settings` class with `get_settings()` factory |

### 5.2 Pydantic AI Patterns

| Practice | Status | Notes |
|---|---|---|
| Structured output types | GOOD | `ExecutionPlan` as `output_type` for planner agent |
| Agent retry configuration | GOOD | `retries=2` on planner, `retries=1` on utility agents |
| Agent as stateless function | GOOD | Agents created per-call, no mutable state |
| Model override support | GOOD | `model` parameter flows through the entire stack |

### 5.3 Clean Architecture (Python ecosystem)

| Practice | Status | Notes |
|---|---|---|
| Domain entities with no framework deps | GOOD | `entities.py` uses only Pydantic (acceptable as domain modeling lib) |
| Port/adapter pattern | PARTIAL | Ports exist for gateways but not for DB consumers |
| Use cases as first-class objects | PARTIAL | `FetchBangumiPoints` and `GetBangumiSubject` are good; write-through logic is inlined in retriever |
| Dependency inversion | PARTIAL | Gateway protocols invert correctly; `db: object` bypasses inversion |
| No inner-layer imports of outer layers | VIOLATED | Retriever imports concrete infrastructure types |

---

## 6. Summary of Findings

### What is working well

1. **Layer separation exists** -- domain, application, agents, infrastructure, interfaces are all distinct directories with mostly correct responsibilities
2. **Protocol-based ports** for external gateways (Bangumi, Anitabi, SessionStore)
3. **Facade decomposition** -- `public_api.py` correctly delegates to `response_builder.py` and `session_facade.py`
4. **Repository pattern** in infrastructure with seven focused repositories
5. **Deterministic executor** with no LLM calls (static message templates)
6. **Domain entities** are pure and framework-independent

### What needs attention

1. **`db: object` typing** is the single biggest architectural debt -- it eliminates type safety and hides contracts across the entire backend
2. **Retriever is doing too much** -- strategy dispatch + write-through + metadata enrichment + raw SQL should be separated
3. **Concrete infrastructure imports in agents layer** violate dependency direction
4. **FastAPI DI underutilized** -- only auth context uses `Depends()`
5. **LLM-dependent code in interfaces layer** (session_facade title/compaction) should be application use cases

### Prioritized action items

| Priority | Item | Effort | Impact |
|---|---|---|---|
| P0 | Define `RuntimeDBPort` / `RetrieverDBPort` protocols | Small | High -- unlocks type safety everywhere |
| P0 | Move raw SQL from retriever to `BangumiRepository` | Small | High -- fixes layer violation |
| P1 | Remove concrete infra imports from `agents/retriever.py` | Medium | High -- fixes dependency direction |
| P1 | Extract write-through into application use case | Medium | High -- reduces retriever complexity |
| P2 | Convert `fastapi_service.py` to use `Depends()` for services | Small | Medium -- improves testability |
| P2 | Move LLM session operations to application layer | Medium | Medium -- correct layer placement |
| P3 | Decompose `RuntimeAPI.handle()` | Small | Low -- readability improvement |
