# Test Suite + CI Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-grade API contract tests (FastAPI TestClient), frontend component tests (Vitest + RTL), E2E tests (Playwright), and update CI to run them all.

**Architecture:** Backend tests use `httpx.AsyncClient` against the FastAPI app with mocked DB. Frontend tests use Vitest (not Jest) + React Testing Library. E2E tests use Playwright against a running local stack.

**Tech Stack:** pytest + httpx (backend), Vitest + @testing-library/react (frontend), Playwright (E2E).

**Prerequisites:** Plan A (FastAPI adapter exists) and Plan B (frontend cleanup done) must be merged first.

---

## Context

After Plans A and B, the codebase has:
- `backend/interfaces/fastapi_service.py` — FastAPI app with all routes
- `backend/interfaces/schemas.py` — Pydantic request/response models
- `backend/interfaces/dependencies.py` — DI providers
- `frontend/lib/api/` — split API module
- `frontend/lib/types/` — split types module

---

### Task 1: Backend API contract tests

**Files:**
- Create: `backend/tests/integration/test_api_contract.py`
- Create: `backend/tests/integration/test_sse_contract.py`
- Modify: `backend/tests/integration/conftest.py` (create if missing)

- [ ] **Step 1: Create integration conftest with FastAPI test client**

```python
"""Integration test fixtures for the FastAPI service."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from backend.interfaces import dependencies as deps
from backend.interfaces.fastapi_service import app
from backend.interfaces.schemas import PublicAPIResponse


@pytest.fixture
def mock_db():
    """Mock SupabaseClient for integration tests."""
    db = MagicMock()
    db.get_conversations = AsyncMock(return_value=[])
    db.get_conversation = AsyncMock(return_value={"user_id": "test-user", "session_id": "s1"})
    db.get_messages = AsyncMock(return_value=[])
    db.update_conversation_title = AsyncMock()
    db.get_user_routes = AsyncMock(return_value=[])
    db.save_feedback = AsyncMock(return_value="fb-123")
    return db


@pytest.fixture
def mock_runtime_api(mock_db):
    """Mock RuntimeAPI that returns a canned response."""
    api = MagicMock()
    api._db = mock_db
    api._session_store = MagicMock()

    async def mock_handle(request, *, model=None, user_id=None, on_step=None):
        return PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            message="Found 3 spots.",
            data={"results": {"rows": [], "row_count": 3}},
            session_id="test-session",
        )

    api.handle = AsyncMock(side_effect=mock_handle)
    return api


@pytest.fixture
async def client(mock_db, mock_runtime_api):
    """AsyncClient wired to the FastAPI app with mocked dependencies."""
    deps._db = mock_db
    deps._runtime_api = mock_runtime_api
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    deps._db = None
    deps._runtime_api = None
```

- [ ] **Step 2: Create `test_api_contract.py`**

```python
"""API contract tests — every endpoint's shape is asserted."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_root_returns_service_info(client):
    resp = await client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "seichijunrei-runtime"
    assert body["status"] == "ok"
    assert "endpoints" in body


@pytest.mark.asyncio
async def test_healthz_returns_status(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "seichijunrei-runtime"


@pytest.mark.asyncio
async def test_runtime_returns_public_api_response_shape(client):
    resp = await client.post("/v1/runtime", json={"text": "響け！ユーフォニアム"})
    assert resp.status_code == 200
    body = resp.json()
    assert "success" in body
    assert "status" in body
    assert "intent" in body
    assert "message" in body
    assert "data" in body
    assert "session_id" in body


@pytest.mark.asyncio
async def test_runtime_rejects_blank_text(client):
    resp = await client.post("/v1/runtime", json={"text": "   "})
    assert resp.status_code == 422
    body = resp.json()
    assert "error" in body
    assert body["error"]["code"] == "invalid_request"


@pytest.mark.asyncio
async def test_conversations_requires_user_id(client):
    resp = await client.get("/v1/conversations")
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "missing_user_id"


@pytest.mark.asyncio
async def test_conversations_returns_list(client):
    resp = await client.get("/v1/conversations", headers={"X-User-Id": "test-user"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_messages_requires_user_id(client):
    resp = await client.get("/v1/conversations/s1/messages")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_messages_returns_messages(client):
    resp = await client.get(
        "/v1/conversations/s1/messages",
        headers={"X-User-Id": "test-user"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "messages" in body


@pytest.mark.asyncio
async def test_routes_requires_user_id(client):
    resp = await client.get("/v1/routes")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_feedback_rejects_invalid_rating(client):
    resp = await client.post(
        "/v1/feedback",
        json={"rating": "meh", "query_text": "test"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_feedback_accepts_valid_input(client):
    resp = await client.post(
        "/v1/feedback",
        json={"rating": "good", "query_text": "京アニ", "session_id": "s1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "feedback_id" in body


@pytest.mark.asyncio
async def test_patch_conversation_requires_title(client):
    resp = await client.patch(
        "/v1/conversations/s1",
        json={"title": ""},
        headers={"X-User-Id": "test-user"},
    )
    assert resp.status_code == 422
```

- [ ] **Step 3: Create `test_sse_contract.py`**

```python
"""SSE streaming contract tests."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from backend.interfaces.schemas import PublicAPIResponse


@pytest.mark.asyncio
async def test_sse_stream_emits_events_in_order(client, mock_runtime_api):
    """SSE must emit: planning → step* → done (in that order)."""

    async def mock_handle_with_steps(request, *, model=None, user_id=None, on_step=None):
        if on_step:
            await on_step("resolve_anime", "running", {})
            await on_step("resolve_anime", "done", {"bangumi_id": "123"})
        return PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            message="Found spots.",
            data={},
            session_id="s1",
        )

    mock_runtime_api.handle = AsyncMock(side_effect=mock_handle_with_steps)

    resp = await client.post(
        "/v1/runtime/stream",
        json={"text": "響け"},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    text = resp.text
    events = [line for line in text.split("\n") if line.startswith("event:")]
    event_names = [e.split(":")[1].strip() for e in events]

    assert "planning" in event_names
    assert "done" in event_names
    assert event_names.index("planning") < event_names.index("done")
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make test-integration
```

Expected: All contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/integration/conftest.py backend/tests/integration/test_api_contract.py backend/tests/integration/test_sse_contract.py
git commit -m "test(api): add FastAPI contract tests for all endpoints + SSE"
```

---

### Task 2: Frontend component tests (Vitest + RTL)

**Files:**
- Create: `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (add dev deps + test script)
- Create: `frontend/tests/setup.ts`
- Create: `frontend/tests/components/MessageBubble.test.tsx`
- Create: `frontend/tests/components/AppShell.test.tsx`
- Create: `frontend/tests/hooks/useChat.test.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Create `frontend/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
```

Also install the vite react plugin:

```bash
npm install -D @vitejs/plugin-react
```

- [ ] **Step 3: Create `frontend/tests/setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add test script to `package.json`**

Add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create `frontend/tests/components/MessageBubble.test.tsx`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "../../components/chat/MessageBubble";

describe("MessageBubble", () => {
  it("renders user message text", () => {
    render(
      <MessageBubble
        role="user"
        content="響け！ユーフォニアム"
        messageId="m1"
        isActive={false}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("響け！ユーフォニアム")).toBeInTheDocument();
  });

  it("renders bot message text", () => {
    render(
      <MessageBubble
        role="assistant"
        content="3件の聖地が見つかりました。"
        messageId="m2"
        isActive={false}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("3件の聖地が見つかりました。")).toBeInTheDocument();
  });
});
```

Note: Check the actual props of `MessageBubble` and adjust the test accordingly.

- [ ] **Step 6: Create `frontend/tests/hooks/useChat.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
// Import after reading the actual hook signature
// import { useChat } from "../../hooks/useChat";

describe("useChat", () => {
  it("placeholder — verify hook import works", () => {
    // Read the actual hook file and write meaningful tests
    expect(true).toBe(true);
  });
});
```

Read the actual `useChat.ts` hook before writing tests. The test above is a scaffold.

- [ ] **Step 7: Run tests**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/frontend && npm test
```

Expected: Tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/vitest.config.ts frontend/tests/ frontend/package.json
git commit -m "test(frontend): add Vitest + RTL setup with initial component tests"
```

---

### Task 3: E2E tests with Playwright

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`
- Create: `e2e/tests/search-flow.spec.ts`
- Create: `e2e/tests/conversation-history.spec.ts`

- [ ] **Step 1: Initialize Playwright project**

```bash
mkdir -p e2e && cd e2e && npm init -y && npm install -D @playwright/test && npx playwright install chromium
```

- [ ] **Step 2: Create `e2e/playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
```

- [ ] **Step 3: Create `e2e/tests/search-flow.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Search flow", () => {
  test("user can search for an anime and see results", async ({ page }) => {
    await page.goto("/");

    // Wait for the app to load (auth gate may redirect)
    await page.waitForSelector("[data-testid='chat-input'], input[type='text']", {
      timeout: 15_000,
    });

    // Type a search query
    const input = page.locator("[data-testid='chat-input'], input[type='text']").first();
    await input.fill("響け！ユーフォニアム");
    await input.press("Enter");

    // Wait for response (bot message or result panel)
    await expect(
      page.locator("[data-testid='message-bubble'], [data-testid='result-panel']").first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 4: Create `e2e/tests/conversation-history.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Conversation history", () => {
  test("sidebar shows conversation after a search", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='chat-input'], input[type='text']", {
      timeout: 15_000,
    });

    const input = page.locator("[data-testid='chat-input'], input[type='text']").first();
    await input.fill("君の名は");
    await input.press("Enter");

    // After response, sidebar should show the conversation
    await expect(
      page.locator("[data-testid='sidebar'] >> text=/君の名は/i").first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
```

Note: These tests depend on `data-testid` attributes being present in the components. Add them if missing during execution.

- [ ] **Step 5: Run E2E locally (requires running backend + frontend)**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent/e2e && npx playwright test --reporter=list
```

Expected: Tests pass if local stack is running. Mark as optional in CI.

- [ ] **Step 6: Commit**

```bash
git add e2e/
git commit -m "test(e2e): add Playwright E2E tests for search and conversation flows"
```

---

### Task 4: Update CI and final wiring

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `Makefile`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add frontend test to Makefile**

```makefile
test-frontend:
	cd frontend && npm test

test-e2e:
	cd e2e && npx playwright test
```

- [ ] **Step 2: Update CI workflow**

In `.github/workflows/ci.yml`, add steps:

```yaml
    - name: Frontend tests
      run: cd frontend && npm ci && npm test

    - name: Import check (FastAPI)
      run: uv run python -c "from backend.interfaces.fastapi_service import app; print('fastapi OK')"
```

Remove any aiohttp import check if present.

Optionally add E2E as a separate job that runs on `workflow_dispatch` or a label trigger (not on every PR).

- [ ] **Step 3: Update `CLAUDE.md` architecture section**

Replace aiohttp references with FastAPI. Update the file table to reflect the new structure:

- `http_service.py` → removed
- `fastapi_service.py` → FastAPI adapter
- `schemas.py` → Pydantic models
- `response_builder.py` → response conversion
- `session_facade.py` → session logic
- `dependencies.py` → DI providers
- `repositories/` → DB access layer

Update commands section:

```
make test-frontend  # frontend component tests
make test-e2e       # Playwright E2E tests (requires running stack)
```

- [ ] **Step 4: Final verification**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make check && make test-integration
cd frontend && npm test
```

Expected: Everything green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml Makefile CLAUDE.md
git commit -m "chore(ci): update pipeline for FastAPI + frontend tests + E2E"
```
