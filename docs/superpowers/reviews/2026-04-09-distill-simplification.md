# Distill: Backend Simplification Analysis

**Date:** 2026-04-09
**Scope:** Three highest-LOC backend files
**Goal:** Identify dead code, unnecessary complexity, and simplification opportunities

---

## 1. `backend/interfaces/fastapi_service.py` (643 lines)

### Dead code / unused imports

None found. All imports are used. The file is clean in this regard.

### Overly long methods

| Method | Lines | Issue |
|--------|-------|-------|
| `handle_runtime_stream` | 75 | Three nested async closures (`emit`, `on_step`, `run_pipeline_task`, `event_generator`) defined inline. These could be extracted to reduce nesting. |
| `create_fastapi_app` | 70 | The lifespan context manager has two long branches (runtime_api provided vs. built from scratch). |
| `_register_exception_handlers` | 63 | Four inner functions registered as handlers. Acceptable pattern for FastAPI, but verbose. |

### Simplification proposals

**S1: Extract SSE helpers from `handle_runtime_stream`**

The three closures (`emit`, `on_step`, `run_pipeline_task`) capture `runtime_api`, `api_request`, `auth`, `queue`, and `request` from the enclosing scope. They could be a small dataclass or helper class.

```python
# Before: 75 lines with 3 nested closures
@router.post("/v1/runtime/stream")
async def handle_runtime_stream(...):
    queue = asyncio.Queue()
    async def emit(event, data): ...
    async def on_step(tool, status, data): ...
    async def run_pipeline_task(): ...
    async def event_generator(): ...
    return StreamingResponse(event_generator(), ...)

# After: ~30 lines in handler, ~40 lines in helper
class _SSEBridge:
    def __init__(self, runtime_api, api_request, auth, request): ...
    async def emit(self, event, data): ...
    async def on_step(self, tool, status, data): ...
    async def run(self): ...
    async def stream(self) -> AsyncIterator[str]: ...

@router.post("/v1/runtime/stream")
async def handle_runtime_stream(...):
    bridge = _SSEBridge(_get_runtime_api(request), api_request, auth, request)
    return StreamingResponse(bridge.stream(), ...)
```

Net effect: same total lines but flattened nesting, testable SSE bridge.

**S2: Collapse `_http_error_code` into a dict lookup**

```python
# Before: 14 lines of if/elif
def _http_error_code(status_code: int) -> str:
    if status_code == 400: return "invalid_request"
    if status_code == 401: return "authentication_error"
    ...

# After: 1 dict + 1 line
_HTTP_ERROR_CODES = {400: "invalid_request", 401: "authentication_error",
                     403: "forbidden", 404: "not_found", 409: "already_exists",
                     429: "rate_limited"}

def _http_error_code(status_code: int) -> str:
    if status_code >= 500: return "internal_error"
    return _HTTP_ERROR_CODES.get(status_code, "http_error")
```

Saves ~8 lines.

**S3: `_contains_json_invalid_error` can be a one-liner with `any()`**

```python
# Before: 5 lines
def _contains_json_invalid_error(errors_obj):
    if not isinstance(errors_obj, list): return False
    for item in errors_obj:
        if isinstance(item, dict) and item.get("type") == "json_invalid": return True
    return False

# After: 2 lines
def _contains_json_invalid_error(errors_obj):
    return isinstance(errors_obj, list) and any(
        isinstance(e, dict) and e.get("type") == "json_invalid" for e in errors_obj)
```

Saves ~3 lines.

**S4: Deduplicate the lifespan branches in `create_fastapi_app`**

The two branches (runtime_api provided vs. built) both set `app.state.runtime_api`, `app.state.db_client`, and run shutdown in `finally`. A single path with optional connect/close would flatten this.

```python
# Before: Two branches with duplicated state assignment and try/finally
if runtime_api is not None:
    app.state.runtime_api = runtime_api
    resolved_db = db if db is not None else getattr(runtime_api, "_db", None)
    ...
    try: yield
    finally: shutdown_observability()
    return

runtime_db = db if db is not None else _build_supabase_client(...)
...
app.state.runtime_api = RuntimeAPI(runtime_db, ...)
app.state.db_client = runtime_db
try: yield
finally: close stuff; shutdown_observability()

# After: Single path
needs_lifecycle = runtime_api is None
if needs_lifecycle:
    runtime_db = db or _build_supabase_client(resolved_settings)
    ...
    await _call_optional_async(runtime_db, "connect")
    resolved_api = RuntimeAPI(runtime_db, session_store=...)
else:
    resolved_api = runtime_api
    runtime_db = db or getattr(runtime_api, "_db", None)

app.state.runtime_api = resolved_api
app.state.db_client = runtime_db
try:
    yield
finally:
    if needs_lifecycle:
        await _call_optional_async(runtime_session_store, "close")
        await _call_optional_async(runtime_db, "close")
    if resolved_settings.observability_enabled:
        shutdown_observability()
```

Saves ~10 lines and removes early return.

### Estimated reduction: ~25 lines (643 -> ~618)

---

## 2. `backend/agents/retriever.py` (551 lines)

### Dead code / unused imports

| Item | Status |
|------|--------|
| `_request_to_sql_intent` (lines 498-510) | **Dead code.** Never called anywhere in the codebase. |
| `from types import SimpleNamespace` (line 16) | **Unused import.** Only used by dead `_request_to_sql_intent`. |

### Overly long methods

| Method | Lines | Issue |
|--------|-------|-------|
| `_execute_hybrid` | 52 | Multiple early-return branches for error cases. Acceptable but could be tighter. |
| `_write_through_bangumi_points` | 48 | Three return branches for error/empty/success. Clear but verbose. |
| `_ensure_bangumi_record` | 28 | Inline field extraction from `lite` dict has 4 repeated `if isinstance(x, str) and x` blocks. |
| `_execute_sql_with_fallback` | 30 | Fine overall. |

### Simplification proposals

**S5: Delete dead `_request_to_sql_intent` function and `SimpleNamespace` import**

This function is never called. Removing it saves 14 lines plus the import.

Saves ~15 lines.

**S6: Deduplicate lite field extraction in `_ensure_bangumi_record`**

```python
# Before: 12 lines of repeated pattern
lite_title = lite.get("title")
if isinstance(lite_title, str) and lite_title:
    metadata["title"] = lite_title
lite_cn = lite.get("cn")
if isinstance(lite_cn, str) and lite_cn:
    metadata["title_cn"] = lite_cn
lite_city = lite.get("city")
if isinstance(lite_city, str) and lite_city:
    metadata["city"] = lite_city
lite_cover = lite.get("cover")
if isinstance(lite_cover, str) and lite_cover:
    metadata["cover_url"] = lite_cover

# After: 5 lines with a mapping
_LITE_FIELD_MAP = {"title": "title", "cn": "title_cn", "city": "city", "cover": "cover_url"}
if lite:
    for src, dst in _LITE_FIELD_MAP.items():
        val = lite.get(src)
        if isinstance(val, str) and val:
            metadata[dst] = val
```

Saves ~7 lines.

**S7: `_clone_result` is called 3 times, always to add a single cache metadata key. Consider making cache tracking a property of RetrievalResult instead.**

This is a minor optimization. The deep-copy of `rows` on every cache hit/miss/write is defensive but may not be necessary since the result is consumed and discarded. If rows are never mutated downstream, the clone can be simplified to a shallow copy.

```python
# Before: Deep copies every row dict
rows=[dict(row) for row in result.rows],

# After: If immutability is guaranteed upstream
rows=result.rows,
```

This is a behavioral change (removes defensive copy) so it depends on whether any consumer mutates returned rows. Worth investigating but lower priority.

**S8: `_merge_rows_preserving_order` has redundant None checks**

```python
# Before:
row_id = str(sql_row.get("id")) if sql_row.get("id") is not None else None
if row_id is None:
    merged.append(dict(sql_row))
    continue

# After: Slightly tighter
row_id = sql_row.get("id")
if row_id is None:
    merged.append(dict(sql_row))
    continue
row_id_str = str(row_id)
geo_row = geo_by_id.get(row_id_str)
```

Minor clarity improvement, saves ~2 lines.

**S9: The `getattr(self._db, ..., None)` pattern is used 5 times in retriever.py**

Each call site does `method = getattr(self._db, "x", None); if method is None: return`. This is a cross-cutting concern. A small helper would reduce repetition:

```python
def _db_method(self, name: str) -> Callable[..., Awaitable[object]] | None:
    method = getattr(self._db, name, None)
    return method if callable(method) else None
```

Net savings: ~5 lines across the file, plus clearer intent.

### Estimated reduction: ~25 lines (551 -> ~526)

---

## 3. `backend/interfaces/public_api.py` (542 lines)

### Dead code / unused imports

| Item | Status |
|------|--------|
| Backward-compat aliases (lines 63-65) | Used only by tests. Could move to a `_compat` module or have tests import from `session_facade` directly. Not dead, but unnecessary indirection. |
| `handle_public_request` (lines 478-489) | Listed in `__all__`, but only used in tests and docs. Thin wrapper over `RuntimeAPI.handle`. Candidate for deprecation. |

### Overly long methods

| Method | Lines | Issue |
|--------|-------|-------|
| `RuntimeAPI.handle` | **155 lines (80-234 + finally block to 289)** | Far exceeds the 30-line guideline. This is the most complex method in the three files. |
| `_persist_user_state` | 52 | Two distinct responsibilities: upsert conversation + upsert user memory. |
| `_maybe_persist_route` | 58 | Deep nested dict navigation with many early returns. |
| `_extract_plan_steps` | 19 | Fine. |

### Simplification proposals

**S10: Break `RuntimeAPI.handle` into phases**

The 155-line method does: load session -> execute pipeline -> build response -> persist session -> persist messages -> persist user state -> persist route -> compact -> build summary -> telemetry. This should be at least 3-4 private methods.

```python
# Before: One 155-line method with deep nesting
async def handle(self, request, *, model, user_id, on_step):
    # ... 155 lines of everything ...

# After: Orchestrator + phases
async def handle(self, request, *, model, user_id, on_step):
    ctx = await self._prepare_context(request, user_id)
    result, response = await self._run_pipeline(request, ctx, model, on_step)
    if response.intent == "greet_user":
        return self._ephemeral_response(response)
    await self._persist_all(ctx, request, result, response, user_id)
    return self._finalize_response(response, ctx.session_state)
```

Each phase becomes a 20-30 line method. The `finally` block for telemetry stays in `handle` but shrinks since `ctx` carries all needed state.

Estimated savings: no net line reduction (may even add a few lines), but dramatically reduces cognitive complexity. The current method has 4 levels of nesting and interleaves I/O, error handling, and business logic.

**S11: The `getattr(self._db, ..., None)` pattern appears 7 times**

Same recommendation as S9. A shared `_optional_db_call` helper:

```python
async def _try_db(self, method_name: str, *args: object, **kwargs: object) -> object | None:
    method = getattr(self._db, method_name, None)
    if method is None:
        return None
    return await method(*args, **kwargs)
```

This would replace the pattern in `_persist_messages`, `_load_user_memory`, `_persist_user_state`, `_persist_session`, `_maybe_persist_route`, and the `finally` block. Each call site drops from 4-6 lines to 1.

Saves ~25 lines.

**S12: `_persist_user_state` does two unrelated things**

Split into `_upsert_conversation` and `_update_user_memory`. Each becomes ~15 lines.

No net line savings but improves single-responsibility.

**S13: `_extract_plan_steps` over-generalizes attribute access**

```python
# Before: 19 lines with getattr chains
for step in getattr(result.plan, "steps", []) or []:
    tool = getattr(step, "tool", None)
    if tool is not None:
        steps.append(getattr(tool, "value", str(tool)))
        continue
    step_type = getattr(step, "step_type", None)
    ...

# After: Rely on typed models (PlanStep has .tool: ToolName)
for step in result.plan.steps:
    steps.append(step.tool.value)
```

If the type is always `PlanStep` (which it should be per models.py), the `getattr` fallbacks are dead branches. Saves ~10 lines.

**S14: `_infer_bangumi_id` and `_get_plan_params` are only used once each**

Could be inlined into `_maybe_persist_route`. Minor savings (~5 lines each), but trades off readability. Lower priority.

### Estimated reduction: ~35 lines (542 -> ~507)

---

## Cross-file patterns

### P1: Repeated `getattr(self._db, method, None)` guard pattern

Appears **12 times** across `public_api.py` (7) and `retriever.py` (5). Both files use `db: object` typed loosely. A shared mixin or utility would eliminate this:

```python
# backend/infrastructure/db_protocol.py
async def call_optional(db: object, method: str, *args, **kwargs) -> object | None:
    fn = getattr(db, method, None)
    if fn is None: return None
    return await fn(*args, **kwargs)
```

This is the single highest-leverage simplification across all three files.

### P2: `fastapi_service.py` uses its own `_require_db_method` (same pattern, raises on miss)

Could share the same utility with a `required=True` flag.

### P3: Both `fastapi_service.py` and `public_api.py` import and use `SessionStore` / `create_session_store`

No duplication issue here -- fastapi_service creates the store, public_api uses it. Clean separation.

---

## Summary

| File | Current | Est. After | Savings | Complexity Reduction |
|------|---------|------------|---------|---------------------|
| `fastapi_service.py` | 643 | ~618 | ~25 | Moderate (SSE, lifespan) |
| `retriever.py` | 551 | ~526 | ~25 | Low-moderate (dead code, dedup) |
| `public_api.py` | 542 | ~507 | ~35 | **High** (handle method decomposition) |
| **Total** | **1736** | **~1651** | **~85** | |

### Quick wins (< 30 min each)

1. **S5**: Delete dead `_request_to_sql_intent` + `SimpleNamespace` import (-15 lines)
2. **S3**: `_contains_json_invalid_error` to `any()` (-3 lines)
3. **S2**: `_http_error_code` to dict lookup (-8 lines)
4. **S6**: Lite field extraction loop (-7 lines)
5. **S13**: Simplify `_extract_plan_steps` to use typed models (-10 lines)

### Larger refactors (1-2 hours each)

1. **S10**: Decompose `RuntimeAPI.handle` into phases (highest impact on maintainability)
2. **P1/S11**: Extract shared `call_optional` db utility (cross-file impact)
3. **S1**: Extract SSE bridge class from streaming endpoint
4. **S4**: Flatten lifespan branches in `create_fastapi_app`
