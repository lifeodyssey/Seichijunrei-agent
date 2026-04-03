# Iter 2: Persistence — Conversations, User Memory, Data Freshness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status (2026-04-03):** Landed in the codebase. Keep as historical rationale/checklist; use `docs/ARCHITECTURE.md` and current migrations/code as the source of truth.

**Goal:** Make conversations and user context persistent across page refreshes and sessions; let users see and rename their conversation history in the sidebar; add force-refresh to bust stale pilgrimage data.

**Architecture:** Four independent features. F2a (conversations) and F2b (user_memory) both require a `user_id` to flow from the CF Worker's `X-User-Id` header through to `RuntimeAPI.handle()` — that propagation is shared groundwork done first. F2b extends `_build_context_block` written in Iter 1 (F1a). F2c is pure frontend. F2d touches only `RetrievalRequest` and `retriever.py`.

**Prerequisites:** Iter 1 (F1a) must be merged — specifically `_build_context_block`, `_extract_context_delta`, and the `context` parameter added to `run_pipeline` / `create_plan`.

**Tech Stack:** Python / asyncpg / aiohttp / pydantic-ai / Next.js (static export) / TypeScript / Supabase PostgreSQL

**Spec:** `docs/superpowers/specs/2026-04-01-frontend-memory-arch.md` — Iter 2 section

---

## File Map

| File | Change |
|------|--------|
| `infrastructure/supabase/migrations/005_conversations.sql` | CREATE TABLE conversations |
| `infrastructure/supabase/migrations/006_user_memory.sql` | CREATE TABLE user_memory |
| `infrastructure/supabase/client.py` | 5 new methods: upsert_conversation, update_conversation_title, get_conversations, upsert_user_memory, get_user_memory |
| `interfaces/http_service.py` | Extract X-User-Id header; pass user_id to handle(); add GET /v1/conversations + PATCH /v1/conversations/{session_id} |
| `interfaces/public_api.py` | RuntimeAPI.handle() gains user_id param; async title generation task; upsert conversation + user_memory after pipeline; extend _build_context_block call with user_memory |
| `interfaces/public_api.py` | _build_context_block gains user_memory param; merges cross-session visited IDs |
| `agents/models.py` | RetrievalRequest gains force_refresh: bool = False |
| `agents/retriever.py` | _execute_sql_with_fallback honors force_refresh |
| `agents/planner_agent.py` | PLANNER_SYSTEM_PROMPT: search_bangumi gains force_refresh param note |
| `frontend/lib/types.ts` | Add ConversationRecord interface |
| `frontend/lib/api.ts` | fetchConversations(), patchConversationTitle() |
| `frontend/hooks/useConversationHistory.ts` | New hook: load, upsert, rename |
| `frontend/components/layout/Sidebar.tsx` | Replace routeHistory with conversations; inline rename on click |
| `frontend/components/layout/AppShell.tsx` | Replace routeHistory useMemo with useConversationHistory; call upsert after send |
| `frontend/lib/dictionaries/ja.json` | sidebar.rename_hint |
| `frontend/lib/dictionaries/zh.json` | sidebar.rename_hint |
| `frontend/lib/dictionaries/en.json` | sidebar.rename_hint |
| `tests/unit/test_supabase_client.py` | Tests for new DB methods |
| `tests/unit/test_public_api.py` | Tests for user_id propagation, conversation upsert, user_memory upsert |
| `tests/unit/test_retriever.py` | Tests for force_refresh behavior |
| `tests/integration/test_http_service.py` | Tests for GET /v1/conversations, PATCH /v1/conversations/:id |

---

## Task 1: DB Migrations

**Files:**
- Create: `infrastructure/supabase/migrations/005_conversations.sql`
- Create: `infrastructure/supabase/migrations/006_user_memory.sql`

- [ ] **Step 1.1: Write 005_conversations.sql**

```sql
-- Conversation history table for sidebar persistence.
-- One row per session. Title starts NULL, set async by LLM after first response.
-- User can rename via PATCH /v1/conversations/:session_id.

CREATE TABLE IF NOT EXISTS conversations (
    session_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    title        TEXT,
    first_query  TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations (user_id, updated_at DESC);
```

- [ ] **Step 1.2: Write 006_user_memory.sql**

```sql
-- Cross-session user memory: anime the user has explored.
-- visited_anime: [{bangumi_id, title, last_at}]
-- visited_points: reserved for future use, always []

CREATE TABLE IF NOT EXISTS user_memory (
    user_id        TEXT PRIMARY KEY,
    visited_anime  JSONB NOT NULL DEFAULT '[]'::jsonb,
    visited_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at     TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 1.3: Apply migrations (dev)**

```bash
# Apply against your local Supabase or dev DB
psql $SUPABASE_DB_URL -f infrastructure/supabase/migrations/005_conversations.sql
psql $SUPABASE_DB_URL -f infrastructure/supabase/migrations/006_user_memory.sql
```

Expected: both commands complete without error.

- [ ] **Step 1.4: Commit**

```bash
git add infrastructure/supabase/migrations/005_conversations.sql \
        infrastructure/supabase/migrations/006_user_memory.sql
git commit -m "feat(db): add conversations and user_memory tables"
```

---

## Task 2: SupabaseClient — New DB Methods

**Files:**
- Modify: `infrastructure/supabase/client.py`
- Test: `tests/unit/test_supabase_client.py`

- [ ] **Step 2.1: Write failing tests**

```python
# tests/unit/test_supabase_client.py — add to existing file (or create if absent)
from __future__ import annotations
import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from infrastructure.supabase.client import SupabaseClient


@pytest.fixture
def db():
    client = SupabaseClient.__new__(SupabaseClient)
    pool = MagicMock()
    pool.execute = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    client._pool = pool
    return client


class TestUpsertConversation:
    async def test_inserts_new_row(self, db):
        await db.upsert_conversation(
            session_id="sess-1",
            user_id="user-1",
            first_query="京吹の聖地を探して",
        )
        db.pool.execute.assert_awaited_once()
        sql = db.pool.execute.call_args.args[0]
        assert "INSERT INTO conversations" in sql
        assert "ON CONFLICT" in sql

    async def test_does_not_overwrite_existing_first_query(self, db):
        # Second call for same session — should only touch updated_at
        await db.upsert_conversation("s", "u", "second query")
        sql = db.pool.execute.call_args.args[0]
        assert "first_query" not in sql.split("DO UPDATE SET")[1]


class TestUpdateConversationTitle:
    async def test_updates_title(self, db):
        await db.update_conversation_title("sess-1", "京吹 宇治")
        db.pool.execute.assert_awaited_once()
        sql = db.pool.execute.call_args.args[0]
        assert "UPDATE conversations" in sql
        assert "title" in sql


class TestGetConversations:
    async def test_returns_empty_list_when_no_rows(self, db):
        db.pool.fetch.return_value = []
        result = await db.get_conversations("user-1")
        assert result == []

    async def test_returns_list_of_dicts(self, db):
        row = MagicMock()
        row.keys = MagicMock(return_value=["session_id", "title", "first_query", "created_at", "updated_at"])
        row.__getitem__ = lambda self, k: {"session_id": "s1", "title": "T", "first_query": "Q", "created_at": "2026-04-02T00:00:00Z", "updated_at": "2026-04-02T00:00:00Z"}[k]
        db.pool.fetch.return_value = [row]
        result = await db.get_conversations("user-1")
        assert len(result) == 1
        assert result[0]["session_id"] == "s1"


class TestUserMemory:
    async def test_upsert_inserts_first_entry(self, db):
        db.pool.fetchrow.return_value = None
        await db.upsert_user_memory("user-1", bangumi_id="253", anime_title="響け！ユーフォニアム")
        db.pool.execute.assert_awaited_once()
        sql, *args = db.pool.execute.call_args.args
        assert "INSERT INTO user_memory" in sql
        stored = json.loads(args[1])
        assert stored[0]["bangumi_id"] == "253"

    async def test_upsert_updates_existing_entry(self, db):
        existing = json.dumps([{"bangumi_id": "253", "title": "old", "last_at": "2026-01-01"}])
        row = MagicMock()
        row.__getitem__ = lambda self, k: existing
        db.pool.fetchrow.return_value = row
        await db.upsert_user_memory("user-1", bangumi_id="253", anime_title="響け！ユーフォニアム")
        sql, *args = db.pool.execute.call_args.args
        stored = json.loads(args[1])
        assert len(stored) == 1  # not duplicated
        assert stored[0]["title"] == "響け！ユーフォニアム"

    async def test_get_user_memory_returns_none_when_absent(self, db):
        db.pool.fetchrow.return_value = None
        result = await db.get_user_memory("user-1")
        assert result is None

    async def test_get_user_memory_returns_parsed_data(self, db):
        row = MagicMock()
        row.__getitem__ = MagicMock(side_effect=lambda k: {
            "visited_anime": json.dumps([{"bangumi_id": "253"}]),
            "visited_points": "[]",
        }[k])
        db.pool.fetchrow.return_value = row
        result = await db.get_user_memory("user-1")
        assert result["visited_anime"][0]["bangumi_id"] == "253"
```

- [ ] **Step 2.2: Run tests — expect FAIL**

```bash
pytest tests/unit/test_supabase_client.py -v -k "TestUpsertConversation or TestUpdateConversationTitle or TestGetConversations or TestUserMemory"
```

Expected: `AttributeError: 'SupabaseClient' object has no attribute 'upsert_conversation'`

- [ ] **Step 2.3: Add methods to SupabaseClient**

Add the following section to `infrastructure/supabase/client.py` (after the `# --- Routes ---` section):

```python
# --- Conversations ---

async def upsert_conversation(
    self, session_id: str, user_id: str, first_query: str
) -> None:
    """Create conversation row on first request; only update updated_at on subsequent ones."""
    await self.pool.execute(
        """
        INSERT INTO conversations (session_id, user_id, first_query)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id) DO UPDATE SET updated_at = now()
        """,
        session_id,
        user_id,
        first_query,
    )

async def update_conversation_title(self, session_id: str, title: str) -> None:
    """Set the LLM-generated or user-supplied title."""
    await self.pool.execute(
        "UPDATE conversations SET title = $1, updated_at = now() WHERE session_id = $2",
        title,
        session_id,
    )

async def get_conversations(
    self, user_id: str, *, limit: int = 30
) -> list[dict]:
    """Return conversation history for a user, most recent first."""
    rows = await self.pool.fetch(
        """
        SELECT session_id, title, first_query, created_at, updated_at
        FROM conversations
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [dict(r) for r in rows]

# --- User Memory ---

async def upsert_user_memory(
    self, user_id: str, *, bangumi_id: str, anime_title: str | None
) -> None:
    """Merge a single anime entry into the user's visited_anime list."""
    import json
    from datetime import UTC, datetime

    row = await self.pool.fetchrow(
        "SELECT visited_anime FROM user_memory WHERE user_id = $1", user_id
    )
    if row is None:
        visited: list[dict] = []
    else:
        raw = row["visited_anime"]
        visited = json.loads(raw) if isinstance(raw, str) else list(raw)

    now = datetime.now(UTC).isoformat()
    existing = next((e for e in visited if e.get("bangumi_id") == bangumi_id), None)
    if existing:
        existing["last_at"] = now
        if anime_title:
            existing["title"] = anime_title
    else:
        visited.append({"bangumi_id": bangumi_id, "title": anime_title or "", "last_at": now})

    await self.pool.execute(
        """
        INSERT INTO user_memory (user_id, visited_anime, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (user_id) DO UPDATE SET visited_anime = $2::jsonb, updated_at = now()
        """,
        user_id,
        json.dumps(visited),
    )

async def get_user_memory(self, user_id: str) -> dict | None:
    """Return parsed user_memory row, or None if not found."""
    import json

    row = await self.pool.fetchrow(
        "SELECT visited_anime, visited_points FROM user_memory WHERE user_id = $1",
        user_id,
    )
    if row is None:
        return None
    raw_anime = row["visited_anime"]
    raw_points = row["visited_points"]
    return {
        "visited_anime": json.loads(raw_anime) if isinstance(raw_anime, str) else list(raw_anime),
        "visited_points": json.loads(raw_points) if isinstance(raw_points, str) else list(raw_points),
    }
```

- [ ] **Step 2.4: Run tests — expect PASS**

```bash
pytest tests/unit/test_supabase_client.py -v -k "TestUpsertConversation or TestUpdateConversationTitle or TestGetConversations or TestUserMemory"
```

Expected: all green.

- [ ] **Step 2.5: Commit**

```bash
git add infrastructure/supabase/client.py tests/unit/test_supabase_client.py
git commit -m "feat(db): add conversation and user_memory persistence methods"
```

---

## Task 3: User ID Propagation Through RuntimeAPI

**Files:**
- Modify: `interfaces/public_api.py`
- Modify: `interfaces/http_service.py`
- Test: `tests/unit/test_public_api.py`

`RuntimeAPI.handle()` currently takes only `request: PublicAPIRequest`. We add `user_id: str | None = None`. The HTTP handler reads it from the `X-User-Id` header (set by the Cloudflare Worker before the request reaches this container).

- [ ] **Step 3.1: Write failing test**

```python
# tests/unit/test_public_api.py — add to existing class or at module level

class TestUserIdPropagation:
    async def test_user_id_passed_through_to_db_methods(self):
        """RuntimeAPI.handle should call upsert_conversation when user_id is provided."""
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.insert_request_log = AsyncMock()
        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        request = PublicAPIRequest(text="京吹の聖地")
        # _mock_pipeline fixture is active (returns a fake result)
        await api.handle(request, user_id="user-abc")
        db.upsert_conversation.assert_awaited_once()
        call_kwargs = db.upsert_conversation.call_args
        assert call_kwargs.args[1] == "user-abc"  # user_id is 2nd positional arg

    async def test_no_db_calls_when_user_id_absent(self):
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.insert_request_log = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        request = PublicAPIRequest(text="京吹の聖地")
        await api.handle(request, user_id=None)
        db.upsert_conversation.assert_not_awaited()
```

- [ ] **Step 3.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestUserIdPropagation -v
```

Expected: `TypeError: handle() got an unexpected keyword argument 'user_id'`

- [ ] **Step 3.3: Add user_id parameter to RuntimeAPI.handle**

In `interfaces/public_api.py`, change the `handle` signature from:

```python
async def handle(self, request: PublicAPIRequest) -> PublicAPIResponse:
```

to:

```python
async def handle(self, request: PublicAPIRequest, *, user_id: str | None = None) -> PublicAPIResponse:
```

Inside `handle`, just after `previous_state = await self._load_session_state(session_id)`, add:

```python
user_memory = None
if user_id and hasattr(self._db, "get_user_memory"):
    try:
        user_memory = await self._db.get_user_memory(user_id)
    except Exception:
        logger.warning("get_user_memory_failed", user_id=user_id)
```

Store `user_id` so it's available later in the method body (it already is via closure since it's a parameter).

- [ ] **Step 3.4: Pass user_id in HTTP handler**

In `interfaces/http_service.py`, in `_handle_runtime`:

```python
async def _handle_runtime(request: web.Request) -> web.Response:
    runtime_api = request.app[_RUNTIME_API_KEY]
    user_id = request.headers.get("X-User-Id") or None  # None if header absent

    # ... existing JSON parsing and validation ...

    response = await runtime_api.handle(api_request, user_id=user_id)
    return web.json_response(...)
```

Replace the existing `response = await runtime_api.handle(api_request)` line with the user_id-aware version above. The `user_id = ...` line goes at the top of the function, before JSON parsing.

- [ ] **Step 3.5: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestUserIdPropagation -v
```

- [ ] **Step 3.6: Run full unit suite**

```bash
make test
```

Expected: all green.

- [ ] **Step 3.7: Commit**

```bash
git add interfaces/public_api.py interfaces/http_service.py tests/unit/test_public_api.py
git commit -m "feat(api): propagate X-User-Id header through RuntimeAPI.handle"
```

---

## Task 4: Conversation Persistence + Async LLM Title Generation

**Files:**
- Modify: `interfaces/public_api.py`
- Test: `tests/unit/test_public_api.py`

After the pipeline returns a response, we:
1. Upsert a `conversations` row (every request).
2. If this is the first interaction in the session, fire-and-forget an async task to generate a title.

- [ ] **Step 4.1: Write failing tests**

```python
# tests/unit/test_public_api.py

class TestConversationPersistence:
    async def test_upserts_conversation_with_user_id(self):
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.insert_request_log = AsyncMock()
        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        await api.handle(PublicAPIRequest(text="京吹"), user_id="u1")
        db.upsert_conversation.assert_awaited_once()
        args = db.upsert_conversation.call_args.args
        assert args[0]  # session_id non-empty
        assert args[1] == "u1"
        assert args[2] == "京吹"

    async def test_no_upsert_when_no_user_id(self):
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.insert_request_log = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        await api.handle(PublicAPIRequest(text="京吹"), user_id=None)
        db.upsert_conversation.assert_not_awaited()
```

- [ ] **Step 4.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestConversationPersistence -v
```

- [ ] **Step 4.3: Add _persist_conversation helper and title generation**

Add to `interfaces/public_api.py`:

```python
async def _generate_and_save_title(
    session_id: str,
    first_query: str,
    response_message: str,
    db: Any,
) -> None:
    """Background task: generate a short conversation title via LLM then save it."""
    try:
        from agents.base import create_agent
        agent = create_agent(
            "claude-haiku-4-5-20251001",
            system_prompt=(
                "Generate a very short conversation title (≤15 characters) in the "
                "same language as the query. Output ONLY the title, no punctuation wrap."
            ),
            retries=1,
        )
        result = await agent.run(
            f"Query: {first_query}\nResponse summary: {response_message[:200]}"
        )
        title = str(result.output).strip()[:20] or first_query[:20]
    except Exception:
        title = first_query[:20]

    update_title = getattr(db, "update_conversation_title", None)
    if update_title is not None:
        try:
            await update_title(session_id, title)
        except Exception:
            logger.warning("update_conversation_title_failed", session_id=session_id)
```

Inside `RuntimeAPI.handle`, after `await self._persist_session(session_id, session_state, response)`, add:

```python
if user_id and result is not None:
    upsert_conv = getattr(self._db, "upsert_conversation", None)
    if upsert_conv is not None:
        try:
            await upsert_conv(session_id, user_id, request.text)
        except Exception:
            logger.warning("upsert_conversation_failed", session_id=session_id)

        # Fire-and-forget title generation on the first interaction only
        if len(session_state.get("interactions", [])) == 1:
            import asyncio
            asyncio.create_task(
                _generate_and_save_title(
                    session_id,
                    request.text,
                    response.message,
                    self._db,
                )
            )
```

- [ ] **Step 4.4: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestConversationPersistence -v
```

- [ ] **Step 4.5: Run full suite**

```bash
make test
```

- [ ] **Step 4.6: Commit**

```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(api): persist conversations and generate LLM titles asynchronously"
```

---

## Task 5: User Memory — Upsert After Pipeline

**Files:**
- Modify: `interfaces/public_api.py`
- Test: `tests/unit/test_public_api.py`

After each pipeline execution, if `context_delta` contains a `bangumi_id`, upsert into `user_memory`.

Note: `_extract_context_delta` is defined in Iter 1 (F1a). This task calls it a second time (or reads from the already-computed delta stored in session state) to get the bangumi_id. The cleanest approach is to compute the delta once and reuse it.

- [ ] **Step 5.1: Write failing test**

```python
# tests/unit/test_public_api.py

class TestUserMemoryUpsert:
    async def test_upserts_user_memory_when_bangumi_id_in_delta(self):
        """When pipeline result has a resolve_anime step, user_memory is upserted."""
        from agents.executor_agent import StepResult
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.insert_request_log = AsyncMock()

        # Override the module-level mock to return a result with resolve_anime step
        from agents.executor_agent import PipelineResult
        from agents.models import ExecutionPlan, PlanStep, ToolName
        plan = ExecutionPlan(reasoning="t", locale="ja",
            steps=[PlanStep(tool=ToolName.RESOLVE_ANIME, params={})])
        fake_result = PipelineResult(intent="search_bangumi", plan=plan)
        fake_result.step_results = [
            StepResult(tool="resolve_anime", success=True,
                       data={"bangumi_id": "253", "title": "響け！ユーフォニアム"})
        ]
        fake_result.final_output = {"success": True, "status": "ok", "message": "ok", "data": {}}

        with patch("interfaces.public_api.run_pipeline", return_value=fake_result):
            api = RuntimeAPI(db, session_store=InMemorySessionStore())
            await api.handle(PublicAPIRequest(text="響吹"), user_id="u1")

        db.upsert_user_memory.assert_awaited_once()
        kwargs = db.upsert_user_memory.call_args.kwargs
        assert kwargs["bangumi_id"] == "253"
        assert kwargs["anime_title"] == "響け！ユーフォニアム"

    async def test_skips_user_memory_when_no_bangumi_id(self):
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.insert_request_log = AsyncMock()
        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        # Default _mock_pipeline returns no resolve_anime step
        await api.handle(PublicAPIRequest(text="宇治の近く"), user_id="u1")
        db.upsert_user_memory.assert_not_awaited()
```

- [ ] **Step 5.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestUserMemoryUpsert -v
```

- [ ] **Step 5.3: Compute context_delta once and upsert user_memory**

In `interfaces/public_api.py`, within `RuntimeAPI.handle()`, after the `run_pipeline` call succeeds (in the `else` branch), extract and store the delta:

```python
# (in the `else` block after run_pipeline succeeds)
response = _pipeline_result_to_public_response(result, include_debug=request.include_debug)

# Compute context_delta once — reused for both session state and user_memory
context_delta = _extract_context_delta(result)  # defined in Iter 1 F1a
```

Then in `_build_updated_session_state`, use the pre-computed delta (pass it as a parameter instead of re-computing). Update the call:

```python
session_state = _build_updated_session_state(
    previous_state,
    request=request,
    response=response,
    context_delta=context_delta,
)
```

Update `_build_updated_session_state` signature to accept `context_delta`:

```python
def _build_updated_session_state(
    previous_state: dict[str, Any],
    *,
    request: PublicAPIRequest,
    response: PublicAPIResponse,
    context_delta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    interactions = list(previous_state["interactions"])
    interactions.append(
        {
            "text": request.text,
            "intent": response.intent,
            "status": response.status,
            "success": response.success,
            "created_at": datetime.now(UTC).isoformat(),
            "context_delta": context_delta or {},  # Iter 1 F1a field
        }
    )
    interactions = interactions[-_MAX_INTERACTIONS:]

    return {
        **previous_state,
        "interactions": interactions,
        "last_intent": response.intent,
        "last_status": response.status,
        "last_message": response.message,
        "updated_at": datetime.now(UTC).isoformat(),
    }
```

Then, after `_build_updated_session_state`, add user_memory upsert:

```python
if user_id and context_delta and context_delta.get("bangumi_id"):
    upsert_memory = getattr(self._db, "upsert_user_memory", None)
    if upsert_memory is not None:
        try:
            await upsert_memory(
                user_id,
                bangumi_id=context_delta["bangumi_id"],
                anime_title=context_delta.get("anime_title"),
            )
        except Exception:
            logger.warning("upsert_user_memory_failed", user_id=user_id)
```

- [ ] **Step 5.4: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestUserMemoryUpsert -v
```

- [ ] **Step 5.5: Run full suite**

```bash
make test
```

- [ ] **Step 5.6: Commit**

```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(api): upsert user_memory after pipeline when bangumi_id resolved"
```

---

## Task 6: Cross-Session context_block via user_memory

**Files:**
- Modify: `interfaces/public_api.py`
- Test: `tests/unit/test_public_api.py`

Extend `_build_context_block` (added in Iter 1) to accept `user_memory` and merge cross-session `visited_bangumi_ids`.

- [ ] **Step 6.1: Write failing test**

```python
# tests/unit/test_public_api.py

from interfaces.public_api import _build_context_block  # assumes Iter 1 exists

class TestBuildContextBlockWithUserMemory:
    def test_merges_cross_session_visited_ids(self):
        session_state = {
            "interactions": [
                {"context_delta": {"bangumi_id": "253", "anime_title": "響け", "location": None}}
            ],
        }
        user_memory = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "君の名は", "last_at": "2026-03-01"},
                {"bangumi_id": "253", "title": "響け", "last_at": "2026-04-01"},
            ]
        }
        block = _build_context_block(session_state, user_memory=user_memory)
        assert block is not None
        # 105 is only in user_memory, should be included
        assert "105" in block["visited_bangumi_ids"]
        # 253 is in both — should appear once
        assert block["visited_bangumi_ids"].count("253") == 1

    def test_returns_none_when_no_context_and_no_user_memory(self):
        block = _build_context_block({"interactions": []}, user_memory=None)
        assert block is None

    def test_returns_cross_session_data_even_when_session_empty(self):
        block = _build_context_block(
            {"interactions": []},
            user_memory={"visited_anime": [{"bangumi_id": "105", "title": "君の名は", "last_at": "x"}]},
        )
        assert block is not None
        assert "105" in block["visited_bangumi_ids"]
```

- [ ] **Step 6.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestBuildContextBlockWithUserMemory -v
```

Expected: `TypeError` or assertion error because `_build_context_block` doesn't accept `user_memory` yet.

- [ ] **Step 6.3: Update _build_context_block**

In `interfaces/public_api.py`, update the function signature and body (this function was added in Iter 1):

```python
def _build_context_block(
    session_state: dict[str, Any],
    user_memory: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    interactions = session_state.get("interactions") or []
    current_bangumi_id: str | None = None
    current_anime_title: str | None = None
    last_location: str | None = None
    visited_bangumi_ids: list[str] = []

    for interaction in reversed(interactions):
        delta = interaction.get("context_delta") or {}
        if current_bangumi_id is None and delta.get("bangumi_id"):
            current_bangumi_id = delta["bangumi_id"]
            current_anime_title = delta.get("anime_title")
        if last_location is None and delta.get("location"):
            last_location = delta["location"]
        bid = delta.get("bangumi_id")
        if bid and bid not in visited_bangumi_ids:
            visited_bangumi_ids.append(bid)
        if current_bangumi_id and last_location:
            break

    # Merge cross-session IDs from user_memory (preserve session order, append rest)
    if user_memory:
        for entry in user_memory.get("visited_anime") or []:
            bid = entry.get("bangumi_id")
            if bid and bid not in visited_bangumi_ids:
                visited_bangumi_ids.append(bid)
        # Also fill current_bangumi_id from user_memory if session has nothing
        if current_bangumi_id is None and user_memory.get("visited_anime"):
            most_recent = max(
                user_memory["visited_anime"],
                key=lambda e: e.get("last_at", ""),
                default=None,
            )
            if most_recent:
                current_bangumi_id = most_recent.get("bangumi_id")
                current_anime_title = most_recent.get("title")

    if not current_bangumi_id and not last_location and not visited_bangumi_ids:
        return None

    return {
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }
```

Also update the call site inside `RuntimeAPI.handle()` to pass `user_memory`:

```python
context = _build_context_block(previous_state, user_memory=user_memory)
```

(This replaces the existing `context = _build_context_block(previous_state)` call from Iter 1.)

- [ ] **Step 6.4: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestBuildContextBlockWithUserMemory -v
```

- [ ] **Step 6.5: Run full suite**

```bash
make test
```

- [ ] **Step 6.6: Commit**

```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(api): extend context_block with cross-session user_memory"
```

---

## Task 7: HTTP Endpoints — GET /v1/conversations + PATCH /v1/conversations/{session_id}

**Files:**
- Modify: `interfaces/http_service.py`
- Test: `tests/integration/test_http_service.py`

- [ ] **Step 7.1: Write failing tests**

```python
# tests/integration/test_http_service.py — add to existing TestHTTPService class

async def test_get_conversations_returns_list(self, mock_db):
    mock_db.get_conversations = AsyncMock(return_value=[
        {
            "session_id": "sess-1",
            "title": "京吹の聖地",
            "first_query": "京吹の聖地を探して",
            "created_at": "2026-04-02T10:00:00Z",
            "updated_at": "2026-04-02T10:00:00Z",
        }
    ])
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/v1/conversations", headers={"X-User-Id": "user-1"})
        assert resp.status == 200
        body = await resp.json()
    assert len(body) == 1
    assert body[0]["session_id"] == "sess-1"

async def test_get_conversations_requires_user_id(self, mock_db):
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )
    async with TestClient(TestServer(app)) as client:
        resp = await client.get("/v1/conversations")
        assert resp.status == 400

async def test_patch_conversation_title(self, mock_db):
    mock_db.update_conversation_title = AsyncMock()
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )
    async with TestClient(TestServer(app)) as client:
        resp = await client.patch(
            "/v1/conversations/sess-1",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )
        assert resp.status == 200
    mock_db.update_conversation_title.assert_awaited_once_with("sess-1", "New Title")

async def test_patch_conversation_validates_title(self, mock_db):
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )
    async with TestClient(TestServer(app)) as client:
        resp = await client.patch(
            "/v1/conversations/sess-1",
            json={"title": ""},
        )
        assert resp.status == 422
```

- [ ] **Step 7.2: Run — expect FAIL**

```bash
pytest tests/integration/test_http_service.py -v -k "conversations"
```

Expected: `404` or `AttributeError` — route not registered.

- [ ] **Step 7.3: Add routes and handlers in http_service.py**

In `create_http_app`, add route registrations after the existing routes:

```python
app.router.add_get("/v1/conversations", _handle_get_conversations)
app.router.add_patch("/v1/conversations/{session_id}", _handle_patch_conversation)
```

Also update the `_cors_middleware` `Access-Control-Allow-Methods` header to include `PATCH` (it already does per current code — verify it includes PATCH):
```python
resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
```

Add the two handlers at the bottom of `http_service.py`:

```python
async def _handle_get_conversations(request: web.Request) -> web.Response:
    """Return conversation history for the authenticated user."""
    user_id = request.headers.get("X-User-Id") or None
    if not user_id:
        return web.json_response(
            {"error": {"code": "missing_user_id", "message": "X-User-Id header required."}},
            status=400,
        )
    db: SupabaseClient = request.app[_DB_KEY]
    get_conv = getattr(db, "get_conversations", None)
    if get_conv is None:
        return web.json_response([], dumps=_json_dumps)
    conversations = await get_conv(user_id)
    return web.json_response(conversations, dumps=_json_dumps)


async def _handle_patch_conversation(request: web.Request) -> web.Response:
    """Rename a conversation title."""
    session_id = request.match_info["session_id"]
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {"error": {"code": "invalid_json", "message": "Invalid JSON."}},
            status=400,
        )
    title = body.get("title", "").strip()
    if not title:
        return web.json_response(
            {"error": {"code": "invalid_request", "message": "title must be a non-empty string."}},
            status=422,
        )
    db: SupabaseClient = request.app[_DB_KEY]
    update_title = getattr(db, "update_conversation_title", None)
    if update_title is not None:
        await update_title(session_id, title)
    return web.json_response({"ok": True})
```

- [ ] **Step 7.4: Run — expect PASS**

```bash
pytest tests/integration/test_http_service.py -v -k "conversations"
```

- [ ] **Step 7.5: Run full suite**

```bash
make test
```

- [ ] **Step 7.6: Commit**

```bash
git add interfaces/http_service.py tests/integration/test_http_service.py
git commit -m "feat(http): add GET /v1/conversations and PATCH /v1/conversations/:id"
```

---

## Task 8: Frontend Types + API Client

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 8.1: Add ConversationRecord to types.ts**

In `frontend/lib/types.ts`, add after `RouteHistoryRecord`:

```typescript
export interface ConversationRecord {
  session_id: string;
  title: string | null;
  first_query: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}
```

- [ ] **Step 8.2: Add API functions to api.ts**

In `frontend/lib/api.ts`, add after `submitFeedback`:

```typescript
/**
 * Fetch conversation history for the current user.
 * Returns an empty list if the user is unauthenticated or has no conversations.
 */
export async function fetchConversations(): Promise<ConversationRecord[]> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) return [];

  const res = await fetch(`${RUNTIME_URL}/v1/conversations`, {
    headers: authHeaders,
  });

  if (!res.ok) return [];
  return res.json() as Promise<ConversationRecord[]>;
}

/**
 * Rename a conversation.
 */
export async function patchConversationTitle(
  sessionId: string,
  title: string,
): Promise<void> {
  const res = await fetch(`${RUNTIME_URL}/v1/conversations/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error(`Rename failed (${res.status})`);
  }
}
```

Add the `ConversationRecord` import at the top of `api.ts`:

```typescript
import type { RuntimeRequest, RuntimeResponse, ConversationRecord } from "./types";
```

- [ ] **Step 8.3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors related to the new types.

- [ ] **Step 8.4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat(frontend): add ConversationRecord type and conversation API client"
```

---

## Task 9: useConversationHistory Hook

**Files:**
- Create: `frontend/hooks/useConversationHistory.ts`

- [ ] **Step 9.1: Create the hook**

```typescript
// frontend/hooks/useConversationHistory.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import type { ConversationRecord } from "../lib/types";
import { fetchConversations, patchConversationTitle } from "../lib/api";

/**
 * Loads conversation history from the backend on mount.
 * Provides `upsert` (called locally after each send) and `rename` (calls PATCH API).
 */
export function useConversationHistory() {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);

  useEffect(() => {
    fetchConversations()
      .then(setConversations)
      .catch(() => {}); // silence errors — sidebar history is best-effort
  }, []);

  const upsert = useCallback(
    (sessionId: string, firstQuery: string) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.session_id === sessionId);
        if (exists) {
          return prev.map((c) =>
            c.session_id === sessionId
              ? { ...c, updated_at: new Date().toISOString() }
              : c,
          );
        }
        const newRecord: ConversationRecord = {
          session_id: sessionId,
          title: null,
          first_query: firstQuery,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        return [newRecord, ...prev];
      });
    },
    [],
  );

  const rename = useCallback(
    (sessionId: string, title: string) => {
      // Optimistic update
      setConversations((prev) =>
        prev.map((c) =>
          c.session_id === sessionId ? { ...c, title } : c,
        ),
      );
      patchConversationTitle(sessionId, title).catch(() => {
        // Revert on failure — re-fetch from backend
        fetchConversations()
          .then(setConversations)
          .catch(() => {});
      });
    },
    [],
  );

  return { conversations, upsert, rename };
}
```

- [ ] **Step 9.2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add frontend/hooks/useConversationHistory.ts
git commit -m "feat(frontend): add useConversationHistory hook"
```

---

## Task 10: Sidebar + AppShell Refactor

**Files:**
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/components/layout/AppShell.tsx`
- Modify: `frontend/hooks/useChat.ts`
- Modify: `frontend/lib/dictionaries/ja.json`
- Modify: `frontend/lib/dictionaries/zh.json`
- Modify: `frontend/lib/dictionaries/en.json`

- [ ] **Step 10.1: Add i18n keys for sidebar rename**

In `frontend/lib/dictionaries/ja.json`, inside `"sidebar"`:
```json
"rename_hint": "クリックして編集"
```

In `frontend/lib/dictionaries/zh.json`, inside `"sidebar"`:
```json
"rename_hint": "点击编辑"
```

In `frontend/lib/dictionaries/en.json`, inside `"sidebar"`:
```json
"rename_hint": "Click to rename"
```

- [ ] **Step 10.2: Rewrite Sidebar.tsx**

Replace the entire file content:

```tsx
"use client";

import { useState, useRef, useCallback } from "react";
import type { ConversationRecord } from "../../lib/types";
import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALES, type Locale } from "../../lib/i18n";

interface SidebarProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectConversation: (sessionId: string) => void;
  onRenameConversation: (sessionId: string, title: string) => void;
}

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

function ConversationItem({
  record,
  isActive,
  onSelect,
  onRename,
}: {
  record: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = record.title ?? record.first_query;

  const startEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDraft(displayTitle);
      setEditing(true);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    [displayTitle],
  );

  const commitEdit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== displayTitle) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [draft, displayTitle, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitEdit();
      if (e.key === "Escape") setEditing(false);
    },
    [commitEdit],
  );

  return (
    <div
      onClick={editing ? undefined : onSelect}
      className={[
        "group mb-0.5 flex items-baseline gap-2.5 border-l-2 py-2 pl-2 pr-1 transition cursor-pointer",
        isActive
          ? "border-[var(--color-primary)] bg-[var(--color-sidebar-accent)]"
          : "border-transparent hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-sidebar-accent)]",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-xs text-[var(--color-fg)] outline-none"
          autoFocus
        />
      ) : (
        <p
          className="min-w-0 truncate text-xs font-light text-[var(--color-sidebar-accent-fg)]"
          onDoubleClick={startEdit}
          title={record.title ? undefined : record.first_query}
        >
          {displayTitle}
        </p>
      )}
    </div>
  );
}

export default function Sidebar({
  conversations,
  activeSessionId,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
}: SidebarProps) {
  const { sidebar: t } = useDict();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] lg:flex">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-[var(--color-sidebar-border)] px-5">
        <div className="flex flex-col gap-0.5">
          <span className="font-[family-name:var(--app-font-display)] text-lg font-semibold leading-none text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[9px] font-light tracking-[0.20em] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </div>
      </div>

      {/* New chat button */}
      <div className="px-4 pt-4">
        <button
          onClick={onNewChat}
          className="w-full border-b border-transparent py-2 text-left text-sm font-light text-[var(--color-sidebar-fg)] transition hover:border-[var(--color-primary)]/40 hover:text-[var(--color-sidebar-accent-fg)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          + {t.new_chat.replace(/^\+\s*/, "")}
        </button>
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto px-4 pt-5">
        {conversations.length > 0 && (
          <>
            <p className="pb-3 text-[10px] font-medium uppercase tracking-widest text-[var(--color-sidebar-fg)] opacity-60">
              {t.recent}
            </p>
            {conversations.map((record) => (
              <ConversationItem
                key={record.session_id}
                record={record}
                isActive={record.session_id === activeSessionId}
                onSelect={() => onSelectConversation(record.session_id)}
                onRename={(title) => onRenameConversation(record.session_id, title)}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--color-sidebar-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={[
                "text-[10px] font-light tracking-wide transition",
                locale === l
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
              ].join(" ")}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
          <span className="ml-auto text-sm text-[var(--color-primary)] opacity-30">◈</span>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 10.3: Update AppShell.tsx**

Remove the `routeHistory` useMemo and import. Add `useConversationHistory` and wire it up.

Replace the section from the top of the file through the `routeHistory` useMemo:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useLocale } from "../../lib/i18n-context";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultPanel from "./ResultPanel";
import ResultDrawer from "./ResultDrawer";

export default function AppShell() {
  const locale = useLocale();
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const { conversations, upsert: upsertConversation, rename: renameConversation } =
    useConversationHistory();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(360);
  const chatWidthRef = useRef(chatWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => { chatWidthRef.current = chatWidth; }, [chatWidth]);
```

Then update `handleSend` to call `upsertConversation` after a response arrives. This requires knowing the `sessionId` and response — currently the send callback doesn't return anything. A clean approach is to have `useChat.send` expose the response, or to call `upsertConversation` from within `useChat`. The simplest: update `useChat` to accept an `onResponse` callback.

Update the `handleSend` callback in AppShell:

```tsx
const handleSend = useCallback(
  (text: string) => {
    setActiveMessageId(null);
    setDrawerOpen(false);
    send(text);
  },
  [send],
);
```

And update `useChat` to call an optional callback after receiving a response (see Step 10.4).

Update the Sidebar render in AppShell:

```tsx
{!isMobile && (
  <Sidebar
    conversations={conversations}
    activeSessionId={sessionId}
    onNewChat={handleNewChat}
    onSelectConversation={(_sid) => {
      // selecting a past conversation: for now just load it via session (future)
    }}
    onRenameConversation={renameConversation}
  />
)}
```

Remove the now-unused `routeHistory` variable and `RouteHistoryRecord` import.

- [ ] **Step 10.4: Update useChat to call upsertConversation after response**

The simplest approach: add an `onResponse` optional callback to `useChat`.

In `frontend/hooks/useChat.ts`, update the signature:

```typescript
export function useChat(
  sessionId: string | null,
  onSessionId: (id: string) => void,
  locale?: RuntimeRequest["locale"],
  onResponse?: (sessionId: string, firstQuery: string) => void,
) {
```

Inside the `send` callback, after `onSessionId(response.session_id)`, add:

```typescript
if (response.session_id && onResponse) {
  onResponse(response.session_id, text.trim());
}
```

In AppShell, update the `useChat` call:

```tsx
const { messages, send, sending, clear } = useChat(
  sessionId,
  setSessionId,
  locale,
  upsertConversation,
);
```

- [ ] **Step 10.5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10.6: Run full suite**

```bash
make test
```

- [ ] **Step 10.7: Commit**

```bash
git add frontend/components/layout/Sidebar.tsx \
        frontend/components/layout/AppShell.tsx \
        frontend/hooks/useChat.ts \
        frontend/lib/dictionaries/ja.json \
        frontend/lib/dictionaries/zh.json \
        frontend/lib/dictionaries/en.json
git commit -m "feat(frontend): replace route history with persistent conversation sidebar"
```

---

## Task 11: F2d — force_refresh Data Freshness

**Files:**
- Modify: `agents/models.py`
- Modify: `agents/retriever.py`
- Modify: `agents/planner_agent.py`
- Test: `tests/unit/test_retriever.py`

- [ ] **Step 11.1: Write failing tests**

```python
# tests/unit/test_retriever.py — add to existing file

class TestForceRefresh:
    async def test_force_refresh_bypasses_row_count_short_circuit(self):
        """When force_refresh=True and DB has rows, still runs write-through fallback."""
        from agents.models import RetrievalRequest
        from agents.retriever import Retriever
        from agents.sql_agent import SQLResult
        from unittest.mock import AsyncMock, MagicMock

        db = MagicMock()
        request = RetrievalRequest(
            tool="search_bangumi",
            bangumi_id="253",
            force_refresh=True,
        )

        # sql_agent returns rows (simulating data already in DB)
        existing_row = {"id": "p1", "bangumi_id": "253"}
        fresh_row = {"id": "p2", "bangumi_id": "253"}

        sql_agent = MagicMock()
        sql_calls = [
            SQLResult(success=True, rows=[existing_row], row_count=1),
            SQLResult(success=True, rows=[existing_row, fresh_row], row_count=2),
        ]
        sql_agent.execute = AsyncMock(side_effect=sql_calls)

        # fetch_bangumi_points simulates external API data
        fetch_mock = AsyncMock(return_value=[MagicMock(id="p2", name="New", latitude=35.0, longitude=136.0)])

        retriever = Retriever(
            db,
            sql_agent=sql_agent,
            fetch_bangumi_points=fetch_mock,
        )
        # Call the internal method directly
        result, _ = await retriever._execute_sql_with_fallback(request)
        # Should have called fetch (write-through) even though DB had rows
        fetch_mock.assert_awaited_once()

    async def test_no_force_refresh_returns_existing_rows_immediately(self):
        """Default behavior: DB rows exist → return without calling external API."""
        from agents.models import RetrievalRequest
        from agents.retriever import Retriever
        from agents.sql_agent import SQLResult
        from unittest.mock import AsyncMock, MagicMock

        db = MagicMock()
        request = RetrievalRequest(
            tool="search_bangumi",
            bangumi_id="253",
        )

        existing_row = {"id": "p1", "bangumi_id": "253"}
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(return_value=SQLResult(success=True, rows=[existing_row], row_count=1))

        fetch_mock = AsyncMock()
        retriever = Retriever(db, sql_agent=sql_agent, fetch_bangumi_points=fetch_mock)
        await retriever._execute_sql_with_fallback(request)
        fetch_mock.assert_not_awaited()
```

- [ ] **Step 11.2: Run — expect FAIL**

```bash
pytest tests/unit/test_retriever.py::TestForceRefresh -v
```

Expected: either `ValidationError` (force_refresh unknown field) or the first test fails because fetch isn't called.

- [ ] **Step 11.3: Add force_refresh to RetrievalRequest**

In `agents/models.py`, add to `RetrievalRequest`:

```python
class RetrievalRequest(BaseModel):
    tool: Literal["search_bangumi", "search_nearby"]
    bangumi_id: str | None = None
    episode: int | None = None
    location: str | None = None
    origin: str | None = None
    radius: int | None = None
    force_refresh: bool = False
```

- [ ] **Step 11.4: Honor force_refresh in _execute_sql_with_fallback**

In `agents/retriever.py`, find `_execute_sql_with_fallback` and replace the early-return condition:

Before:
```python
if sql_result.row_count > 0 or not _should_try_db_miss_fallback(request):
    return sql_result, metadata
```

After:
```python
has_rows = sql_result.row_count > 0
should_fallback = _should_try_db_miss_fallback(request)

if has_rows and not request.force_refresh:
    return sql_result, metadata
if not has_rows and not should_fallback:
    return sql_result, metadata
```

- [ ] **Step 11.5: Update planner system prompt**

In `agents/planner_agent.py`, update the `search_bangumi` tool description:

```python
- search_bangumi(bangumi_id: str | None, episode: int | None, force_refresh: bool = false)
  Find pilgrimage filming locations for a specific anime.
  Set bangumi_id to null if a resolve_anime step precedes this.
  Set force_refresh to true ONLY when the user explicitly asks to refresh or re-fetch data
  (e.g. "データを更新して", "刷新数据", "refresh the data").
```

- [ ] **Step 11.6: Run — expect PASS**

```bash
pytest tests/unit/test_retriever.py::TestForceRefresh -v
```

- [ ] **Step 11.7: Run full suite**

```bash
make test
```

Expected: all green.

- [ ] **Step 11.8: Commit**

```bash
git add agents/models.py agents/retriever.py agents/planner_agent.py \
        tests/unit/test_retriever.py
git commit -m "feat(retriever): add force_refresh to bypass DB-first short-circuit"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| F2a: conversations table | Task 1 |
| F2a: LLM async title generation | Task 4 |
| F2a: user can rename, PATCH API | Task 7 |
| F2b: user_memory table | Task 1 |
| F2b: upsert after each response | Task 5 |
| F2b: _build_context_block merges user_memory | Task 6 |
| F2c: sidebar shows conversation list | Task 10 |
| F2c: useConversationHistory hook | Task 9 |
| F2c: inline title rename | Task 10 |
| F2d: force_refresh in RetrievalRequest | Task 11 |
| F2d: retriever honors force_refresh | Task 11 |
| F2d: planner can emit force_refresh | Task 11 |
| user_id from X-User-Id header | Task 3 |
| GET /v1/conversations endpoint | Task 7 |
| PATCH /v1/conversations/:id endpoint | Task 7 |

All requirements covered. No placeholders found.
