# Backend Engineering Architecture Review

**Date:** 2026-04-09
**Scope:** All Python source under `backend/` (80 source files, ~10,200 LOC; 40 test files, ~9,400 LOC)
**Reviewer:** Eng review (automated)

---

## Scorecard

| Dimension       | Grade | Notes                                                        |
|-----------------|-------|--------------------------------------------------------------|
| Architecture    | **A-** | Clean layering, proper ports/adapters, minor violations      |
| Code Quality    | **B+** | Consistent style, a few oversized files, solid typing        |
| Test Coverage   | **B+** | Strong unit coverage, solid integration, a few gaps          |
| Performance     | **B**  | Good caching, some N+1 risks, O(n^2) clustering             |
| Security        | **A-** | Auth at Worker, parameterized SQL, SSRF guard, CORS check    |

---

## 1. Architecture Review

### 1.1 Layer Diagram

```
                        +---------------------+
                        |    worker/worker.js  |  Auth enforcement
                        +----------+----------+
                                   |
                        +----------v----------+
                        |     interfaces/      |  FastAPI service, schemas
                        |  fastapi_service.py  |  public_api.py
                        |  response_builder.py |  session_facade.py
                        +----------+----------+
                                   |
                        +----------v----------+
                        |      agents/         |  Pipeline, planner, executor
                        |   pipeline.py        |  handlers/*
                        |   planner_agent.py   |  retriever.py
                        |   executor_agent.py  |  sql_agent.py
                        +----------+----------+
                                   |
              +--------------------+--------------------+
              |                                         |
   +----------v----------+                   +----------v----------+
   |    application/      |                   |   infrastructure/   |
   |   use_cases/         |                   |   supabase/client   |
   |   ports/ (Protocol)  |                   |   repositories/*    |
   |   errors.py          |                   |   gateways/*        |
   +----------+-----------+                   |   session/*         |
              |                               |   observability/*   |
   +----------v----------+                   +---------------------+
   |      domain/         |
   |   entities.py        |
   |   errors.py          |
   +----------------------+

   +--------------------+     +--------------------+
   |    clients/         |     |    services/        |
   |  base.py, bangumi   |     |  cache.py, retry.py |
   |  anitabi.py         |     +--------------------+
   +--------------------+
   |    config/          |
   |  settings.py        |
   +--------------------+
```

### 1.2 Dependency Direction

Dependencies flow correctly downward in the vast majority of cases.

**Issue #1 (P2, confidence 8/10): `sql_agent.py` creates LLM agents for location resolution**

- File: `backend/agents/sql_agent.py:138-148`
- `resolve_location()` instantiates a Pydantic AI agent to fuzzy-match location names.
  This means the "deterministic SQL layer" makes LLM calls, creating a hidden
  dependency on model availability and adding ~1s latency for every unknown location.

- Recommendation: Move LLM-based location resolution to the planner or a dedicated
  geocoding step. Keep `resolve_location` purely dictionary + Google Geocoding.

**Issue #2 (P2, confidence 7/10): `session_facade.py` makes LLM calls**

- File: `backend/interfaces/session_facade.py:263,312`
- `compact_session_interactions()` and `generate_and_save_title()` call
  `create_agent()` to summarize sessions and generate titles. These are
  fire-and-forget `asyncio.create_task` calls from the interface layer.

- While acceptable for background work, these LLM calls silently degrade
  the interface layer's determinism. If the LLM is down, sessions never
  compact and titles never generate without error propagation.

**Issue #3 (P1, confidence 9/10): Module-level singleton state in `retriever.py`**

- File: `backend/agents/retriever.py:36-38`
- `_SHARED_RETRIEVAL_CACHE` is a module-level `ResponseCache`. This is
  effectively a global singleton. Tests that import this module share
  cache state, and the cache's cleanup task may fail to start if imported
  before an event loop exists.

### 1.3 Component Boundaries

The separation between agents, application, and infrastructure is well done.

- **Ports/Adapters pattern** is correctly applied: `AnitabiGateway` and
  `BangumiGateway` are Protocols in `application/ports/`, with concrete
  implementations in `infrastructure/gateways/`.

- **Use cases** (`fetch_bangumi_points`, `get_bangumi_subject`,
  `search_bangumi_subjects`) are minimal callable dataclasses --
  clean and focused.

- **SupabaseClient** uses a repository delegation pattern via `__getattr__`,
  which keeps the client interface backward-compatible while keeping
  repository code modular.

### 1.4 Data Flow

```
User text
    |
    v
FastAPI service  -->  RuntimeAPI.handle()
    |
    v
Pipeline (react_loop)
    |  classify_intent() [deterministic, ~1ms]
    |
    +---> ReActPlannerAgent.step() [LLM call]
    |         |
    |         v
    |     ReactStep { thought, action | done }
    |
    +---> ExecutorAgent._execute_step()
    |         |
    |         v
    |     Handler (resolve_anime, search_bangumi, ...)
    |         |
    |         v
    |     Retriever.execute() --> SQLAgent --> asyncpg
    |
    +---> Observation fed back to planner
    |
    v (loop up to 8 turns)
    |
    v
PipelineResult --> response_builder --> PublicAPIResponse
```

**Issue #4 (P2, confidence 8/10): `pipeline.py` accesses `executor._execute_step()` directly**

- File: `backend/agents/pipeline.py:107`
- The `react_loop` function calls `executor._execute_step()` (private method)
  instead of going through `executor.execute()`. This bypasses the
  `_build_output` logic and couples the react loop to internal executor state.

### 1.5 Scaling Bottlenecks

**Issue #5 (P1, confidence 9/10): In-memory session store in production**

- The `InMemorySessionStore` does not persist across container restarts.
  While `SupabaseSessionStore` is available, the factory silently falls
  back to in-memory when no DB is provided. A misconfigured deploy loses
  all active sessions.

- The `SupabaseSessionStore` has a FIFO cache (dict, not LRU) that may
  grow to 256 entries. For high-traffic deploys this is fine, but there
  is no TTL-based eviction -- stale entries persist until pushed out.

**Issue #6 (P2, confidence 7/10): `ResponseCache` uses `threading.Lock` in async code**

- File: `backend/services/cache.py:78,126,162`
- `ResponseCache` wraps an `OrderedDict` with `threading.Lock`. In an
  async context this blocks the event loop during every cache read/write.
  Should use `asyncio.Lock` for the async interface, or keep it sync-only
  and document thread-safety bounds.

---

## 2. Code Quality Review

### 2.1 File Size

| File                        | Lines | Status     |
|-----------------------------|-------|------------|
| `interfaces/fastapi_service.py` | 643   | Over 500  |
| `agents/retriever.py`       | 551   | Over 500  |
| `interfaces/public_api.py`  | 542   | Over 500  |
| `clients/base.py`           | 533   | Over 500  |

**Issue #7 (P2, confidence 9/10): 4 files exceed the 500-line project guideline**

- `fastapi_service.py` is the worst offender (643 lines). It mixes route
  handlers, exception handlers, middleware, lifespan management, and helpers.

- `base.py` (HTTP client) has 533 lines but is cohesive -- acceptable as-is.
- Recommendation: Extract `create_fastapi_app`, middleware, and exception
  handlers into separate modules.

### 2.2 DRY Violations

**Issue #8 (P2, confidence 8/10): Gateway adapter duplication**

- Files: `infrastructure/gateways/bangumi.py`, `infrastructure/gateways/anitabi.py`
- Both gateways repeat the same pattern: check if `self._client` exists,
  use it; otherwise `async with Client() as client:`. This 4-line block
  is duplicated 6 times across the two files.

- A mixin or base adapter class could eliminate this.

**Issue #9 (P2, confidence 7/10): Coordinate validation exists in two places**

- `domain/entities.py:38-47` (Coordinates model with validators)
- `agents/route_optimizer.py:38-81` (validate_coordinates function)
- The Coordinates model already validates ranges, but `validate_coordinates()`
  re-checks dict rows. This is intentional (dict vs model) but the null-island
  check and range logic should share a single source of truth.

### 2.3 Error Handling

Error handling is generally excellent:

- Three-tier error hierarchy: `DomainException` -> `ApplicationError` -> `clients.APIError`
- Gateway adapters properly translate `APIError` to `ApplicationError` subtypes
- FastAPI exception handlers catch `RequestValidationError`, `ValidationError`,
  `HTTPException`, and generic `Exception` with proper error codes

- Pipeline failures propagate as `StepResult(success=False)` and the ReAct
  loop retries up to 2 consecutive failures

**Issue #10 (P2, confidence 8/10): Silent exception swallowing in `public_api.py`**

- File: `backend/interfaces/public_api.py:258-273,308-309`
- Multiple `except Exception:` blocks with only `logger.warning()` --
  user message persistence, request log insertion, and user memory operations
  silently swallow errors. While best-effort semantics are acceptable,
  these should at minimum increment an error counter for monitoring.

### 2.4 Naming & Consistency

- Consistent use of `structlog` throughout (no raw `print` or `logging`)
- Private helpers prefixed with `_` consistently
- Handler module follows a clean pattern: each handler is a single `execute()`
  function with the same signature

- `ToolName` enum provides a single source of truth for tool identifiers

### 2.5 Type Safety

- **No `Any`** in source files (project rule enforced via mypy)
- `object` used at trust boundaries with proper `isinstance()` narrowing
- `cast()` used sparingly and only at documented library boundaries
- `Protocol` types for asyncpg, session store, and OTel
- Pydantic models for all public-facing data structures

---

## 3. Test Coverage Review

### 3.1 Coverage Map

```
Source Module                              Unit Test                      Rating
-------------------------------------     ----------------------------   ------
agents/models.py                           test_models.py                 ***
agents/pipeline.py                         test_pipeline.py               ***
                                           test_pipeline_react.py         ***
agents/planner_agent.py                    test_planner_agent.py          ***
                                           test_planner_react.py          **
agents/executor_agent.py                   test_executor_agent.py         **
                                           test_executor_observation.py   **
agents/retriever.py                        test_retriever.py              ***
agents/sql_agent.py                        test_sql_agent.py              *
agents/intent_classifier.py                test_intent_classifier.py      **
agents/base.py                             (no dedicated test)            -
agents/messages.py                         test_messages.py               **
agents/route_optimizer.py                  test_route_optimizer.py        ***
agents/route_export.py                     test_route_export.py           **
agents/handlers/*                          test_handlers.py               **
interfaces/fastapi_service.py              test_fastapi_service_helpers.py **
interfaces/public_api.py                   test_public_api.py             ***
interfaces/response_builder.py             test_response_builder.py       ***
interfaces/session_facade.py               test_session_facade.py         ***
interfaces/schemas.py                      (tested via public_api tests)  **
infrastructure/supabase/client.py          test_supabase_client.py        ***
infrastructure/supabase/helpers.py         (no dedicated test)            -
infrastructure/supabase/repositories/*     (no unit tests)                -
infrastructure/gateways/bangumi.py         test_gateway_contracts.py      ***
                                           test_gateway_error_mapping.py  **
infrastructure/gateways/anitabi.py         test_gateway_contracts.py      ***
infrastructure/gateways/geocoding.py       (no dedicated test)            -
infrastructure/session/memory.py           test_infra_session_store.py    **
infrastructure/session/supabase_session.py test_supabase_session.py       **
infrastructure/observability/*             test_observability.py          **
application/errors.py                      (tested transitively)          *
application/ports/*                        (Protocol-only, no tests)      N/A
application/use_cases/*                    (no dedicated tests)           -
domain/entities.py                         test_entities.py               ***
domain/errors.py                           (no dedicated test)            -
domain/llm_schemas.py                      test_llm_schemas.py            **
clients/base.py                            test_base_client.py            ***
clients/bangumi.py                         test_bangumi_client.py         ***
clients/anitabi.py                         test_anitabi_client.py         ***
clients/errors.py                          (tested transitively)          *
config/settings.py                         test_settings.py               ***
services/cache.py                          test_cache.py                  ***
services/retry.py                          test_retry.py                  ***
utils/logger.py                            test_logger.py                 *

Integration tests:
  test_api_contract.py                     Full API contract (441 lines)  ***
  test_sse_contract.py                     SSE streaming contract         ***
  test_runtime_acceptance.py               Runtime acceptance             **
  test_e2e_smoke.py                        E2E smoke tests                **

Eval tests:
  test_plan_quality.py                     Plan quality gate (LLM-backed) ***
  test_api_e2e.py                          API e2e with live model        **

Legend: *** = thorough, ** = adequate, * = minimal, - = missing
```

### 3.2 Coverage Gaps

**Issue #11 (P1, confidence 10/10): No unit tests for Supabase repositories**

- Files: `repositories/bangumi.py`, `repositories/points.py`,
  `repositories/feedback.py`, `repositories/routes.py`,
  `repositories/session.py`, `repositories/messages.py`,
  `repositories/user_memory.py`

- These 7 repository modules contain raw SQL and are only tested at the
  integration level (which requires a running Postgres with PostGIS).

- Risk: SQL typos, wrong column names, or missing ON CONFLICT clauses
  would only be caught in integration tests.

**Issue #12 (P2, confidence 9/10): No unit tests for `application/use_cases/`**

- `FetchBangumiPoints`, `GetBangumiSubject`, `SearchBangumiSubjects` are
  untested callable dataclasses. While trivial, they should have at minimum
  a smoke test ensuring correct delegation.

**Issue #13 (P2, confidence 8/10): `geocoding.py` gateway has no test**

- File: `backend/infrastructure/gateways/geocoding.py`
- Google Geocoding gateway has no unit test. HTTP responses should be
  mocked to verify candidate parsing and error handling.

**Issue #14 (P2, confidence 8/10): `sql_agent.py` test coverage is minimal**

- File: `backend/tests/unit/test_sql_agent.py` (only 86 lines)
- The SQLAgent generates parameterized SQL for 3 different query types
  plus location resolution. Current tests barely cover the happy path.

**Issue #15 (P2, confidence 7/10): `test_points_schema_alignment.py` is empty**

- File: `backend/tests/unit/test_points_schema_alignment.py` (0 lines)
- This appears to be a placeholder that was never implemented.

---

## 4. Performance Review

### 4.1 Query Patterns

**Issue #16 (P1, confidence 9/10): O(n^2) clustering algorithm**

- File: `backend/agents/route_optimizer.py:136-145`
- `cluster_by_location()` compares every pair of points with `haversine_distance()`.
  For n=200 points this is 19,900 distance calculations. While currently
  bounded by `_DEFAULT_GEO_LIMIT = 200`, this could become slow if limits increase.

- Recommendation: Use a spatial index (R-tree) or grid-based approach.
  For typical sizes (<200) this is acceptable but should be documented.

**Issue #17 (P2, confidence 8/10): `resolve_location()` makes 3 sequential network calls**

- File: `backend/agents/sql_agent.py:119-172`
- Resolution order: dict lookup -> LLM agent call -> Google Geocoding API.
  If the dict misses and the LLM fails, the user waits for both to timeout
  before falling back to geocoding.

- The LLM call in particular is wasteful for most well-known locations.
  Consider expanding `KNOWN_LOCATIONS` dict or caching LLM results.

**Issue #18 (P2, confidence 7/10): No connection pooling for external HTTP clients**

- Each `BangumiClientGateway` and `AnitabiClientGateway` call creates a fresh
  `aiohttp.ClientSession` (via `async with Client() as client:`).

- File: `infrastructure/gateways/bangumi.py:54`, `anitabi.py:44`
- Creating/destroying TCP connections per call adds latency and is wasteful.
- The gateway docstring acknowledges this ("avoids cross-loop session issues")
  but the underlying issue should be solved with proper session lifecycle.

### 4.2 Caching

Caching is implemented at two levels:

1. **Client-level**: `BaseHTTPClient` caches GET responses via `ResponseCache`
   (1-hour TTL for Anitabi, 24-hour for Bangumi). Effective for repeated lookups.

2. **Retriever-level**: `_SHARED_RETRIEVAL_CACHE` with 15-minute TTL caches
   `RetrievalResult` objects. Only caches non-empty successful results.

**Issue #19 (P2, confidence 7/10): Cache uses `datetime.now()` (no timezone)**

- File: `backend/services/cache.py:42`
- `CacheEntry.is_expired()` uses `datetime.now()` without timezone.
  All other code uses `datetime.now(UTC)`. While this is consistent
  within the cache module, it creates a subtle timezone mismatch risk
  if the cache is ever serialized or compared with UTC timestamps.

### 4.3 Database

- All SQL uses parameterized queries (no string interpolation) -- safe and performant
- PostGIS spatial queries use `ST_DWithin` with geography type -- optimal for
  radius searches

- `upsert_points_batch` uses `executemany` inside a transaction -- efficient batch writes
- Points table joins with bangumi table on every query -- index on
  `points.bangumi_id` is critical (assumed from schema but not verified in code)

---

## 5. Dependency Analysis

### 5.1 Inter-Module Import Diagram

```
interfaces/
    fastapi_service  ---> public_api, schemas, session (infra), supabase, observability
    public_api       ---> pipeline, executor_agent, session_facade, response_builder, schemas
    response_builder ---> executor_agent, application/errors, schemas
    session_facade   ---> agents/base, executor_agent, models, session (infra), schemas

agents/
    pipeline         ---> executor_agent, intent_classifier, models, planner_agent
    planner_agent    ---> base, intent_classifier, models
    executor_agent   ---> handlers/*, messages, models, retriever
    retriever        ---> sql_agent, use_cases/*, clients/anitabi, gateways/*, supabase/client, cache
    sql_agent        ---> base, models, gateways/geocoding, supabase/client
    handlers/*       ---> models, retriever, helpers, sql_agent

application/
    use_cases/*      ---> ports/* (Protocol), domain/entities
    errors.py        ---> (standalone)

infrastructure/
    gateways/*       ---> clients/*, application/errors, application/ports, domain/*
    supabase/*       ---> client_types (Protocol)
    session/*        ---> supabase/client (TYPE_CHECKING only)

clients/
    base.py          ---> errors, cache, retry, logger
    bangumi.py       ---> base, errors, logger
    anitabi.py       ---> base, errors, config, domain/entities, logger

domain/
    entities.py      ---> (standalone, Pydantic only)
    errors.py        ---> (standalone)
```

### 5.2 Dependency Direction Violations

**Issue #20 (P2, confidence 8/10): `clients/anitabi.py` imports `domain/entities.py`**

- File: `backend/clients/anitabi.py:22-25`
- The client layer (infrastructure adapter) imports domain entities
  (`Point`, `Station`, `Coordinates`). In strict Clean Architecture,
  clients should return raw dicts and let use cases / gateways map to
  domain entities.

- The `AnitabiClient.get_bangumi_points()` method returns `list[Point]`,
  which means the HTTP client knows about domain models. This is a
  pragmatic shortcut but technically violates dependency direction.

**Issue #21 (P2, confidence 7/10): `agents/retriever.py` imports concrete gateway implementations**

- File: `backend/agents/retriever.py:26-29`
- The Retriever directly imports `AnitabiClientGateway`, `BangumiClientGateway`,
  and `AnitabiClient` -- concrete infrastructure types. It should depend
  on the Protocols from `application/ports/` instead.

### 5.3 External Dependencies

| Dependency          | Version     | Pinning  | Status     |
|---------------------|-------------|----------|------------|
| pydantic            | >=2.12.0    | Floor    | Active     |
| pydantic-ai         | >=1.69.0    | Floor    | Active     |
| aiohttp             | >=3.13.5    | Floor    | Active     |
| httpx               | >=0.28.0    | Floor    | Active     |
| asyncpg             | >=0.31.0    | Floor    | Active     |
| fastapi             | >=0.115.0   | Floor    | Active     |
| structlog           | >=25.0.0    | Floor    | Active     |
| google-genai        | >=1.16.0    | Floor    | Active     |
| opentelemetry-api   | >=1.39.0    | Floor    | Active     |

**Issue #22 (P2, confidence 6/10): No upper bounds on dependency versions**

- All dependencies use `>=` floor pins only. A major version bump in
  `pydantic-ai` or `fastapi` could silently break the build.

- Recommendation: Use `>=X,<Y` or a lockfile for reproducible deploys.

**Issue #23 (P2, confidence 7/10): `httpx` is declared but not imported anywhere in source**

- `httpx>=0.28.0` is in `dependencies` but no backend source file imports it.
  It may be a transitive dependency of pydantic-ai but should be verified.

---

## 6. Security Review

### 6.1 Authentication

- Auth is enforced in the Cloudflare Worker (`worker/worker.js`) before
  reaching the container -- correct trust boundary

- Container trusts `X-User-Id` / `X-User-Type` headers from the Worker
- FastAPI dependency injection properly extracts and validates headers
- `_require_trusted_user` rejects requests without `X-User-Id`

### 6.2 SQL Injection

- All SQL uses asyncpg parameterized queries (`$1`, `$2`, ...)
- `_validate_columns()` in `helpers.py` rejects unknown column names,
  preventing column-injection in dynamic upsert queries

- `find_bangumi_by_title` uses `ILIKE $1` with parameter binding -- safe

**Issue #24 (P1, confidence 8/10): Dynamic SQL column construction in `upsert_bangumi`**

- File: `infrastructure/supabase/repositories/bangumi.py:31-41`
- While `_validate_columns` checks against an allowlist, the column names
  themselves are interpolated into SQL strings (not parameterized). This is
  safe because the allowlist is a hardcoded `frozenset`, but it's a pattern
  that could become dangerous if the allowlist is ever made dynamic.

### 6.3 Input Validation

- `PublicAPIRequest` validates text is non-empty, cleans point IDs, strips whitespace
- `FeedbackRequest` validates rating is `"good" | "bad"`, strips optional fields
- `BaseHTTPClient` validates URL scheme (SSRF prevention)
- `Settings` rejects wildcard CORS in production

### 6.4 Secret Management

- API keys are loaded from environment variables via `pydantic-settings`
- `_mask_secret()` prevents accidental logging of secrets
- No hardcoded secrets found in source code
- Google Geocoding API key read from `os.environ.get("GOOGLE_MAPS_API_KEY")`

---

## 7. Priority-Ordered Action Items

### P0 (Critical -- fix before next deploy)

None identified. The system is production-ready.

### P1 (High -- fix within 1 sprint)

| # | Issue | File | Action |
|---|-------|------|--------|
| 5 | Session store fallback to in-memory | `session/factory.py` | Add startup warning when no DB is provided; log prominently |
| 11 | No unit tests for 7 repository modules | `repositories/*` | Add unit tests with mock pool (no real DB needed) |
| 3 | Module-level singleton cache | `retriever.py:36` | Make cache injectable via constructor, remove module global |
| 16 | O(n^2) clustering | `route_optimizer.py:136` | Document O(n^2) bound; add guard for n>500 |
| 24 | Dynamic SQL column names | `bangumi.py:31` | Add comment documenting safety invariant |

### P2 (Medium -- fix within 2 sprints)

| # | Issue | File | Action |
|---|-------|------|--------|
| 1 | LLM in sql_agent | `sql_agent.py:138` | Move LLM location resolution to dedicated step |
| 2 | LLM in session_facade | `session_facade.py:263,312` | Add error counters; consider making optional |
| 4 | Private method access | `pipeline.py:107` | Add public method on ExecutorAgent for single-step |
| 6 | Threading Lock in async cache | `cache.py:78` | Switch to asyncio.Lock |
| 7 | 4 files over 500 lines | Multiple | Split fastapi_service.py first |
| 8 | Gateway adapter duplication | `gateways/*.py` | Extract base adapter mixin |
| 10 | Silent exception swallowing | `public_api.py:258` | Add error metrics counter |
| 12 | No use_case tests | `use_cases/*.py` | Add smoke tests |
| 13 | No geocoding test | `geocoding.py` | Add unit test with mocked HTTP |
| 14 | Minimal sql_agent tests | `test_sql_agent.py` | Expand to cover all 3 query types |
| 15 | Empty test file | `test_points_schema_alignment.py` | Delete or implement |
| 17 | Sequential resolve_location | `sql_agent.py:119` | Cache LLM results; expand dict |
| 18 | No HTTP connection pooling | `gateways/*.py` | Share session across calls |
| 19 | Cache timezone mismatch | `cache.py:42` | Use `datetime.now(UTC)` |
| 20 | Client imports domain | `clients/anitabi.py:22` | Return raw dicts, map in gateway |
| 21 | Retriever imports concrete types | `retriever.py:26` | Depend on Protocols |
| 22 | No dep version ceilings | `pyproject.toml` | Add upper bounds or lockfile |
| 23 | Unused httpx dependency | `pyproject.toml` | Verify or remove |

---

## 8. Observations (Non-Issues)

These are patterns I reviewed and concluded are correct:

1. **`object` used as db parameter type** -- Intentional. The executor and
   handlers accept `object` for the DB to support both `SupabaseClient`
   (production) and mock objects (tests). Type narrowing via `cast()` or
   `isinstance()` happens at the point of use. This is documented and consistent.

2. **`asyncio.create_task` for fire-and-forget operations** -- Used for
   session compaction and title generation. The tasks are non-critical
   and failures are logged. Acceptable pattern.

3. **ReAct loop with max 8 steps** -- The planner's `output_validator`
   enforces prerequisite dependencies, preventing wasted turns. The
   2-consecutive-failure circuit breaker prevents infinite loops.

4. **Module-level `app = create_fastapi_app()`** -- Standard uvicorn pattern
   for `if __name__ == "__main__"` entry. The lifespan context manager
   handles proper startup/shutdown.

5. **`__getattr__` delegation in SupabaseClient** -- Pragmatic pattern for
   backward compatibility during repository extraction. Well-documented
   and tested.
