# Seichijunrei — Iter 1: Backend Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake dict-lookup PlannerAgent with a real LLM-driven ReActPlannerAgent; delete IntentAgent entirely; add `resolve_anime` self-evolve capability; remove the LLM `format_response` call; clean up all dependent layers using KISS + SOLID.

**Architecture:** `ReActPlannerAgent` (LLM → `ExecutionPlan`) → `ExecutorAgent` (deterministic, no LLM) → `Retriever` (unchanged strategy). New shared `agents/models.py` holds all types; `IntentOutput` is deleted—`RetrievalRequest` replaces it throughout. The cascade is: `models.py` → `sql_agent.py` → `retriever.py` → `executor_agent.py` → `planner_agent.py` → `pipeline.py` → delete `intent_agent.py`.

**Tech Stack:** Python 3.12, Pydantic AI, asyncpg, structlog, pytest-asyncio

**Pre-flight check:**
```bash
cd /path/to/seichijunrei-agent
make test   # all must pass before you start
```

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| **Create** | `agents/models.py` | All shared types: `PlanStep`, `ExecutionPlan`, `RetrievalRequest` |
| **Rewrite** | `agents/planner_agent.py` | `ReActPlannerAgent` class only — no dict lookup |
| **Rewrite** | `agents/executor_agent.py` | New handler dispatch for `ToolName`; no LLM calls; static message templates |
| **Modify** | `agents/sql_agent.py` | `execute(request: RetrievalRequest)` — drop `IntentOutput` dependency |
| **Modify** | `agents/retriever.py` | `execute(request: RetrievalRequest)` — drop `IntentOutput` dependency |
| **Simplify** | `agents/pipeline.py` | Two lines: `create_plan` → `execute` |
| **Delete** | `agents/intent_agent.py` | Replaced by `ReActPlannerAgent` + `models.py` |
| **Modify** | `infrastructure/supabase/client.py` | Add `find_bangumi_by_title`, `upsert_bangumi_title` |
| **Modify** | `infrastructure/gateways/bangumi.py` | Add `search_by_title` |
| **Modify** | `interfaces/public_api.py` | Add `"en"` to locale enum; add `ui` field to response |
| **Rewrite** | `tests/unit/test_planner_agent.py` | Tests for `ReActPlannerAgent` (mock LLM) |
| **Rewrite** | `tests/unit/test_pipeline.py` | Update to new pipeline signature |
| **Rewrite** | `tests/unit/test_retriever.py` | Use `RetrievalRequest` instead of `IntentOutput` |
| **Delete** | `tests/unit/test_intent_agent.py` | Deleted with source |

---

## Stream Note

Tasks 1–3 can be done in parallel (no dependencies between them).
Tasks 4–5 depend on Task 1 (`models.py`).
Tasks 6–7 depend on Tasks 4 and 5.
Tasks 8–10 can be done in parallel once Task 1 exists.
Task 11 depends on everything above.

---

## Task 1: `agents/models.py` — Shared Type System

**Files:**
- Create: `agents/models.py`
- Create: `tests/unit/test_models.py`

- [ ] **Step 1.1: Write the failing test**

```python
# tests/unit/test_models.py
from agents.models import ExecutionPlan, PlanStep, RetrievalRequest, ToolName


class TestToolName:
    def test_values(self):
        assert ToolName.RESOLVE_ANIME == "resolve_anime"
        assert ToolName.SEARCH_BANGUMI == "search_bangumi"
        assert ToolName.SEARCH_NEARBY == "search_nearby"
        assert ToolName.PLAN_ROUTE == "plan_route"
        assert ToolName.ANSWER_QUESTION == "answer_question"


class TestPlanStep:
    def test_defaults(self):
        step = PlanStep(tool=ToolName.SEARCH_BANGUMI)
        assert step.params == {}
        assert step.parallel is False

    def test_with_params(self):
        step = PlanStep(
            tool=ToolName.SEARCH_BANGUMI,
            params={"bangumi_id": "115908", "episode": 3},
        )
        assert step.params["bangumi_id"] == "115908"
        assert step.params["episode"] == 3


class TestExecutionPlan:
    def test_defaults(self):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
            reasoning="user asked about a specific anime",
        )
        assert plan.locale == "ja"
        assert len(plan.steps) == 1

    def test_locale_override(self):
        plan = ExecutionPlan(
            steps=[],
            reasoning="empty",
            locale="en",
        )
        assert plan.locale == "en"


class TestRetrievalRequest:
    def test_bangumi_request(self):
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908", episode=2)
        assert req.bangumi_id == "115908"
        assert req.episode == 2
        assert req.location is None

    def test_nearby_request(self):
        req = RetrievalRequest(tool="search_nearby", location="宇治", radius=3000)
        assert req.location == "宇治"
        assert req.radius == 3000
        assert req.bangumi_id is None
```

- [ ] **Step 1.2: Run test to confirm failure**
```bash
pytest tests/unit/test_models.py -v
# Expected: ImportError — agents.models does not exist
```

- [ ] **Step 1.3: Create `agents/models.py`**

```python
"""Shared agent types — single source of truth for plan and retrieval models.

No LLM logic here. These models cross boundaries (planner → executor → retriever).
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ToolName(str, Enum):
    """Tool names used in ExecutionPlan steps."""

    RESOLVE_ANIME = "resolve_anime"
    SEARCH_BANGUMI = "search_bangumi"
    SEARCH_NEARBY = "search_nearby"
    PLAN_ROUTE = "plan_route"
    ANSWER_QUESTION = "answer_question"


class PlanStep(BaseModel):
    """One step in an execution plan produced by ReActPlannerAgent."""

    tool: ToolName
    params: dict[str, Any] = Field(default_factory=dict)
    parallel: bool = False  # hint: can run concurrently with the next step


class ExecutionPlan(BaseModel):
    """Structured output of ReActPlannerAgent — consumed by ExecutorAgent."""

    steps: list[PlanStep]
    reasoning: str  # LLM's chain-of-thought (logged, never shown to users)
    locale: str = "ja"  # response language: "ja" | "zh" | "en"


class RetrievalRequest(BaseModel):
    """Normalized retrieval request passed to Retriever and SQLAgent.

    Replaces IntentOutput throughout the retrieval stack.
    """

    tool: Literal["search_bangumi", "search_nearby"]
    bangumi_id: str | None = None
    episode: int | None = None
    location: str | None = None
    origin: str | None = None  # for hybrid: bangumi search + geo around this point
    radius: int | None = None  # geo search radius in metres (default: 5000)
```

- [ ] **Step 1.4: Run test to confirm pass**
```bash
pytest tests/unit/test_models.py -v
# Expected: 7 passed
```

- [ ] **Step 1.5: Commit**
```bash
git add agents/models.py tests/unit/test_models.py
git commit -m "feat(models): add shared PlanStep, ExecutionPlan, RetrievalRequest types"
```

---

## Task 2: `infrastructure/supabase/client.py` — Bangumi Title Resolution

**Files:**
- Modify: `infrastructure/supabase/client.py` (after the `list_bangumi` method)
- Modify: `tests/unit/test_supabase_client.py`

- [ ] **Step 2.1: Write the failing tests**

Add to `tests/unit/test_supabase_client.py`:
```python
# Add these two test classes to the existing file

class TestFindBangumiByTitle:
    async def test_exact_title_match(self, mock_pool):
        mock_pool.fetchrow.return_value = {"id": "115908"}
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        result = await client.find_bangumi_by_title("響け！ユーフォニアム")
        assert result == "115908"
        # Verify it used ilike on both title columns
        call_args = mock_pool.fetchrow.call_args[0]
        assert "ilike" in call_args[0].lower() or "$1" in call_args[0]

    async def test_no_match_returns_none(self, mock_pool):
        mock_pool.fetchrow.return_value = None
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        result = await client.find_bangumi_by_title("unknown anime xyz")
        assert result is None


class TestUpsertBangumiTitle:
    async def test_upserts_title(self, mock_pool):
        mock_pool.execute.return_value = None
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        await client.upsert_bangumi_title("進撃の巨人", "6718")
        mock_pool.execute.assert_awaited_once()
        sql, *args = mock_pool.execute.call_args[0]
        assert "6718" in args or "進撃の巨人" in args
```

- [ ] **Step 2.2: Run test to confirm failure**
```bash
pytest tests/unit/test_supabase_client.py::TestFindBangumiByTitle \
       tests/unit/test_supabase_client.py::TestUpsertBangumiTitle -v
# Expected: AttributeError — method does not exist
```

- [ ] **Step 2.3: Add methods to `infrastructure/supabase/client.py`**

Add after the `upsert_bangumi` method:
```python
async def find_bangumi_by_title(self, title: str) -> str | None:
    """Find a bangumi_id by fuzzy title match (case-insensitive).

    Checks both the Japanese title and Chinese title columns.

    Args:
        title: Anime title in any language.

    Returns:
        bangumi_id string if found, None otherwise.
    """
    row = await self.pool.fetchrow(
        """
        SELECT id FROM bangumi
        WHERE title ILIKE $1 OR title_cn ILIKE $1
        LIMIT 1
        """,
        f"%{title}%",
    )
    return str(row["id"]) if row else None

async def upsert_bangumi_title(self, title: str, bangumi_id: str) -> None:
    """Record a title→bangumi_id mapping (write-through from external API).

    Inserts a minimal bangumi record if none exists for this ID, so that
    future calls to find_bangumi_by_title will hit the DB instead of the API.

    Args:
        title: Anime title (used to populate the title column on insert).
        bangumi_id: Bangumi.tv subject ID.
    """
    await self.pool.execute(
        """
        INSERT INTO bangumi (id, title)
        VALUES ($1, $2)
        ON CONFLICT (id) DO NOTHING
        """,
        bangumi_id,
        title,
    )
```

- [ ] **Step 2.4: Run tests to confirm pass**
```bash
pytest tests/unit/test_supabase_client.py -v
# Expected: all pass
```

- [ ] **Step 2.5: Commit**
```bash
git add infrastructure/supabase/client.py tests/unit/test_supabase_client.py
git commit -m "feat(db): add find_bangumi_by_title and upsert_bangumi_title to SupabaseClient"
```

---

## Task 3: `infrastructure/gateways/bangumi.py` — Title Search

**Files:**
- Modify: `infrastructure/gateways/bangumi.py`
- Modify: `application/ports/bangumi_gateway.py` (add `search_by_title` to the port)
- Modify: `tests/unit/test_gateway_contracts.py`

- [ ] **Step 3.1: Find and read the port definition**
```bash
grep -n "search_subject\|class BangumiGateway" application/ports/*.py
```

- [ ] **Step 3.2: Write the failing test**

Add to `tests/unit/test_gateway_contracts.py`:
```python
class TestBangumiClientGatewaySearchByTitle:
    async def test_returns_bangumi_id_on_hit(self):
        mock_client = AsyncMock()
        mock_client.search_subject = AsyncMock(
            return_value=[{"id": 6718, "name": "進撃の巨人"}]
        )
        gateway = BangumiClientGateway(client=mock_client)
        result = await gateway.search_by_title("進撃の巨人")
        assert result == "6718"

    async def test_returns_none_on_empty_results(self):
        mock_client = AsyncMock()
        mock_client.search_subject = AsyncMock(return_value=[])
        gateway = BangumiClientGateway(client=mock_client)
        result = await gateway.search_by_title("completely unknown anime xyz")
        assert result is None
```

- [ ] **Step 3.3: Run test to confirm failure**
```bash
pytest tests/unit/test_gateway_contracts.py::TestBangumiClientGatewaySearchByTitle -v
# Expected: AttributeError — search_by_title does not exist
```

- [ ] **Step 3.4: Add `search_by_title` to `BangumiGateway` port**

In `application/ports/bangumi_gateway.py` (or wherever `BangumiGateway` is defined), add:
```python
@abstractmethod
async def search_by_title(self, title: str) -> str | None:
    """Search for an anime by title. Returns bangumi_id string or None."""
```

- [ ] **Step 3.5: Implement in `infrastructure/gateways/bangumi.py`**

Add to `BangumiClientGateway`:
```python
async def search_by_title(self, title: str) -> str | None:
    """Search Bangumi.tv for an anime by title.

    Uses search_subject (type=2 = anime). Returns bangumi_id as a string,
    or None if no results.

    Args:
        title: Anime title in any language.

    Returns:
        bangumi_id string (first result) or None.
    """
    try:
        if self._client is not None:
            results = await self._client.search_subject(
                keyword=title, subject_type=2, max_results=1
            )
        else:
            async with BangumiClient() as client:
                results = await client.search_subject(
                    keyword=title, subject_type=2, max_results=1
                )
        if results:
            return str(results[0]["id"])
        return None
    except (ValueError, APIError):
        return None
```

- [ ] **Step 3.6: Run tests to confirm pass**
```bash
pytest tests/unit/test_gateway_contracts.py -v
# Expected: all pass
```

- [ ] **Step 3.7: Commit**
```bash
git add application/ports/ infrastructure/gateways/bangumi.py tests/unit/test_gateway_contracts.py
git commit -m "feat(gateway): add search_by_title to BangumiGateway port and adapter"
```

---

## Task 4: `agents/sql_agent.py` — Replace `IntentOutput` with `RetrievalRequest`

**Files:**
- Modify: `agents/sql_agent.py`
- Modify: `tests/unit/test_sql_agent.py`

- [ ] **Step 4.1: Read the full SQLAgent.execute method**
```bash
grep -n "def execute\|def _build\|def _query" agents/sql_agent.py
```

- [ ] **Step 4.2: Write failing tests (new signature)**

Replace the `execute` tests in `tests/unit/test_sql_agent.py`:
```python
from agents.models import RetrievalRequest


class TestSQLAgentExecute:
    async def test_bangumi_query(self, mock_db):
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908")
        result = await agent.execute(req)
        assert result.success
        mock_db.pool.fetch.assert_awaited_once()
        sql = mock_db.pool.fetch.call_args[0][0]
        assert "bangumi_id" in sql
        assert "$1" in sql

    async def test_bangumi_with_episode(self, mock_db):
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908", episode=3)
        result = await agent.execute(req)
        assert result.success
        sql = mock_db.pool.fetch.call_args[0][0]
        assert "episode" in sql

    async def test_nearby_query(self, mock_db):
        mock_db.search_points_by_location = AsyncMock(return_value=[])
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_nearby", location="宇治", radius=3000)
        result = await agent.execute(req)
        assert result.success
```

- [ ] **Step 4.3: Run test to confirm failure**
```bash
pytest tests/unit/test_sql_agent.py -v
# Expected: TypeError — execute() takes IntentOutput, got RetrievalRequest
```

- [ ] **Step 4.4: Update `agents/sql_agent.py`**

Replace the `import` at the top:
```python
# Remove:
from agents.intent_agent import ExtractedParams, IntentOutput
# Add:
from agents.models import RetrievalRequest
```

Update `SQLAgent.execute` signature and all internal methods that reference `IntentOutput`:

```python
async def execute(self, request: RetrievalRequest) -> SQLResult:
    """Execute a parameterized SQL query from a RetrievalRequest.

    Args:
        request: RetrievalRequest with tool type and query parameters.

    Returns:
        SQLResult with rows and metadata.
    """
    if request.tool == "search_nearby":
        return await self._execute_location_query(request)
    return await self._execute_bangumi_query(request)
```

For each internal `_build_*` / `_execute_*` method that accepted `IntentOutput`, change the signature to accept `RetrievalRequest` and replace field access:

| Old field | New field |
|-----------|-----------|
| `intent.extracted_params.bangumi` | `request.bangumi_id` |
| `intent.extracted_params.episode` | `request.episode` |
| `intent.extracted_params.location` | `request.location` |
| `intent.extracted_params.origin` | `request.origin` |
| `intent.extracted_params.radius` | `request.radius` |
| `intent.intent == "search_by_bangumi"` | `request.tool == "search_bangumi"` |
| `intent.intent == "plan_route"` | `request.tool == "search_bangumi"` (route also queries bangumi points) |
| `intent.intent == "search_by_location"` | `request.tool == "search_nearby"` |

- [ ] **Step 4.5: Run test to confirm pass**
```bash
pytest tests/unit/test_sql_agent.py -v
# Expected: all pass
```

- [ ] **Step 4.6: Commit**
```bash
git add agents/sql_agent.py tests/unit/test_sql_agent.py
git commit -m "refactor(sql_agent): replace IntentOutput with RetrievalRequest"
```

---

## Task 5: `agents/retriever.py` — Replace `IntentOutput` with `RetrievalRequest`

**Files:**
- Modify: `agents/retriever.py`
- Rewrite: `tests/unit/test_retriever.py`

- [ ] **Step 5.1: Write failing tests**

Replace test helpers and add updated strategy tests in `tests/unit/test_retriever.py`:
```python
# Replace _make_intent helper with:
from agents.models import RetrievalRequest

def _make_req(tool: str, **kwargs) -> RetrievalRequest:
    return RetrievalRequest(tool=tool, **kwargs)


class TestStrategySelection:
    def test_nearby_uses_geo(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(_make_req("search_nearby", location="宇治"))
        assert strategy == RetrievalStrategy.GEO

    def test_bangumi_uses_sql(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(_make_req("search_bangumi", bangumi_id="115908"))
        assert strategy == RetrievalStrategy.SQL

    def test_bangumi_with_origin_uses_hybrid(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(
            _make_req("search_bangumi", bangumi_id="115908", origin="宇治")
        )
        assert strategy == RetrievalStrategy.HYBRID


class TestRetrieverExecute:
    async def test_bangumi_execute(self, mock_db):
        retriever = Retriever(mock_db)
        result = await retriever.execute(_make_req("search_bangumi", bangumi_id="115908"))
        assert result.success
        assert result.strategy == RetrievalStrategy.SQL
```

- [ ] **Step 5.2: Run test to confirm failure**
```bash
pytest tests/unit/test_retriever.py -v
# Expected: TypeError — choose_strategy/execute takes IntentOutput
```

- [ ] **Step 5.3: Update `agents/retriever.py`**

Replace import:
```python
# Remove:
from agents.intent_agent import IntentOutput
# Add:
from agents.models import RetrievalRequest
```

Update all method signatures:
```python
def choose_strategy(self, request: RetrievalRequest) -> RetrievalStrategy:
    if request.tool == "search_nearby":
        return RetrievalStrategy.GEO
    if request.tool == "search_bangumi":
        if request.bangumi_id and (request.location or request.origin):
            return RetrievalStrategy.HYBRID
        return RetrievalStrategy.SQL
    return RetrievalStrategy.SQL

async def execute(self, request: RetrievalRequest) -> RetrievalResult:
    strategy = self.choose_strategy(request)
    cache_key = self._cache.generate_key(
        "retrieval",
        {
            "db_scope": id(self._db),
            "tool": request.tool,
            "strategy": strategy.value,
            "params": request.model_dump(mode="json"),
        },
    )
    # ... rest unchanged, replace intent → request throughout
```

For internal methods `_execute_sql`, `_execute_geo`, `_execute_hybrid`, `_execute_sql_with_fallback`:
- Change signature from `(self, intent: IntentOutput)` to `(self, request: RetrievalRequest)`
- Replace field accesses per the same table as Task 4

For `_should_try_db_miss_fallback` (standalone function):
```python
def _should_try_db_miss_fallback(request: RetrievalRequest) -> bool:
    return request.tool == "search_bangumi" and bool(request.bangumi_id)
```

- [ ] **Step 5.4: Run test to confirm pass**
```bash
pytest tests/unit/test_retriever.py -v
# Expected: all pass
```

- [ ] **Step 5.5: Commit**
```bash
git add agents/retriever.py tests/unit/test_retriever.py
git commit -m "refactor(retriever): replace IntentOutput with RetrievalRequest"
```

---

## Task 6: `agents/executor_agent.py` — New Handler Dispatch + Remove LLM Message Call

**Files:**
- Rewrite: `agents/executor_agent.py`
- Rewrite: `tests/unit/test_executor_agent.py`

This is the largest single change. The executor gains three new handlers (`_execute_resolve_anime`, `_execute_search_bangumi`, `_execute_search_nearby`), the old `_execute_query_db` is removed, `_execute_format_response` no longer makes LLM calls (uses static templates), and `execute()` drops the `intent: IntentOutput` parameter.

- [ ] **Step 6.1: Write the failing tests**

```python
# tests/unit/test_executor_agent.py
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.executor_agent import ExecutorAgent
from agents.models import ExecutionPlan, PlanStep, ToolName


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.find_bangumi_by_title = AsyncMock(return_value=None)
    db.upsert_bangumi_title = AsyncMock()
    return db


def _plan(*steps: PlanStep, locale: str = "ja") -> ExecutionPlan:
    return ExecutionPlan(steps=list(steps), reasoning="test", locale=locale)


class TestExecutorAgentExecute:
    async def test_search_bangumi_empty(self, mock_db):
        plan = _plan(PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}))
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "search_bangumi"
        assert result.success
        assert result.final_output["status"] == "empty"

    async def test_search_nearby_delegates_to_retriever(self, mock_db):
        mock_db.search_points_by_location.return_value = [
            {"id": "p1", "bangumi_id": "115908", "distance_m": 200}
        ]
        plan = _plan(PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治"}))
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "search_nearby"
        assert result.success

    async def test_plan_route_uses_nn_sort(self, mock_db):
        rows = [
            {"id": "a", "latitude": 34.88, "longitude": 135.80},
            {"id": "b", "latitude": 34.89, "longitude": 135.79},
        ]
        mock_db.pool.fetch.return_value = rows
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            PlanStep(tool=ToolName.PLAN_ROUTE, params={}),
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "plan_route"
        assert result.success
        route = result.final_output.get("route", {})
        assert route.get("point_count", 0) == 2

    async def test_resolve_anime_db_hit(self, mock_db):
        mock_db.find_bangumi_by_title.return_value = "115908"
        plan = _plan(
            PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "吹响"}),
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": None}),
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.success
        # DB was called for title lookup
        mock_db.find_bangumi_by_title.assert_awaited_once_with("吹响")

    async def test_answer_question(self, mock_db):
        plan = _plan(PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "おはよう"}))
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "answer_question"
        assert result.success

    async def test_locale_en_message(self, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "p1", "bangumi_id": "115908", "latitude": None, "longitude": None}
        ]
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            locale="en",
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert "Found" in result.final_output.get("message", "")
```

- [ ] **Step 6.2: Run test to confirm failure**
```bash
pytest tests/unit/test_executor_agent.py -v
# Expected: ImportError or TypeError — new API not yet implemented
```

- [ ] **Step 6.3: Rewrite `agents/executor_agent.py`**

```python
"""ExecutorAgent — deterministic plan step execution.

Accepts an ExecutionPlan from ReActPlannerAgent and executes each step using
the appropriate handler. No LLM calls — all responses use static message
templates. Steps communicate via context dict (each step deposits its output).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog

from agents.models import ExecutionPlan, PlanStep, RetrievalRequest, ToolName
from agents.retriever import RetrievalResult, Retriever
from infrastructure.gateways.bangumi import BangumiClientGateway

logger = structlog.get_logger(__name__)


# ── Static response message templates ────────────────────────────────────────
# Keyed by (primary_tool, locale). These replace the LLM message call,
# saving one LLM round-trip per request.

_MESSAGES: dict[tuple[str, str], str] = {
    ("search_bangumi", "ja"): "{count}件の聖地が見つかりました。",
    ("search_bangumi", "zh"): "找到了{count}处圣地。",
    ("search_bangumi", "en"): "Found {count} pilgrimage spots.",
    ("search_nearby", "ja"): "この周辺に{count}件の聖地があります。",
    ("search_nearby", "zh"): "附近有{count}处圣地。",
    ("search_nearby", "en"): "Found {count} pilgrimage spots nearby.",
    ("plan_route", "ja"): "{count}件のスポットで最適ルートを作成しました。",
    ("plan_route", "zh"): "已为{count}处圣地规划路线。",
    ("plan_route", "en"): "Created a route with {count} pilgrimage stops.",
    ("answer_question", "ja"): "",
    ("answer_question", "zh"): "",
    ("answer_question", "en"): "",
    ("empty", "ja"): "該当する巡礼地が見つかりませんでした。",
    ("empty", "zh"): "没有找到相关的巡礼地。",
    ("empty", "en"): "No pilgrimage spots found.",
    ("unclear", "ja"): "もう少し具体的に教えていただけますか？",
    ("unclear", "zh"): "能再具体一些吗？",
    ("unclear", "en"): "Could you be more specific?",
}


def _build_message(primary_tool: str, count: int, locale: str) -> str:
    """Build a static response message from template."""
    if count == 0:
        return _MESSAGES.get(("empty", locale), "")
    return _MESSAGES.get((primary_tool, locale), "").format(count=count)


# ── Result types ─────────────────────────────────────────────────────────────


@dataclass
class StepResult:
    tool: str
    success: bool
    data: Any = None
    error: str | None = None


@dataclass
class PipelineResult:
    intent: str
    plan: ExecutionPlan
    step_results: list[StepResult] = field(default_factory=list)
    final_output: dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return all(r.success for r in self.step_results)


# ── Executor ──────────────────────────────────────────────────────────────────


class ExecutorAgent:
    """Executes ExecutionPlan steps deterministically.

    No LLM calls inside this class. Steps communicate via a shared context dict.
    """

    def __init__(self, db: Any) -> None:
        self._retriever = Retriever(db)
        self._db = db

    async def execute(self, plan: ExecutionPlan) -> PipelineResult:
        """Execute all steps in the plan and return a PipelineResult.

        Args:
            plan: ExecutionPlan from ReActPlannerAgent (includes locale).

        Returns:
            PipelineResult with step results and final output dict.
        """
        primary_tool = _infer_primary_tool(plan)
        result = PipelineResult(intent=primary_tool, plan=plan)
        context: dict[str, Any] = {"locale": plan.locale}

        for step in plan.steps:
            step_result = await self._execute_step(step, context)
            result.step_results.append(step_result)

            if not step_result.success:
                logger.warning("step_failed", tool=step.tool, error=step_result.error)
                break  # abort remaining steps on failure

            context[step.tool.value] = step_result.data

        result.final_output = self._build_output(result, context, primary_tool)
        return result

    async def _execute_step(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        handler = {
            ToolName.RESOLVE_ANIME: self._execute_resolve_anime,
            ToolName.SEARCH_BANGUMI: self._execute_search_bangumi,
            ToolName.SEARCH_NEARBY: self._execute_search_nearby,
            ToolName.PLAN_ROUTE: self._execute_plan_route,
            ToolName.ANSWER_QUESTION: self._execute_answer_question,
        }.get(step.tool)

        if handler is None:
            return StepResult(
                tool=step.tool.value,
                success=False,
                error=f"No handler for tool: {step.tool}",
            )
        try:
            return await handler(step, context)
        except Exception as exc:
            logger.error("step_execution_error", tool=step.tool, error=str(exc))
            return StepResult(tool=step.tool.value, success=False, error=str(exc))

    # ── Step handlers ─────────────────────────────────────────────────────────

    async def _execute_resolve_anime(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Resolve anime title → bangumi_id.

        Strategy: DB first, Bangumi.tv API on miss (write-through).

        Input params: {"title": str}
        Output data:  {"bangumi_id": str}
        """
        title = step.params.get("title", "")
        if not title:
            return StepResult(tool="resolve_anime", success=False, error="No title provided")

        # 1. DB lookup
        bangumi_id = await self._db.find_bangumi_by_title(title)
        if bangumi_id:
            logger.info("resolve_anime_db_hit", title=title, bangumi_id=bangumi_id)
            return StepResult(tool="resolve_anime", success=True, data={"bangumi_id": bangumi_id})

        # 2. Bangumi.tv API
        gateway = BangumiClientGateway()
        bangumi_id = await gateway.search_by_title(title)
        if bangumi_id:
            await self._db.upsert_bangumi_title(title, bangumi_id)
            logger.info("resolve_anime_api_hit", title=title, bangumi_id=bangumi_id)
            return StepResult(tool="resolve_anime", success=True, data={"bangumi_id": bangumi_id})

        return StepResult(
            tool="resolve_anime",
            success=False,
            error=f"Could not resolve anime: '{title}'",
        )

    async def _execute_search_bangumi(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Search pilgrimage points for a specific bangumi.

        Input params: {"bangumi_id": str | None, "episode": int | None}
        If bangumi_id is absent, uses resolve_anime result from context.
        Output data:  retrieval payload dict (rows, row_count, strategy, ...)
        """
        bangumi_id = step.params.get("bangumi_id")
        if not bangumi_id:
            resolved = context.get(ToolName.RESOLVE_ANIME.value, {})
            bangumi_id = resolved.get("bangumi_id")
        if not bangumi_id:
            return StepResult(
                tool="search_bangumi", success=False, error="No bangumi_id available"
            )

        req = RetrievalRequest(
            tool="search_bangumi",
            bangumi_id=bangumi_id,
            episode=step.params.get("episode"),
            origin=step.params.get("origin"),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_bangumi",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _execute_search_nearby(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Search pilgrimage points near a location.

        Input params: {"location": str, "radius": int | None}
        Output data:  retrieval payload dict
        """
        location = step.params.get("location", "")
        req = RetrievalRequest(
            tool="search_nearby",
            location=location,
            radius=step.params.get("radius"),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_nearby",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _execute_plan_route(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Sort search results into an optimised walking route.

        Reads 'search_bangumi' or 'search_nearby' from context.
        Input params: {} (reads from context)
        Output data:  {"ordered_points": list, "point_count": int, "status": str, "summary": dict}
        """
        query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
            ToolName.SEARCH_NEARBY.value
        )
        rows = (query_data or {}).get("rows", [])
        if not rows:
            return StepResult(tool="plan_route", success=False, error="No points to route")

        ordered = _nearest_neighbor_sort(rows)
        with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
        return StepResult(
            tool="plan_route",
            success=True,
            data={
                "ordered_points": ordered,
                "point_count": len(ordered),
                "status": "ok",
                "summary": {
                    "point_count": len(ordered),
                    "with_coordinates": len(with_coords),
                    "without_coordinates": len(rows) - len(with_coords),
                },
            },
        )

    async def _execute_answer_question(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Return a plain QA answer (no retrieval).

        Input params: {"answer": str}  (PlannerAgent fills this in)
        Output data:  {"message": str, "status": "info"}
        """
        return StepResult(
            tool="answer_question",
            success=True,
            data={
                "message": step.params.get("answer", ""),
                "status": "info",
            },
        )

    # ── Output builder ────────────────────────────────────────────────────────

    def _build_output(
        self, result: PipelineResult, context: dict[str, Any], primary_tool: str
    ) -> dict[str, Any]:
        locale = context.get("locale", "ja")
        query_data = (
            context.get(ToolName.SEARCH_BANGUMI.value)
            or context.get(ToolName.SEARCH_NEARBY.value)
        )
        route_data = context.get(ToolName.PLAN_ROUTE.value)
        qa_data = context.get(ToolName.ANSWER_QUESTION.value)

        count = (query_data or {}).get("row_count", 0)
        is_empty = count == 0
        status = "empty" if is_empty else "ok"
        if not result.success:
            status = "error"

        message = _build_message(primary_tool, count, locale)

        output: dict[str, Any] = {
            "intent": primary_tool,
            "success": result.success,
            "status": status,
            "message": message,
        }
        if query_data:
            output["results"] = query_data
        if route_data:
            output["route"] = route_data
        if qa_data:
            output["message"] = qa_data.get("message", "")
            output["status"] = qa_data.get("status", "info")
        if not result.success:
            output["errors"] = [r.error for r in result.step_results if r.error]
        return output


# ── Helpers ───────────────────────────────────────────────────────────────────


def _infer_primary_tool(plan: ExecutionPlan) -> str:
    """Return the primary tool name for intent labelling and message selection."""
    # Priority order: plan_route > search_bangumi > search_nearby > answer_question
    tools = [s.tool for s in plan.steps]
    for priority in (
        ToolName.PLAN_ROUTE,
        ToolName.SEARCH_BANGUMI,
        ToolName.SEARCH_NEARBY,
        ToolName.ANSWER_QUESTION,
    ):
        if priority in tools:
            return priority.value
    return tools[0].value if tools else "unknown"


def _build_query_payload(retrieval: RetrievalResult) -> dict[str, Any]:
    metadata = dict(retrieval.metadata)
    empty = retrieval.row_count == 0
    return {
        "rows": retrieval.rows,
        "items": retrieval.rows,
        "row_count": retrieval.row_count,
        "strategy": retrieval.strategy.value,
        "metadata": metadata,
        "status": "empty" if empty else "ok",
        "empty": empty,
        "summary": {
            "count": retrieval.row_count,
            "source": metadata.get("data_origin", metadata.get("source", "db")),
            "cache": metadata.get("cache", "miss"),
        },
    }


def _nearest_neighbor_sort(rows: list[dict]) -> list[dict]:
    """Sort points by nearest-neighbor heuristic. O(n²), fine for <100 points."""
    if len(rows) <= 1:
        return list(rows)
    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
    without_coords = [r for r in rows if not (r.get("latitude") and r.get("longitude"))]
    if not with_coords:
        return list(rows)

    ordered = [with_coords[0]]
    remaining = with_coords[1:]
    while remaining:
        last = ordered[-1]
        last_lat, last_lon = float(last["latitude"]), float(last["longitude"])
        best_idx, best_dist = 0, float("inf")
        for i, c in enumerate(remaining):
            d = (float(c["latitude"]) - last_lat) ** 2 + (
                float(c["longitude"]) - last_lon
            ) ** 2
            if d < best_dist:
                best_dist, best_idx = d, i
        ordered.append(remaining.pop(best_idx))

    return ordered + without_coords
```

- [ ] **Step 6.4: Run test to confirm pass**
```bash
pytest tests/unit/test_executor_agent.py -v
# Expected: all pass
```

- [ ] **Step 6.5: Commit**
```bash
git add agents/executor_agent.py tests/unit/test_executor_agent.py
git commit -m "refactor(executor): new handler dispatch for ToolName, remove LLM format_response call"
```

---

## Task 7: `agents/planner_agent.py` — Rewrite as ReActPlannerAgent

**Files:**
- Rewrite: `agents/planner_agent.py`
- Rewrite: `tests/unit/test_planner_agent.py`

- [ ] **Step 7.1: Write failing tests**

```python
# tests/unit/test_planner_agent.py
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agents.models import ExecutionPlan, ToolName
from agents.planner_agent import ReActPlannerAgent


@pytest.fixture
def mock_plan_bangumi() -> ExecutionPlan:
    from agents.models import PlanStep
    return ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
        reasoning="user asked about a specific anime",
        locale="ja",
    )


@pytest.fixture
def mock_plan_route() -> ExecutionPlan:
    from agents.models import PlanStep
    return ExecutionPlan(
        steps=[
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            PlanStep(tool=ToolName.PLAN_ROUTE, params={}),
        ],
        reasoning="user wants a route",
        locale="ja",
    )


class TestReActPlannerAgent:
    async def test_create_plan_returns_execution_plan(self, mock_plan_bangumi):
        with patch("agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("吹响的圣地在哪", locale="ja")

        assert isinstance(plan, ExecutionPlan)
        assert plan.locale == "ja"
        assert len(plan.steps) >= 1

    async def test_create_plan_passes_locale_in_prompt(self, mock_plan_bangumi):
        with patch("agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            await planner.create_plan("where is kyoani", locale="en")

            call_args = mock_agent.run.call_args[0][0]
            assert "en" in call_args  # locale embedded in prompt

    async def test_create_plan_retries_on_failure(self, mock_plan_bangumi):
        with patch("agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            # Fail once, then succeed
            mock_agent.run.side_effect = [
                Exception("LLM timeout"),
                AsyncMock(output=mock_plan_bangumi),
            ]
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            with pytest.raises(Exception, match="LLM timeout"):
                await planner.create_plan("test", locale="ja")
            # Pydantic AI's built-in retry handles retries at the agent level;
            # we just confirm the call was made
```

- [ ] **Step 7.2: Run test to confirm failure**
```bash
pytest tests/unit/test_planner_agent.py -v
# Expected: ImportError — ReActPlannerAgent does not exist
```

- [ ] **Step 7.3: Rewrite `agents/planner_agent.py`**

```python
"""ReActPlannerAgent — LLM-driven plan generation.

Replaces the old dict-lookup PlannerAgent. Uses Pydantic AI structured output
to produce an ExecutionPlan from free-text user input.

Usage:
    planner = ReActPlannerAgent()
    plan = await planner.create_plan("吹响の聖地はどこ", locale="ja")
"""
from __future__ import annotations

from typing import Any

from agents.base import create_agent, get_default_model
from agents.models import ExecutionPlan

PLANNER_SYSTEM_PROMPT = """\
You are a planning agent for an anime pilgrimage (聖地巡礼) search app.

Your job: understand the user's request and output a structured execution plan.

## Available tools

- resolve_anime(title: str)
  Resolve an anime title to a bangumi_id (DB-first, then Bangumi.tv API).
  Use this whenever the user mentions an anime by name and you don't have its ID.
  Do NOT hardcode bangumi IDs in your plan.

- search_bangumi(bangumi_id: str | None, episode: int | None)
  Find pilgrimage filming locations for a specific anime.
  Set bangumi_id to null if a resolve_anime step precedes this.

- search_nearby(location: str, radius: int | None)
  Find pilgrimage locations near a station, city, or area.
  Use when the user asks about a geographic area rather than a specific anime.

- plan_route(params: {})
  Sort the results of a preceding search_bangumi step into an optimal walking order.
  Only include this after a search_bangumi step.

- answer_question(answer: str)
  For general QA about anime pilgrimage (etiquette, tips, etc.).
  Fill the answer field with a short, helpful response.

## Rules

1. For any anime query: ALWAYS emit resolve_anime first, then search_bangumi.
   Never hardcode bangumi IDs. The DB grows automatically.
2. For location queries: use search_nearby only. No resolve_anime needed.
3. For route requests: add plan_route after search_bangumi.
4. Set locale in the plan to match the user's language.
5. Keep plans minimal — the fewest steps that satisfy the request.
6. Fill reasoning with your chain-of-thought (for logging/debugging).

## locale values
- "ja" for Japanese queries
- "zh" for Chinese queries
- "en" for English queries
"""


class ReActPlannerAgent:
    """LLM-driven planner: user text → ExecutionPlan.

    Uses Pydantic AI structured output with retries=2.
    The agent is stateless — a new Pydantic AI Agent is created per instance.
    """

    def __init__(self, model: Any = None) -> None:
        self._agent = create_agent(
            model or get_default_model(),
            system_prompt=PLANNER_SYSTEM_PROMPT,
            output_type=ExecutionPlan,
            retries=2,
        )

    async def create_plan(self, text: str, locale: str = "ja") -> ExecutionPlan:
        """Generate an ExecutionPlan from user text.

        Args:
            text: Raw user message.
            locale: Hint for the LLM — "ja", "zh", or "en".

        Returns:
            ExecutionPlan with steps and reasoning.
        """
        prompt = f"[locale={locale}] {text}"
        result = await self._agent.run(prompt)
        return result.output
```

- [ ] **Step 7.4: Run test to confirm pass**
```bash
pytest tests/unit/test_planner_agent.py -v
# Expected: all pass
```

- [ ] **Step 7.5: Commit**
```bash
git add agents/planner_agent.py tests/unit/test_planner_agent.py
git commit -m "feat(planner): rewrite as ReActPlannerAgent — LLM structured output, no dict lookup"
```

---

## Task 8: `agents/pipeline.py` — Simplify

**Files:**
- Rewrite: `agents/pipeline.py`
- Modify: `tests/unit/test_pipeline.py`

- [ ] **Step 8.1: Write failing tests**

```python
# tests/unit/test_pipeline.py
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.executor_agent import PipelineResult
from agents.models import ExecutionPlan, PlanStep, ToolName
from agents.pipeline import run_pipeline


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.find_bangumi_by_title = AsyncMock(return_value=None)
    db.upsert_bangumi_title = AsyncMock()
    return db


@pytest.fixture
def _mock_planner():
    """Patch ReActPlannerAgent.create_plan to return a deterministic plan."""
    def _make_patch(tool: ToolName, params: dict):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=tool, params=params)],
            reasoning="mocked",
            locale="ja",
        )
        with patch(
            "agents.pipeline.ReActPlannerAgent.create_plan",
            new_callable=lambda: lambda self, *a, **kw: AsyncMock(return_value=plan)(),
        ):
            yield plan

    return _make_patch


class TestRunPipeline:
    async def test_bangumi_pipeline(self, mock_db):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
            reasoning="test",
            locale="ja",
        )
        with patch(
            "agents.pipeline.ReActPlannerAgent",
        ) as MockPlanner:
            MockPlanner.return_value.create_plan = AsyncMock(return_value=plan)
            result = await run_pipeline("吹响の聖地", mock_db)

        assert isinstance(result, PipelineResult)
        assert result.intent == "search_bangumi"
        assert result.success

    async def test_pipeline_returns_pipeline_result(self, mock_db):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "巡礼とは..."})],
            reasoning="qa",
            locale="ja",
        )
        with patch("agents.pipeline.ReActPlannerAgent") as MockPlanner:
            MockPlanner.return_value.create_plan = AsyncMock(return_value=plan)
            result = await run_pipeline("聖地巡礼とは", mock_db)

        assert result.intent == "answer_question"
```

- [ ] **Step 8.2: Run test to confirm failure**
```bash
pytest tests/unit/test_pipeline.py -v
# Expected: ImportError — pipeline still imports old symbols
```

- [ ] **Step 8.3: Rewrite `agents/pipeline.py`**

```python
"""Pipeline — top-level entry point: plan → execute.

Usage:
    from agents.pipeline import run_pipeline

    result = await run_pipeline("吹響の聖地はどこ", db_client)
"""
from __future__ import annotations

from typing import Any

import structlog

from agents.executor_agent import ExecutorAgent, PipelineResult
from agents.planner_agent import ReActPlannerAgent

logger = structlog.get_logger(__name__)


async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
) -> PipelineResult:
    """Run the full agent pipeline: plan → execute.

    Args:
        text: User input text.
        db: SupabaseClient instance.
        model: Optional LLM model override.
        locale: Response language hint ("ja", "zh", "en").

    Returns:
        PipelineResult with all step results and final output.
    """
    plan = await ReActPlannerAgent(model).create_plan(text, locale=locale)
    logger.info(
        "plan_created",
        steps=[s.tool.value for s in plan.steps],
        reasoning=plan.reasoning[:120],
    )

    result = await ExecutorAgent(db).execute(plan)
    logger.info(
        "pipeline_complete",
        intent=result.intent,
        success=result.success,
        steps_executed=len(result.step_results),
    )
    return result
```

- [ ] **Step 8.4: Run tests to confirm pass**
```bash
pytest tests/unit/test_pipeline.py -v
# Expected: all pass
```

- [ ] **Step 8.5: Commit**
```bash
git add agents/pipeline.py tests/unit/test_pipeline.py
git commit -m "refactor(pipeline): simplify to create_plan → execute, drop classify_intent step"
```

---

## Task 9: Delete `agents/intent_agent.py` and Fix All Imports

**Files:**
- Delete: `agents/intent_agent.py`
- Delete: `tests/unit/test_intent_agent.py`
- Scan and fix any remaining imports

- [ ] **Step 9.1: Find all remaining references**
```bash
grep -rn "intent_agent\|IntentOutput\|ExtractedParams\|classify_intent\|BANGUMI_TITLE_MAP" \
    --include="*.py" . | grep -v "__pycache__" | grep -v ".pyc"
```

- [ ] **Step 9.2: Fix any remaining references**

If the scan finds any files still importing from `agents.intent_agent`, update them:
- `from agents.intent_agent import IntentOutput` → delete the import (no longer needed)
- Any test that still constructs `IntentOutput(...)` → rewrite to use `RetrievalRequest` or `PlanStep`

- [ ] **Step 9.3: Delete the files**
```bash
git rm agents/intent_agent.py tests/unit/test_intent_agent.py
```

- [ ] **Step 9.4: Run full test suite**
```bash
make test
# Expected: all pass, zero references to intent_agent
```

- [ ] **Step 9.5: Commit**
```bash
git commit -m "refactor: delete IntentAgent — absorbed into ReActPlannerAgent + RetrievalRequest"
```

---

## Task 10: `interfaces/public_api.py` — Add `"en"` Locale + `ui` Field

**Files:**
- Modify: `interfaces/public_api.py`
- Modify: `tests/unit/test_public_api.py`

- [ ] **Step 10.1: Write failing tests**

Add to `tests/unit/test_public_api.py`:
```python
class TestPublicAPIRequestLocaleEn:
    def test_en_locale_accepted(self):
        req = PublicAPIRequest(text="where is kyoani", locale="en")
        assert req.locale == "en"

    def test_invalid_locale_rejected(self):
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="test", locale="fr")


class TestPublicAPIResponseUIField:
    def test_response_has_ui_field(self):
        resp = PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            ui={"component": "PilgrimageGrid", "props": {}},
        )
        assert resp.ui is not None
        assert resp.ui["component"] == "PilgrimageGrid"

    def test_response_ui_optional(self):
        resp = PublicAPIResponse(success=True, status="ok", intent="search_bangumi")
        assert resp.ui is None
```

- [ ] **Step 10.2: Run test to confirm failure**
```bash
pytest tests/unit/test_public_api.py::TestPublicAPIRequestLocaleEn \
       tests/unit/test_public_api.py::TestPublicAPIResponseUIField -v
# Expected: ValidationError for "en" locale; AttributeError for ui field
```

- [ ] **Step 10.3: Update `interfaces/public_api.py`**

Change the `locale` type on `PublicAPIRequest`:
```python
# Before:
locale: Literal["ja", "zh"] = Field(default="ja", ...)
# After:
locale: Literal["ja", "zh", "en"] = Field(default="ja", ...)
```

Add `ui` field to `PublicAPIResponse`:
```python
# Add after the existing fields:
ui: dict[str, Any] | None = Field(
    default=None,
    description="Optional Generative UI descriptor: {component, props}",
)
```

In `_pipeline_result_to_public_response`, populate the `ui` field based on `intent`:
```python
_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RouteVisualization",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
    "unclear": "Clarification",
}

def _pipeline_result_to_public_response(
    result: PipelineResult, *, include_debug: bool = False
) -> PublicAPIResponse:
    # ... existing logic ...
    component = _UI_MAP.get(result.intent)
    ui = {"component": component, "props": {}} if component else None
    return PublicAPIResponse(
        # ... existing fields ...
        ui=ui,
    )
```

- [ ] **Step 10.4: Run tests to confirm pass**
```bash
pytest tests/unit/test_public_api.py -v
# Expected: all pass
```

- [ ] **Step 10.5: Run full test suite**
```bash
make test
# Expected: all pass
```

- [ ] **Step 10.6: Commit**
```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(api): add 'en' locale support and Generative UI descriptor to response"
```

---

## Task 11: Integration Check

- [ ] **Step 11.1: Run integration tests**
```bash
make test-integration
# Expected: baseline acceptance tests pass
```

- [ ] **Step 11.2: Manual smoke test (requires running service)**
```bash
make serve &
curl -s -X POST http://localhost:8080/v1/runtime \
  -H "Content-Type: application/json" \
  -d '{"text":"吹响的圣地在哪","locale":"ja"}' | python -m json.tool

# Expected response includes:
# "intent": "search_bangumi"
# "ui": {"component": "PilgrimageGrid", "props": {}}
# "message": "N件の聖地が見つかりました。"  (no LLM latency on message)

curl -s -X POST http://localhost:8080/v1/runtime \
  -H "Content-Type: application/json" \
  -d '{"text":"where is kyoani","locale":"en"}' | python -m json.tool
# Expected: "message": "Found N pilgrimage spots."
```

- [ ] **Step 11.3: Final commit**
```bash
git tag iter1-backend-complete
```

---

## Task 12: Deploy — Apply Migrations + Staging Deploy

**Goal:** Apply the two new Supabase migrations to production/staging, then trigger a Cloudflare Workers deploy via GitHub Actions. No code changes in this task — just ops.

**Pre-condition:** `make test` and `make test-integration` both pass on main.

**Why this is in Iter 1 and not Iter 2:** The backend container changes independently of the frontend. The CF Worker serves `frontend/out` as static assets; if `frontend/out` hasn't changed yet, the old frontend keeps running fine while the new backend is live. Iter 2 will update the frontend build.

### Step 12.1: Apply migrations to production Supabase

Run against the production `DATABASE_URL` (or via Supabase dashboard SQL editor):
```bash
# Apply in order — idempotent (CREATE TABLE IF NOT EXISTS)
psql "$PRODUCTION_DATABASE_URL" -f infrastructure/supabase/migrations/001_feedback_table.sql
psql "$PRODUCTION_DATABASE_URL" -f infrastructure/supabase/migrations/002_request_log.sql
```

Verify:
```bash
psql "$PRODUCTION_DATABASE_URL" -c "\dt request_log"
# → should show the table
```

### Step 12.2: Verify required secrets exist in GitHub

Go to GitHub repo → Settings → Secrets and Variables → Actions. Confirm all of these exist:

| Secret | Used by |
|---|---|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler deploy |
| `SUPABASE_DB_URL` | container env var |
| `SUPABASE_URL` | container env var |
| `SUPABASE_SERVICE_ROLE_KEY` | container env var |
| `GEMINI_API_KEY` | container env var (fallback model) |

The planner model is controlled by `DEFAULT_AGENT_MODEL` env var in `wrangler.toml`/container. If using a different model in production (e.g., Gemini), ensure `GEMINI_API_KEY` is set and `DEFAULT_AGENT_MODEL` is configured correctly.

### Step 12.3: Trigger staging deploy

```bash
# Via GitHub CLI:
gh workflow run deploy.yml -f environment=staging
gh run watch   # watch progress
```

Or via GitHub UI: Actions → Deploy to Cloudflare Containers → Run workflow → staging.

### Step 12.4: Smoke test staging

```bash
STAGING_URL="https://seichijunrei-staging.your-workers.dev"

curl -s "$STAGING_URL/healthz"
# Expected: {"status":"ok"}

curl -s -X POST "$STAGING_URL/v1/runtime" \
  -H "Content-Type: application/json" \
  -d '{"text":"吹響の聖地","locale":"ja"}' | python -m json.tool
# Expected:
#   "intent": "search_bangumi"
#   "ui": {"component": "PilgrimageGrid", ...}
#   "message": "N件の聖地が見つかりました。"
```

### Step 12.5: (When ready) Trigger production deploy

```bash
gh workflow run deploy.yml -f environment=production
gh run watch
```

---

## Iter 0: Eval Infrastructure (can start in parallel with Iter 1 planning)

> Run Iter 0 in parallel with Iter 1. It only adds new endpoints and logging — zero risk to existing code.

### Task 0.1: Request Logging to DB

**Goal:** Every `/v1/runtime` call writes `{query, plan_steps, result_status, latency_ms}` to a `request_log` table in Supabase.

**Files:**
- Create: `infrastructure/supabase/migrations/001_request_log.sql`
- Modify: `infrastructure/supabase/client.py` (add `insert_request_log`)
- Modify: `interfaces/public_api.py` (call `insert_request_log` after response)

- [ ] **Step 0.1.1: Create migration**
```sql
-- infrastructure/supabase/migrations/001_request_log.sql
CREATE TABLE IF NOT EXISTS request_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id  TEXT,
    query_text  TEXT NOT NULL,
    locale      TEXT NOT NULL DEFAULT 'ja',
    intent      TEXT,
    plan_steps  JSONB,          -- list of tool names
    status      TEXT,
    latency_ms  INTEGER,
    feedback_id UUID            -- populated later by /v1/feedback
);
```

Apply with:
```bash
# Via Supabase CLI or psql:
psql "$DATABASE_URL" -f infrastructure/supabase/migrations/001_request_log.sql
```

- [ ] **Step 0.1.2: Add `insert_request_log` to `SupabaseClient`**

```python
async def insert_request_log(
    self,
    *,
    session_id: str | None,
    query_text: str,
    locale: str,
    intent: str | None,
    plan_steps: list[str] | None,
    status: str | None,
    latency_ms: int,
) -> str:
    """Insert a request log entry. Returns the new log ID."""
    row = await self.pool.fetchrow(
        """
        INSERT INTO request_log
            (session_id, query_text, locale, intent, plan_steps, status, latency_ms)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
        RETURNING id
        """,
        session_id,
        query_text,
        locale,
        intent,
        json.dumps(plan_steps) if plan_steps else None,
        status,
        latency_ms,
    )
    return str(row["id"])
```

- [ ] **Step 0.1.3: Call `insert_request_log` in `public_api.py`**

In `RuntimeAPI.handle`, after building `response`, add (best-effort, never raise):
```python
try:
    if isinstance(self._db, SupabaseClient):
        latency_ms = int((perf_counter() - started_at) * 1000)
        plan_steps = None
        if result is not None:
            plan_steps = [s.tool.value for s in result.plan.steps]
        await self._db.insert_request_log(
            session_id=session_id,
            query_text=request.text,
            locale=request.locale,
            intent=response.intent,
            plan_steps=plan_steps,
            status=response.status,
            latency_ms=latency_ms,
        )
except Exception as exc:
    logger.warning("request_log_failed", error=str(exc))
```

- [ ] **Step 0.1.4: Commit**
```bash
git add infrastructure/supabase/migrations/ infrastructure/supabase/client.py interfaces/public_api.py
git commit -m "feat(eval): add request_log table and write-through logging on every request"
```

### Task 0.2: Eval Dataset Scaffold

- [ ] **Step 0.2.1: Create dataset file**
```bash
mkdir -p tests/eval/datasets
```

Create `tests/eval/datasets/plan_quality_v1.json`:
```json
[
  {
    "id": "bangumi-ja-01",
    "locale": "ja",
    "query": "吹響ユーフォニアムの聖地を教えて",
    "expected_steps": ["resolve_anime", "search_bangumi"],
    "expected_intent": "search_bangumi",
    "notes": "Should resolve title before searching"
  },
  {
    "id": "bangumi-zh-01",
    "locale": "zh",
    "query": "吹响的圣地在哪",
    "expected_steps": ["resolve_anime", "search_bangumi"],
    "expected_intent": "search_bangumi"
  },
  {
    "id": "bangumi-en-01",
    "locale": "en",
    "query": "where are the Hibike Euphonium filming locations",
    "expected_steps": ["resolve_anime", "search_bangumi"],
    "expected_intent": "search_bangumi"
  },
  {
    "id": "route-ja-01",
    "locale": "ja",
    "query": "吹響の聖地を京都駅から回るルートを作って",
    "expected_steps": ["resolve_anime", "search_bangumi", "plan_route"],
    "expected_intent": "plan_route"
  },
  {
    "id": "nearby-ja-01",
    "locale": "ja",
    "query": "宇治駅の近くにある聖地を教えて",
    "expected_steps": ["search_nearby"],
    "expected_intent": "search_nearby"
  },
  {
    "id": "nearby-zh-01",
    "locale": "zh",
    "query": "宇治附近有什么动漫圣地",
    "expected_steps": ["search_nearby"],
    "expected_intent": "search_nearby"
  },
  {
    "id": "qa-ja-01",
    "locale": "ja",
    "query": "聖地巡礼のマナーを教えて",
    "expected_steps": ["answer_question"],
    "expected_intent": "answer_question"
  },
  {
    "id": "unknown-anime-ja-01",
    "locale": "ja",
    "query": "進撃の巨人の聖地はどこ",
    "expected_steps": ["resolve_anime", "search_bangumi"],
    "expected_intent": "search_bangumi",
    "notes": "Not in original 17 — must resolve via API"
  }
]
```

- [ ] **Step 0.2.2: Commit**
```bash
git add tests/eval/datasets/plan_quality_v1.json
git commit -m "eval: add initial eval dataset v1 (8 cases, 3 locales)"
```
