# Engineering Review: SOLID Refactoring Analysis

**Date:** 2026-04-09
**Scope:** Backend interfaces + retriever layer
**Files reviewed:**

- `backend/interfaces/fastapi_service.py` (643 lines)
- `backend/agents/retriever.py` (551 lines)
- `backend/interfaces/public_api.py` (542 lines)

---

## Executive Summary

The codebase already shows good instincts — schemas are extracted (`schemas.py`), response building is split out (`response_builder.py`), session logic lives in a facade (`session_facade.py`), and ports/adapters exist for external gateways. The three files under review are the remaining "thick" modules that carry multiple responsibilities and resist extension. This report identifies specific SOLID violations, proposes concrete refactoring targets, and provides a priority-ordered plan.

**Severity scale:** P0 = blocking future work, P1 = painful but survivable, P2 = cleanup

---

## 1. `backend/interfaces/fastapi_service.py` (643L)

### 1.1 Single Responsibility Violations

| Lines | Concern | Description |
|-------|---------|-------------|
| 44-109 | Auth extraction | `TrustedAuthContext`, `_get_trusted_auth_context`, `_require_trusted_user` — auth concern mixed with endpoint definitions |
| 50-84 | Request schemas | `ConversationPatchRequest`, `FeedbackRequest` — Pydantic models that belong in `schemas.py` |
| 111-140 | Health/root endpoints | Operational endpoints mixed with business endpoints |
| 142-228 | Runtime endpoints | Core business endpoints (`/v1/runtime`, `/v1/runtime/stream`) |
| 231-308 | CRUD endpoints | Conversations, messages, routes, feedback — separate resource domain |
| 310-379 | App factory + lifespan | Wiring, middleware, DI container construction |
| 392-455 | Exception handlers | Error formatting — a cross-cutting concern |
| 457-494 | Observability middleware | Tracing/metrics — another cross-cutting concern |
| 497-548 | Response helpers | `_json_response`, `_error_response`, `_http_error_code`, `_http_status_for_response` |
| 551-593 | State accessors + builders | `_get_runtime_api`, `_build_supabase_client`, `_call_optional_async` |
| 618-637 | Logfire setup | Observability vendor integration |
| 639 | Module-level side effect | `app = create_fastapi_app()` — executed on import |

**Count: 11 distinct concerns in one file.**

### 1.2 Open/Closed Violations

- **Adding a new resource domain** (e.g., `/v1/bookmarks`) requires editing this file, adding more handler functions to the same module, and growing the single `router`. There is no extension mechanism.
- **Adding a new exception handler** requires editing `_register_exception_handlers` (L392-454). No plugin/registry pattern.
- **Lines 563-572** (`_require_db_method`): uses `getattr` + `callable()` checks instead of a typed Protocol. Every new DB operation requires another dynamic lookup at runtime, zero static safety.

### 1.3 Dependency Inversion Violations

- **Line 576-579** (`_build_supabase_client`): The FastAPI service directly imports and constructs `SupabaseClient`, a concrete infrastructure class. The app factory should receive an abstract `DatabasePort`, not build a concrete implementation.
- **Line 329**: `getattr(runtime_api, "_db", None)` — reaching into private attributes of RuntimeAPI to access the DB, breaking encapsulation. The health endpoint should use an injected status provider, not peek at internals.
- **Lines 237-289**: Every CRUD handler does `_get_db_from_request(request)` then `_require_db_method(db, "method_name")` — this is service-locator anti-pattern. The DB interface should be typed and injected via FastAPI's `Depends()`.

### 1.4 FastAPI Best Practice Violations

| Issue | Lines | Best Practice |
|-------|-------|---------------|
| Single global `router` | 41 | Use domain-scoped `APIRouter` instances (runtime, conversations, feedback, health) |
| Request schemas in service file | 50-84 | Keep all schemas in `schemas.py` |
| Module-level `app` construction | 639 | Creates side effects on import; use a factory entry point only |
| No `Depends()` for DB | 237-308 | FastAPI dependency injection is the idiomatic way to provide typed services |
| No `Depends()` for RuntimeAPI | 148-149 | Should be a dependency, not pulled from `request.app.state` |

### 1.5 Proposed Refactoring

**Target structure:**

```
backend/interfaces/
    fastapi_service.py       -> app factory only (~80L)
    routers/
        __init__.py
        health.py            -> /, /healthz (~40L)
        runtime.py           -> /v1/runtime, /v1/runtime/stream (~120L)
        conversations.py     -> /v1/conversations/* (~80L)
        feedback.py          -> /v1/feedback (~30L)
        routes.py            -> /v1/routes (~30L)
    middleware/
        __init__.py
        observability.py     -> tracing middleware (~40L)
        error_handlers.py    -> exception handlers (~70L)
    dependencies.py          -> Depends() providers for auth, db, runtime_api (~60L)
    schemas.py               -> (existing, absorbs ConversationPatchRequest, FeedbackRequest)
```

**Priority: P1** — not blocking features, but every new endpoint increases the pain.

---

## 2. `backend/agents/retriever.py` (551L)

### 2.1 Single Responsibility Violations

| Lines | Concern | Description |
|-------|---------|-------------|
| 64-441 | `Retriever` class | Orchestration (strategy selection), SQL execution, geo execution, hybrid merge, write-through persistence, bangumi metadata loading, anitabi lite fetching, area suggestions, point persistence, bangumi record upsert — **at least 6 responsibilities** in one class |
| 92-103 | Strategy selection | `choose_strategy` — a concern that could be a standalone policy |
| 144-176 | Geo retrieval | `_execute_geo` + `_fetch_geo_rows` + `_get_area_suggestions` — a full retrieval strategy |
| 178-229 | Hybrid retrieval | `_execute_hybrid` + `_merge_rows_preserving_order` — merge logic |
| 231-309 | Write-through fallback | `_execute_sql_with_fallback` + `_write_through_bangumi_points` — persistence concern |
| 311-404 | Bangumi record management | `_ensure_bangumi_record` + `_load_bangumi_metadata` + `_fetch_bangumi_lite` + `_persist_points` + `_update_bangumi_points_count` — full CRUD for bangumi data enrichment |
| 444-491 | Data mapping functions | `_records_to_dicts`, `_point_to_db_row`, `_subject_to_bangumi_fields` — mapping/serialization |

**The `Retriever` class is a 378-line God Object.**

### 2.2 Open/Closed Violations

- **Adding a new strategy** (e.g., `VECTOR` for semantic search) requires:
  1. Adding to `RetrievalStrategy` enum (fine)
  2. Adding a branch in `choose_strategy` (violates O/C)
  3. Adding a new method to `Retriever` (violates O/C)
  4. Adding to the handler dict in `execute` L131-135 (violates O/C)

  All modifications, zero extensions. This is a textbook case for the **Strategy pattern**.

- **Lines 131-135**: The strategy dispatch dict is closed — adding a strategy means editing `execute()`.

### 2.3 Dependency Inversion Violations

- **Line 78**: `self._sql_agent = sql_agent or SQLAgent(cast(SupabaseClient, db))` — creates a concrete dependency inside the constructor instead of requiring injection.
- **Lines 83-90**: Conditionally constructs `FetchBangumiPoints(anitabi=AnitabiClientGateway())` and `GetBangumiSubject(bangumi=BangumiClientGateway())` — the Retriever instantiates its own infrastructure gateways. These should be injected.
- **Line 371**: `async with AnitabiClient() as client:` — creates a raw HTTP client inline, bypassing the existing `AnitabiGateway` port defined in `backend/application/ports/anitabi.py`. The port exists but is not used here.
- **Lines 316, 382, 392, 400, 408, 435**: Heavy use of `getattr(self._db, ...)` — the DB is typed as `object`, so every method call is a dynamic lookup. This is the service-locator anti-pattern. The DB should conform to a typed Protocol.

### 2.4 Strategy Pattern Opportunity

```
Current:

    Retriever.execute()
        ├─ if SQL   → self._execute_sql()
        ├─ if GEO   → self._execute_geo()
        └─ if HYBRID → self._execute_hybrid()

Proposed:

    class RetrievalStrategy(Protocol):
        async def execute(self, request: RetrievalRequest) -> RetrievalResult: ...

    class SqlStrategy(RetrievalStrategy): ...
    class GeoStrategy(RetrievalStrategy): ...
    class HybridStrategy(RetrievalStrategy): ...

    class Retriever:
        def __init__(self, strategies: dict[str, RetrievalStrategy], ...):
            self._strategies = strategies

        async def execute(self, request):
            strategy = self._select(request)
            return await self._strategies[strategy].execute(request)
```

**New strategies are added by registering a class, not by editing `Retriever`.**

### 2.5 Repository Pattern Opportunity

The write-through logic (L262-404) is a persistence concern that does not belong in the retrieval layer. Extract:

```
class BangumiWriteThroughRepository:
    """Handles DB-miss fallback: fetch from Anitabi, enrich, persist."""

    async def ensure_bangumi_data(self, bangumi_id: str) -> WriteResult: ...
    async def persist_points(self, points: list[Point]) -> None: ...
    async def update_points_count(self, bangumi_id: str, count: int) -> None: ...
```

### 2.6 Proposed Refactoring

**Target structure:**

```
backend/agents/
    retriever.py             -> orchestrator only (~100L)
    retrieval/
        __init__.py
        base.py              -> RetrievalStrategy Protocol, RetrievalResult (~40L)
        sql_strategy.py      -> SqlStrategy (~60L)
        geo_strategy.py      -> GeoStrategy + area suggestions (~80L)
        hybrid_strategy.py   -> HybridStrategy + merge logic (~80L)
        write_through.py     -> BangumiWriteThroughService (~120L)
        mappers.py           -> _point_to_db_row, _subject_to_bangumi_fields, etc. (~60L)
        policy.py            -> choose_strategy logic (~30L)
```

**Priority: P0** — this file is the most likely to grow (new retrieval strategies, new data sources) and is already at 551L.

---

## 3. `backend/interfaces/public_api.py` (542L)

### 3.1 Single Responsibility Violations

| Lines | Concern | Description |
|-------|---------|-------------|
| 68-79 | Constructor / DI | `RuntimeAPI.__init__` |
| 80-290 | `handle()` method | **210-line method** that orchestrates: session loading, context building, pipeline execution, error handling, session persistence, message persistence, user state persistence, route persistence, session compaction, request logging, observability spans |
| 291-326 | Message persistence | `_persist_messages` — DB write concern |
| 327-343 | User memory loading | `_load_user_memory` — DB read concern |
| 344-396 | User state persistence | `_persist_user_state` — conversation upsert + title generation + user memory upsert |
| 397-417 | Session persistence | `_persist_session` — session store + DB upsert |
| 418-475 | Route persistence | `_maybe_persist_route` — route extraction + DB save |
| 492-542 | Module-level helpers | `_runtime_model_label`, `_get_plan_params`, `_infer_bangumi_id`, `_extract_plan_steps` |

**The `handle()` method alone has 7+ responsibilities.**

### 3.2 Open/Closed Violations

- **The `handle()` method (L80-290)** is a monolithic orchestration sequence. Adding any new post-processing step (e.g., analytics events, A/B test bucketing, rate limit tracking) requires editing this single 210-line method. There is no middleware/hook/event system.
- **Lines 162-166**: Special-case for `greet_user` intent — returns early, bypassing all persistence. Each new "ephemeral" intent requires another `if` branch here.

### 3.3 Dependency Inversion Violations

- **Line 77**: `self._db = db` where `db: object` — no typed protocol. Every method then does `getattr(self._db, "insert_message", None)` (L301), `getattr(self._db, "get_user_memory", None)` (L331), etc. This pattern appears **8 times** across the file.
- **Line 78**: `create_session_store()` — calls a factory for a concrete type if no store is provided. Should require injection.
- **Lines 275-289**: Request logging in the `finally` block directly calls `self._db.insert_request_log`. The logging concern is coupled to the orchestration method.

### 3.4 The `db: object` Anti-Pattern (Cross-Cutting)

This is the single most impactful issue across all three files. The `db` parameter is typed as `object` everywhere, which:

1. **Defeats static analysis** — mypy cannot check any method call
2. **Creates runtime failures** — `getattr` returns `None` silently if a method is missing
3. **Makes testing fragile** — mocks must know which magic method names to implement
4. **Violates Dependency Inversion** — high-level modules depend on a shapeless concrete object instead of an abstract protocol

**The fix:** Define a `DatabasePort` protocol in `backend/application/ports/database.py`:

```python
class DatabasePort(Protocol):
    async def search_points_by_location(self, lat: float, lon: float, radius: int, *, limit: int) -> list[...]: ...
    async def upsert_bangumi(self, bangumi_id: str, **fields: object) -> None: ...
    async def upsert_points_batch(self, rows: list[dict[str, object]]) -> None: ...
    async def insert_message(self, session_id: str, role: str, text: str, data: dict | None = None) -> None: ...
    async def save_feedback(self, ...) -> str: ...
    async def insert_request_log(self, ...) -> None: ...
    async def get_conversations(self, user_id: str) -> list[dict]: ...
    async def get_conversation(self, session_id: str) -> dict | None: ...
    async def get_messages(self, session_id: str) -> list[dict]: ...
    async def save_route(self, ...) -> str: ...
    # ... etc
```

Then `SupabaseClient` implements this protocol, and all three files accept `DatabasePort` instead of `object`.

### 3.5 Facade Pattern — Already Partially Applied

The `RuntimeAPI` class is labeled a facade, and the codebase already extracted `response_builder.py` and `session_facade.py`. What remains in `public_api.py` is persistence orchestration that should also be extracted.

**Proposed: `PersistenceOrchestrator`**

```python
class PersistenceOrchestrator:
    """Coordinates all post-pipeline persistence side effects."""

    async def persist_all(
        self,
        *,
        session_id: str,
        user_id: str | None,
        request: PublicAPIRequest,
        response: PublicAPIResponse,
        result: PipelineResult | None,
        context_delta: dict[str, object],
        previous_state: dict[str, object],
    ) -> None:
        """Run session, message, user-state, route, and request-log persistence."""
```

This collapses L174-289 of `handle()` into a single delegation call.

### 3.6 Proposed Refactoring

**Target structure:**

```
backend/interfaces/
    public_api.py            -> RuntimeAPI.handle() orchestration only (~120L)
    persistence/
        __init__.py
        orchestrator.py      -> PersistenceOrchestrator (~100L)
        message_repo.py      -> message insert logic (~40L)
        route_repo.py        -> route extraction + save (~60L)
        user_state_repo.py   -> user memory + conversation upsert (~60L)
        request_logger.py    -> request log insertion (~30L)
    session_facade.py        -> (existing, unchanged)
    response_builder.py      -> (existing, unchanged)
```

**Priority: P1** — the 210-line `handle()` is manageable today but is a merge-conflict magnet and will grow with every new feature.

---

## 4. Dependency Diagram: Before

```
                         fastapi_service.py (643L)
                         ┌──────────────────────────────────────────┐
                         │ app factory + lifespan                    │
                         │ 10 endpoint handlers (single router)      │
                         │ auth extraction                           │
                         │ request schemas                           │
                         │ exception handlers                        │
                         │ observability middleware                   │
                         │ response helpers                          │
                         │ logfire setup                              │
                         └──────────────┬───────────────────────────┘
                                        │ depends on
                                        ▼
                         public_api.py (542L)
                         ┌──────────────────────────────────────────┐
                         │ RuntimeAPI.handle() (210L method)         │
                         │   session load/save                       │
                         │   pipeline dispatch                       │
                         │   message persistence                     │
                         │   user state persistence                  │
                         │   route persistence                       │
                         │   request logging                         │
                         │   observability spans                     │
                         └──────────────┬───────────────────────────┘
                                        │ depends on
                                        ▼
                         retriever.py (551L)
                         ┌──────────────────────────────────────────┐
                         │ Retriever (378L God Object)               │
                         │   strategy selection                      │
                         │   SQL execution + fallback                │
                         │   geo execution + area suggestions        │
                         │   hybrid merge                            │
                         │   write-through persistence               │
                         │   bangumi metadata enrichment             │
                         │   anitabi lite fetch                      │
                         │   point DB persistence                    │
                         └──────────────────────────────────────────┘
                                        │
                                        │ all three use
                                        ▼
                              db: object  (untyped)
                         ┌──────────────────────────────────┐
                         │ SupabaseClient (concrete)         │
                         │ accessed via getattr() ~20 times  │
                         └──────────────────────────────────┘
```

## 5. Dependency Diagram: After

```
                         fastapi_service.py (~80L)
                         ┌───────────────────────────┐
                         │ app factory + lifespan      │
                         │ include_router(health)      │
                         │ include_router(runtime)     │
                         │ include_router(conversations)│
                         │ include_router(feedback)    │
                         │ include_router(routes)      │
                         └────────────┬────────────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    ▼                 ▼                   ▼
              routers/          middleware/         dependencies.py
           health.py          observability.py    ┌──────────────┐
           runtime.py         error_handlers.py   │ get_db()      │
           conversations.py                       │ get_auth()    │
           feedback.py                            │ get_runtime() │
           routes.py                              └──────┬───────┘
                                                         │
                         ┌───────────────────────────────┘
                         ▼
                    public_api.py (~120L)
                    ┌────────────────────────────┐
                    │ RuntimeAPI.handle()          │
                    │   1. load session            │
                    │   2. build context           │
                    │   3. run pipeline            │
                    │   4. build response          │
                    │   5. delegate persistence    │
                    └────────────┬────────────────┘
                                 │
                    ┌────────────┼───────────────┐
                    ▼            ▼                ▼
            persistence/   session_facade.py  response_builder.py
            orchestrator.py    (existing)       (existing)
            message_repo.py
            route_repo.py
            user_state_repo.py
            request_logger.py
                    │
                    ▼
             retriever.py (~100L, orchestrator)
             ┌─────────────────────────────┐
             │ Retriever                    │
             │   select strategy            │
             │   delegate to strategy impl  │
             │   cache check/write          │
             └─────────────┬───────────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                 ▼
        SqlStrategy   GeoStrategy    HybridStrategy
                           │
                           ▼
                  BangumiWriteThroughService
                           │
                           ▼
              DatabasePort (Protocol)  <--- application/ports/database.py
              ┌──────────────────────────┐
              │ All DB methods typed       │
              │ SupabaseClient implements  │
              │ Test mocks implement       │
              └──────────────────────────┘
```

---

## 6. Priority-Ordered Action Plan

### P0: Extract `DatabasePort` Protocol

**Impact:** Fixes the `db: object` anti-pattern across all three files (~20 `getattr` call sites).
**Effort:** ~2 hours.
**Files to create:**

- `backend/application/ports/database.py`

**Files to modify:**

- `backend/infrastructure/supabase/client.py` — verify it satisfies the protocol
- `backend/agents/retriever.py` — replace `db: object` with `DatabasePort`
- `backend/interfaces/public_api.py` — replace `db: object` with `DatabasePort`
- `backend/interfaces/fastapi_service.py` — replace `db: object` with `DatabasePort`

---

### P1a: Extract Retrieval Strategies from `retriever.py`

**Impact:** Enables adding new retrieval strategies without editing existing code. Reduces the 378L God Object to ~100L.
**Effort:** ~3 hours.
**Files to create:**

- `backend/agents/retrieval/base.py`
- `backend/agents/retrieval/sql_strategy.py`
- `backend/agents/retrieval/geo_strategy.py`
- `backend/agents/retrieval/hybrid_strategy.py`
- `backend/agents/retrieval/write_through.py`
- `backend/agents/retrieval/mappers.py`

---

### P1b: Extract FastAPI Routers + Dependencies

**Impact:** Each resource domain gets its own router file. New endpoints added by creating a file, not editing a 643L module.
**Effort:** ~2 hours.
**Files to create:**

- `backend/interfaces/routers/health.py`
- `backend/interfaces/routers/runtime.py`
- `backend/interfaces/routers/conversations.py`
- `backend/interfaces/routers/feedback.py`
- `backend/interfaces/routers/routes.py`
- `backend/interfaces/dependencies.py`
- `backend/interfaces/middleware/observability.py`
- `backend/interfaces/middleware/error_handlers.py`

**Files to modify:**

- `backend/interfaces/schemas.py` — absorb `ConversationPatchRequest`, `FeedbackRequest`
- `backend/interfaces/fastapi_service.py` — reduce to factory only

---

### P1c: Extract Persistence Orchestration from `public_api.py`

**Impact:** Reduces `handle()` from 210L to ~60L. Persistence logic becomes independently testable.
**Effort:** ~2 hours.
**Files to create:**

- `backend/interfaces/persistence/orchestrator.py`
- `backend/interfaces/persistence/message_repo.py`
- `backend/interfaces/persistence/route_repo.py`
- `backend/interfaces/persistence/user_state_repo.py`
- `backend/interfaces/persistence/request_logger.py`

---

### P2: Formalize Strategy Registration

Once the strategy extraction (P1a) is done, add a registry pattern so new strategies are auto-discovered:

```python
# backend/agents/retrieval/registry.py
STRATEGY_REGISTRY: dict[str, type[RetrievalStrategy]] = {}

def register_strategy(name: str):
    def decorator(cls: type[RetrievalStrategy]):
        STRATEGY_REGISTRY[name] = cls
        return cls
    return decorator
```

**Effort:** ~30 minutes.

---

## 7. Summary of Violations

| Principle | fastapi_service.py | retriever.py | public_api.py |
|-----------|-------------------|--------------|---------------|
| **Single Responsibility** | 11 concerns in one file | 6+ concerns in Retriever class | 210L handle() with 7+ concerns |
| **Open/Closed** | New endpoints require editing | New strategies require editing | New persistence steps require editing |
| **Liskov Substitution** | N/A (no inheritance) | N/A | N/A |
| **Interface Segregation** | `_require_db_method` accepts `object` | `db: object` forces fat interface | `db: object` forces fat interface |
| **Dependency Inversion** | Constructs SupabaseClient directly | Constructs gateways directly, uses `getattr` | Uses `getattr` for all DB calls |

**Total `getattr(db, ...)` call sites across all three files: ~20**
**Total lines that would move out of these files: ~1,200 (of 1,736 combined)**

---

## 8. Pydantic AI Best Practices

The codebase uses Pydantic AI correctly for the planner agent (`output_type=ExecutionPlan`, `retries=2`). No Pydantic AI violations were found in the three reviewed files — the executor is deterministic (no LLM calls), which is the right design.

One minor note: the `RuntimeAPI` creates `ExecutorAgent(self._db)` inline at L124. If executor agents ever need configuration (timeouts, retry policies), this construction should be injected.

---

*Report generated by engineering review. No code changes were made.*
