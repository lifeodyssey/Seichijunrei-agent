# Observability + Error Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent failures visible, debuggable, and user-friendly — from Logfire traces to SSE error events to frontend error messages.

**Architecture:** Three layers: (1) Logfire auto-instruments PydanticAI agent + FastAPI + HTTPX for full trace visibility, (2) backend error chain passes structured error info through SSE to frontend, (3) frontend shows actionable error messages instead of raw ✗ or "500".

**Tech Stack:** PydanticAI + Logfire (OpenTelemetry), FastAPI SSE, React ThinkingProcess component

---

### Task 1: Extend Logfire setup — instrument FastAPI + HTTPX

**Files:**
- Modify: `backend/interfaces/routes/_deps.py:208-226`
- Modify: `backend/interfaces/fastapi_service.py:53` (pass app to setup_logfire)
- Test: `backend/tests/unit/test_fastapi_service_helpers.py`

- [ ] **Step 1: Write failing test — Logfire instruments FastAPI when token is set**

```python
# In backend/tests/unit/test_fastapi_service_helpers.py
def test_setup_logfire_instruments_fastapi(monkeypatch: pytest.MonkeyPatch) -> None:
    """setup_logfire should call instrument_fastapi when LOGFIRE_TOKEN is set."""
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    mock_logfire = MagicMock()
    monkeypatch.setattr("backend.interfaces.routes._deps.logfire", mock_logfire, raising=False)
    with patch.dict("sys.modules", {"logfire": mock_logfire}):
        from backend.interfaces.routes._deps import setup_logfire
        settings = MagicMock()
        settings.observability_service_name = "test"
        settings.observability_service_version = "0.0.1"
        mock_app = MagicMock()
        setup_logfire(settings, app=mock_app)
        mock_logfire.instrument_fastapi.assert_called_once_with(mock_app)
        mock_logfire.instrument_httpx.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/unit/test_fastapi_service_helpers.py::test_setup_logfire_instruments_fastapi -v`
Expected: FAIL — `setup_logfire` doesn't accept `app` parameter

- [ ] **Step 3: Update `setup_logfire` to accept `app` and instrument FastAPI + HTTPX**

In `backend/interfaces/routes/_deps.py`, replace the existing `setup_logfire`:

```python
def setup_logfire(settings: Settings, app: object | None = None) -> None:
    """Configure Logfire for pydantic-ai agent tracing (no-op if token not set).

    When ``app`` is a FastAPI instance, also instruments FastAPI routes and
    HTTPX outbound calls for full-stack trace visibility.
    """
    import os

    if not os.environ.get("LOGFIRE_TOKEN"):
        _logger.debug("logfire_skipped", reason="LOGFIRE_TOKEN not set")
        return
    try:
        import logfire

        logfire.configure(
            service_name=settings.observability_service_name,
            service_version=settings.observability_service_version,
        )
        logfire.instrument_pydantic_ai()
        if app is not None:
            logfire.instrument_fastapi(app)
        logfire.instrument_httpx()
        _logger.info("logfire_configured", service=settings.observability_service_name)
    except ImportError:
        _logger.debug("logfire_skipped", reason="logfire package not installed")
```

- [ ] **Step 4: Pass `app` to `setup_logfire` in `fastapi_service.py`**

In `backend/interfaces/fastapi_service.py`, change line 53 area. Move `setup_logfire` call after `app = FastAPI(...)` so we have the app instance:

```python
    app = FastAPI(lifespan=lifespan)
    app.add_middleware(...)
    register_exception_handlers(app)
    register_observability_middleware(app)

    # Logfire: instrument agent + FastAPI + HTTPX (no-op if LOGFIRE_TOKEN not set)
    setup_logfire(resolved_settings, app=app)

    app.include_router(health_router)
    ...
```

Remove the old `setup_logfire(resolved_settings)` call that was before `app` creation.

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest backend/tests/unit/test_fastapi_service_helpers.py -v`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `make check`
Expected: All pass, lint + typecheck clean

- [ ] **Step 7: Commit**

```bash
git add backend/interfaces/routes/_deps.py backend/interfaces/fastapi_service.py backend/tests/unit/test_fastapi_service_helpers.py
git commit -m "feat: extend Logfire setup to instrument FastAPI + HTTPX"
```

---

### Task 2: SSE error chain — pass error detail from tool handler to frontend

**Files:**
- Modify: `backend/agents/pilgrimage_tools.py:110-139` (`_run_handler`)
- Modify: `backend/interfaces/routes/runtime.py:70-88` (`run_pipeline_task`)
- Test: `backend/tests/unit/test_handlers.py`

- [ ] **Step 1: Write failing test — `_emit_step` includes error on failure**

```python
# In backend/tests/unit/test_handlers.py, add to existing test class:

class TestRunHandlerErrorEmit:
    """_run_handler emits error message in failed step events."""

    async def test_failed_step_emits_error_in_data(self) -> None:
        """When handler fails, the SSE step event should contain the error message."""
        from backend.agents.pilgrimage_tools import _run_handler

        db = _mock_supabase()
        db.bangumi.find_all_by_title = AsyncMock(return_value=[])
        db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)
        db.bangumi.upsert_bangumi_title = AsyncMock()

        emitted_steps: list[tuple[str, str, dict]] = []

        async def capture_step(tool, status, data, thought="", observation=""):
            emitted_steps.append((tool, status, data))

        deps = RuntimeDeps(db=db, locale="en", query="test", on_step=capture_step)

        mock_ctx = MagicMock()
        mock_ctx.deps = deps

        async def failing_handler(step, context, db, retriever):
            return HandlerResult.fail("test_tool", "Something broke")

        result = await _run_handler(
            mock_ctx,
            tool=ToolName.RESOLVE_ANIME,
            params={"title": "test"},
            handler=failing_handler,
        )

        failed_events = [(t, s, d) for t, s, d in emitted_steps if s == "failed"]
        assert len(failed_events) == 1
        _, _, data = failed_events[0]
        assert "error" in data
        assert data["error"] == "Something broke"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/unit/test_handlers.py::TestRunHandlerErrorEmit -v`
Expected: FAIL — `_run_handler` not importable at top level or data has no "error" key

- [ ] **Step 3: Update `_run_handler` to pass error in failed step event**

In `backend/agents/pilgrimage_tools.py`, update the `else` branch in `_run_handler`:

```python
    if result.success and result.data:
        deps.tool_state[tool.value] = result.data
        await _emit_step(deps, tool.value, "done", result.data)
    else:
        error_data: dict[str, object] = {"error": result.error or "Unknown error"}
        if result.data:
            error_data.update(result.data)
        await _emit_step(
            deps,
            tool.value,
            "failed",
            error_data,
            observation=result.error or "",
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/unit/test_handlers.py::TestRunHandlerErrorEmit -v`
Expected: PASS

- [ ] **Step 5: Update SSE error event to include error detail**

In `backend/interfaces/routes/runtime.py`, update `run_pipeline_task`:

```python
    async def run_pipeline_task() -> None:
        try:
            response = await runtime_api.handle(
                api_request,
                user_id=auth.user_id,
                on_step=on_step,
            )
            await emit("done", response.model_dump(mode="json"))
        except Exception as exc:
            error_message = str(exc)
            logger.exception("sse_pipeline_error", error=error_message)
            # Emit a user-facing error with enough detail for debugging
            await emit(
                "error",
                {
                    "code": "internal_error",
                    "message": _user_facing_error(error_message),
                    "detail": error_message[:500],
                },
            )
        finally:
            await queue.put(None)
```

Add the helper at module level:

```python
def _user_facing_error(raw: str) -> str:
    """Convert raw exception text to a user-friendly message."""
    lower = raw.lower()
    if "timeout" in lower:
        return "The request took too long. Please try again with a simpler query."
    if "validation" in lower:
        return "There was a data processing error. Please try a different query."
    if "rate" in lower and "limit" in lower:
        return "The service is busy. Please wait a moment and try again."
    return "Something went wrong. Please try again."
```

- [ ] **Step 6: Run full test suite**

Run: `make test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add backend/agents/pilgrimage_tools.py backend/interfaces/routes/runtime.py backend/tests/unit/test_handlers.py
git commit -m "feat: pass structured error detail through SSE to frontend"
```

---

### Task 3: Frontend — display error messages in ThinkingProcess

**Files:**
- Modify: `frontend/lib/types/api.ts:40-45` (StepEvent type)
- Modify: `frontend/lib/api/runtime.ts:241-255` (SSE parser — pass observation)
- Modify: `frontend/components/chat/ThinkingProcess.tsx:121-132`
- Test: `frontend/tests/ThinkingProcess.test.tsx` (if exists, else skip)

- [ ] **Step 1: Extend `StepEvent` type with optional `error` field**

In `frontend/lib/types/api.ts`:

```typescript
export interface StepEvent {
  tool: string;
  status: "running" | "done" | "failed";
  thought?: string;
  observation?: string;
  error?: string;  // NEW: error message for failed steps
}
```

- [ ] **Step 2: Update SSE parser to extract error/observation from step events**

In `frontend/lib/api/runtime.ts`, in the `consume` function where `event === "step"` is handled, add error extraction:

```typescript
if (event === "step" && payload.tool && payload.status) {
  // ... existing clarify logic ...
  onStep?.(
    payload.tool,
    payload.status,
    typeof payload.thought === "string" ? payload.thought : undefined,
    // For failed steps, use error as observation so ThinkingProcess shows it
    typeof payload.observation === "string" && payload.observation
      ? payload.observation
      : typeof payload.data === "object" && payload.data !== null && "error" in payload.data
        ? String((payload.data as Record<string, unknown>).error)
        : undefined,
  );
}
```

- [ ] **Step 3: Update ThinkingProcess to show error messages prominently**

In `frontend/components/chat/ThinkingProcess.tsx`, update the observation display (around line 121-132):

```tsx
{step.observation && !isRunning && (
  <div
    className="ml-5 text-[11px]"
    style={
      isFailed
        ? { color: "var(--color-error-fg)" }
        : { color: "var(--color-muted-fg)" }
    }
  >
    {isFailed ? "\u26A0" : "\u2192"} {step.observation}
  </div>
)}
```

This changes the arrow (→) to a warning icon (⚠) for failed steps.

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npm run test -- --run`
Expected: All pass (or no existing ThinkingProcess tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types/api.ts frontend/lib/api/runtime.ts frontend/components/chat/ThinkingProcess.tsx
git commit -m "feat: display structured error messages in thinking steps"
```

---

### Task 4: SSE error event — frontend handles `event: error` gracefully

**Files:**
- Modify: `frontend/lib/api/runtime.ts:256-272` (consume function, error event handling)
- Modify: `frontend/hooks/useChat.ts:125-134` (error display)

- [ ] **Step 1: Update SSE parser to extract detail from error events**

In `frontend/lib/api/runtime.ts`, the `consume` function already has:

```typescript
if (event === "error") {
  throw new Error(typeof payload.message === "string" ? payload.message : "Stream error");
}
```

Update it to include the detail for debugging while keeping a user-friendly message:

```typescript
if (event === "error") {
  const message = typeof payload.message === "string"
    ? payload.message
    : "Something went wrong. Please try again.";
  throw new Error(message);
}
```

This is already correct — the backend now sends `_user_facing_error()` as `message`. No change needed here.

- [ ] **Step 2: Verify `useChat.ts` shows error text on the message bubble**

In `frontend/hooks/useChat.ts`, confirm the error handling sets the message text (already exists at line 125-134):

```typescript
const errorText =
  err instanceof Error ? err.message : "Unknown error";
const errorCode = classifyError(err);
setMessages((prev) =>
  prev.map((m) =>
    m.id === placeholderId
      ? { ...m, text: errorText, loading: false, errorCode }
      : m,
  ),
);
```

This already works — the user-friendly error message from the backend will appear as the bot message. **No code change needed.** Verify manually only.

- [ ] **Step 3: Commit (if any changes made)**

```bash
# Only if changes were made
git add frontend/lib/api/runtime.ts frontend/hooks/useChat.ts
git commit -m "feat: improved error event handling in SSE parser"
```

---

### Task 5: Add Logfire MCP Server to Claude Code

**Files:**
- Modify: none (CLI configuration only)

- [ ] **Step 1: Register Logfire MCP server with Claude Code**

First, get the read token from Logfire web UI (or use the write token for read access):

```bash
claude mcp add logfire \
  -e LOGFIRE_READ_TOKEN="pylf_v1_us_NhmFgLwTWs60wGY4LwFbTVYw6DPY8DXnPQybln14M69b" \
  -- uvx logfire-mcp@latest
```

- [ ] **Step 2: Verify MCP server is registered**

```bash
claude mcp list
```

Expected: `logfire` appears in the list.

- [ ] **Step 3: Test query**

In a Claude Code session, ask: "Query Logfire for recent exceptions in the runtime"

Expected: Claude uses the Logfire MCP tools to query traces.

---

### Task 6: Agent timeout with graceful fallback

**Files:**
- Modify: `backend/agents/pilgrimage_runner.py:69-74` (add timeout to agent.run)
- Modify: `backend/interfaces/public_api.py:239-246` (catch timeout, return friendly response)
- Test: `backend/tests/unit/test_pilgrimage_runner.py`

- [ ] **Step 1: Write failing test — agent timeout raises TimeoutError**

```python
# In backend/tests/unit/test_pilgrimage_runner.py
async def test_agent_timeout_raises() -> None:
    """Agent run should respect timeout and raise asyncio.TimeoutError."""
    import asyncio
    from unittest.mock import MagicMock, AsyncMock, patch

    deps_mock = MagicMock()
    # Simulate a very slow agent
    with patch(
        "backend.agents.pilgrimage_runner.pilgrimage_agent"
    ) as mock_agent:
        async def slow_run(*args, **kwargs):
            await asyncio.sleep(999)

        mock_agent.run = slow_run

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                run_pilgrimage_agent(
                    text="test",
                    db=MagicMock(),
                    locale="en",
                ),
                timeout=0.1,
            )
```

- [ ] **Step 2: Run test — should pass (asyncio.wait_for already raises TimeoutError)**

Run: `uv run pytest backend/tests/unit/test_pilgrimage_runner.py::test_agent_timeout_raises -v`
Expected: PASS (this validates the pattern works)

- [ ] **Step 3: Add timeout wrapper in `public_api.py`**

In `backend/interfaces/public_api.py`, in `_execute_pipeline`, wrap the agent call with `asyncio.wait_for`:

```python
import asyncio

# In _execute_pipeline method, replace the agent call:
try:
    if has_selected:
        result = await execute_selected_route(...)
    else:
        result = await asyncio.wait_for(
            run_pilgrimage_agent(
                text=request.text,
                db=cast(DatabasePort, self._db),
                model=effective_model,
                locale=request.locale,
                context=context,
                on_step=on_step,
            ),
            timeout=90.0,  # 90 second hard limit
        )
except asyncio.TimeoutError:
    logger.warning("agent_timeout", text=request.text[:50])
    return (
        None,
        PublicAPIResponse(
            success=False,
            status="timeout",
            intent="error",
            message="The request took too long. Please try a simpler query or try again later.",
            errors=[
                PublicAPIError(
                    code=ErrorCode.TIMEOUT.value if hasattr(ErrorCode, 'TIMEOUT') else "timeout",
                    message="Agent execution timed out after 90 seconds.",
                )
            ],
        ),
        context_delta,
    )
except ApplicationError as exc:
    # ... existing handler ...
```

- [ ] **Step 4: Verify ErrorCode has TIMEOUT**

Check `backend/application/errors.py` for `ErrorCode.TIMEOUT`. If it doesn't exist, add it:

```python
class ErrorCode(str, Enum):
    ...
    TIMEOUT = "timeout"
```

- [ ] **Step 5: Run full test suite**

Run: `make check`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add backend/interfaces/public_api.py backend/application/errors.py backend/tests/unit/test_pilgrimage_runner.py
git commit -m "feat: agent timeout with graceful error response"
```

---

### Task 7: Verify end-to-end — Logfire traces + error display

**Files:** None (manual verification)

- [ ] **Step 1: Start backend with LOGFIRE_TOKEN**

```bash
set -a; source .env; set +a
export AUTO_MIGRATE=false DEFAULT_AGENT_MODEL="openai:gpt-5.5"
uv run seichijunrei-api
```

Verify in log: `logfire_configured` appears (not `logfire_skipped`).

- [ ] **Step 2: Send a request and check Logfire dashboard**

Open Logfire web UI (URL from `logfire.pydantic.dev`). Send a search request.
Verify: trace tree appears with agent run → tool calls → LLM requests.

- [ ] **Step 3: Trigger an error and verify frontend display**

Send a request that triggers a tool failure.
Verify: ThinkingProcess shows ⚠ with error message, not just ✗.

- [ ] **Step 4: Trigger a timeout and verify graceful response**

Send a complex query that takes >90 seconds.
Verify: frontend shows "The request took too long" message instead of spinning forever.

- [ ] **Step 5: Final commit — update spec status**

Update the memory file to note observability is implemented.
