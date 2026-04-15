# Full FastAPI Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the aiohttp runtime adapter with FastAPI as the only backend HTTP entrypoint while preserving all current `/v1/*` JSON and SSE contracts.

**Architecture:** Keep `backend/interfaces/public_api.py` as the stable application façade and swap only the transport/adapter layer from aiohttp to FastAPI. The migration is complete, not coexistence: runtime entrypoints, tests, Docker startup, and CI import checks all move to FastAPI. Preserve request/response shapes so the frontend and Cloudflare Worker continue to work unchanged.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, Pydantic, existing `RuntimeAPI` façade, Cloudflare Worker + Container deployment.

---

## Context

The repo currently has a partially written `backend/interfaces/fastapi_service.py`, but production still runs `backend/interfaces/http_service.py` via:

- `pyproject.toml:50`
- `Makefile:45`
- `Dockerfile:41`
- `.github/workflows/ci.yml:114`
- `backend/interfaces/__init__.py:3`

A full cutover is preferred over coexistence. The main risk is not route coverage but **contract drift**:

- SSE must remain truly incremental
- error JSON shape must stay compatible with the frontend
- Worker auth headers (`X-User-Id`, `X-User-Type`) must still be trusted and read correctly
- healthz, feedback, conversations, messages, routes endpoints must keep the same semantics

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/interfaces/fastapi_service.py` | Finalize/Modify | Sole FastAPI runtime adapter with all endpoints |
| `backend/interfaces/http_service.py` | Remove or reduce to deprecation shim | Old aiohttp adapter to retire |
| `backend/interfaces/__init__.py` | Modify | Export FastAPI creation helpers instead of aiohttp |
| `pyproject.toml` | Modify | Switch `seichijunrei-api` script to FastAPI entrypoint |
| `Makefile` | Modify | `make serve` launches FastAPI-backed script |
| `Dockerfile` | Modify | Run uvicorn / FastAPI entrypoint |
| `.github/workflows/ci.yml` | Modify | Import check references FastAPI entrypoint |
| `.github/workflows/dependabot-agent.yml` | Modify | Import check references FastAPI entrypoint if present |
| `backend/tests/unit/test_http_service.py` | Rewrite/Rename | FastAPI adapter unit tests |
| `backend/tests/integration/test_http_service.py` | Rewrite/Rename | FastAPI adapter integration/SSE tests |
| `backend/tests/unit/test_error_sanitization.py` | Modify | Assert new FastAPI handler keeps same JSON shape |
| `DEPLOYMENT.md` | Modify | Replace aiohttp deployment references with FastAPI |

---

### Task 1: Lock transport contract before cutting over

**Files:**

- Modify: `backend/tests/unit/test_http_service.py`
- Modify: `backend/tests/integration/test_http_service.py`
- Modify: `backend/tests/unit/test_error_sanitization.py`

- [ ] **Step 1: Rename test modules to adapter-neutral names**

Rename tests so they assert transport contract, not aiohttp implementation naming:

- `backend/tests/unit/test_http_service.py` → `backend/tests/unit/test_runtime_service.py`
- `backend/tests/integration/test_http_service.py` → `backend/tests/integration/test_runtime_service.py`

- [ ] **Step 2: Replace aiohttp mocked request helpers with FastAPI test client fixtures**

Use `fastapi.testclient.TestClient` or async client equivalents.

```python
from fastapi.testclient import TestClient
from backend.interfaces.fastapi_service import app

def test_healthz_returns_service_metadata() -> None:
    client = TestClient(app)
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "seichijunrei-runtime"
```

- [ ] **Step 3: Preserve invalid JSON / invalid request assertions**

Add explicit assertions so FastAPI does not silently switch the contract to default 422 detail payloads.

```python
def test_runtime_endpoint_rejects_invalid_payload() -> None:
    client = TestClient(app)
    response = client.post("/v1/runtime", json={"text": "   "})
    assert response.status_code == 422 or response.status_code == 400
    body = response.json()
    assert "error" in body
```

- [ ] **Step 4: Add SSE incremental behavior test**

```python
def test_runtime_stream_emits_step_before_done() -> None:
    client = TestClient(app)
    with client.stream("POST", "/v1/runtime/stream", json={"text": "test"}) as response:
        chunks = list(response.iter_text())
    body = "".join(chunks)
    assert "event: step" in body
    assert "event: done" in body
    assert body.index("event: step") < body.index("event: done")
```

- [ ] **Step 5: Commit**

```bash
git add backend/tests/unit/test_runtime_service.py backend/tests/integration/test_runtime_service.py backend/tests/unit/test_error_sanitization.py
git commit -m "test(api): lock runtime transport contract before FastAPI cutover"
```

---

### Task 2: Finalize `fastapi_service.py` to parity

**Files:**

- Modify: `backend/interfaces/fastapi_service.py`

- [ ] **Step 1: Ensure all endpoints match current surface**

Required endpoints:

- `GET /`
- `GET /healthz`
- `POST /v1/runtime`
- `POST /v1/runtime/stream`
- `GET /v1/conversations`
- `PATCH /v1/conversations/{session_id}`
- `GET /v1/conversations/{session_id}/messages`
- `GET /v1/routes`
- `POST /v1/feedback`

- [ ] **Step 2: Fix SSE to be truly incremental**

The current implementation buffers `pending_events` and yields after `RuntimeAPI.handle()` returns. Replace that with a queue-based generator so `on_step()` pushes immediately.

```python
import asyncio

async def handle_runtime_stream(...):
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def on_step(tool: str, status: str, data: dict[str, object], thought: str = "", observation: str = "") -> None:
        payload = json.dumps({...}, ensure_ascii=False)
        await queue.put(f"event: step\ndata: {payload}\n\n")

    async def run_pipeline_task() -> None:
        try:
            response = await runtime_api.handle(body, user_id=x_user_id, on_step=on_step)
            done_payload = json.dumps({"event": "done", **response.model_dump(mode="json")}, ensure_ascii=False)
            await queue.put(f"event: done\ndata: {done_payload}\n\n")
        except Exception as exc:
            logger.exception("sse_pipeline_error", error=str(exc))
            await queue.put(f"event: error\ndata: {json.dumps({...})}\n\n")
        finally:
            await queue.put(None)

    async def event_generator() -> AsyncIterator[str]:
        task = asyncio.create_task(run_pipeline_task())
        try:
            planning_payload = json.dumps({"event": "planning", "status": "running"}, ensure_ascii=False)
            yield f"event: planning\ndata: {planning_payload}\n\n"
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await task
```

- [ ] **Step 3: Align error JSON shape**

FastAPI validation and HTTP exceptions must return the same `{"error": {"code": ..., "message": ...}}` shape expected by the frontend.

Add handlers for `ValidationError`, `RequestValidationError`, and `HTTPException`.

- [ ] **Step 4: Align CORS to settings instead of `*`**

Replace hardcoded `allow_origins=["*"]` with settings-driven origin.

- [ ] **Step 5: Keep trusted header behavior**

Continue reading `X-User-Id` and `X-User-Type` through FastAPI headers, without changing Worker expectations.

- [ ] **Step 6: Commit**

```bash
git add backend/interfaces/fastapi_service.py
git commit -m "feat(api): finalize FastAPI runtime adapter with SSE parity"
```

---

### Task 3: Switch runtime entrypoints

**Files:**

- Modify: `pyproject.toml`
- Modify: `Makefile`
- Modify: `Dockerfile`
- Modify: `backend/interfaces/__init__.py`

- [ ] **Step 1: Switch project script**

`pyproject.toml`

```toml
[project.scripts]
seichijunrei-api = "backend.interfaces.fastapi_service:main"
```

Add `main()` to `fastapi_service.py` if missing:

```python
def main() -> None:
    import uvicorn
    uvicorn.run("backend.interfaces.fastapi_service:app", host="0.0.0.0", port=8080)
```

- [ ] **Step 2: Keep `make serve` stable**

`Makefile:45` remains `uv run seichijunrei-api`, but now that script points to FastAPI.

- [ ] **Step 3: Switch container CMD**

`Dockerfile`

```dockerfile
CMD ["python", "-m", "backend.interfaces.fastapi_service"]
```

or explicit uvicorn:

```dockerfile
CMD ["uvicorn", "backend.interfaces.fastapi_service:app", "--host", "0.0.0.0", "--port", "8080"]
```

Use one style consistently with local `main()`.

- [ ] **Step 4: Update interface exports**

`backend/interfaces/__init__.py`

```python
from backend.interfaces.fastapi_service import app, create_fastapi_app, main
```

If helper names differ, export FastAPI equivalents and remove aiohttp-only export assumptions.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml Makefile Dockerfile backend/interfaces/__init__.py backend/interfaces/fastapi_service.py
git commit -m "refactor(api): switch runtime entrypoints from aiohttp to FastAPI"
```

---

### Task 4: Update CI and deployment assumptions

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/dependabot-agent.yml`
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Update import verification**

Replace:

```bash
uv run python -c "from backend.interfaces.http_service import create_http_app; print('http OK')"
```

with FastAPI import check:

```bash
uv run python -c "from backend.interfaces.fastapi_service import app; print('fastapi OK')"
```

- [ ] **Step 2: Update deployment docs**

Replace `aiohttp` references in `DEPLOYMENT.md` with FastAPI/uvicorn language.

- [ ] **Step 3: Ensure Cloudflare container path remains unchanged externally**

Worker still proxies `/v1/*` and `/healthz` to the same container; only the service process inside the container changes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/dependabot-agent.yml DEPLOYMENT.md
git commit -m "chore(ci): update checks and docs for FastAPI runtime"
```

---

### Task 5: Remove old aiohttp adapter

**Files:**

- Delete or reduce: `backend/interfaces/http_service.py`

- [ ] **Step 1: Decide deletion vs deprecation shim**

Preferred: delete after parity is verified.

If temporary shim is safer:

```python
"""Deprecated: FastAPI has replaced aiohttp runtime adapter."""
raise RuntimeError("http_service.py is deprecated; use backend.interfaces.fastapi_service")
```

- [ ] **Step 2: Remove aiohttp-specific test references**

Ensure no tests still import `http_service`.

- [ ] **Step 3: Commit**

```bash
git add backend/interfaces/http_service.py backend/tests/unit/test_runtime_service.py backend/tests/integration/test_runtime_service.py
git commit -m "refactor(api): retire aiohttp runtime adapter"
```

---

### Task 6: Full verification

**Files:**

- Verify only

- [ ] **Step 1: Run backend checks**

```bash
make check
```

Expected: lint, typecheck, unit tests green.

- [ ] **Step 2: Start FastAPI locally**

```bash
uv run seichijunrei-api
```

Expected: server binds to `0.0.0.0:8080`.

- [ ] **Step 3: Smoke test endpoints**

```bash
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/v1/runtime -H 'Content-Type: application/json' -d '{"text":"京吹の聖地"}'
```

- [ ] **Step 4: Verify FastAPI docs**

Open `/docs` and ensure routes appear.

- [ ] **Step 5: Commit final verification note**

```bash
git commit --allow-empty -m "test(api): verify full FastAPI cutover locally"
```
