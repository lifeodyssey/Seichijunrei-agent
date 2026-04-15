# Backend Decomposition + FastAPI Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose three god files (`public_api.py`, `supabase/client.py`, `executor_agent.py`), cut over from aiohttp to FastAPI, and retire the old HTTP adapter — all while keeping `make check` green at every commit.

**Architecture:** Extract Pydantic schemas to a shared module first (all later tasks import from there). Then decompose files in parallel: repositories from supabase client, handlers from executor, session/response logic from public_api. Finally, write the FastAPI adapter that imports from all the new modules, switch entrypoints, and remove aiohttp.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, Pydantic v2, asyncpg, structlog, existing pytest + ruff + mypy toolchain.

---

## Context

Read these files before starting any task — they are the primary inputs:

| File | Lines | Role |
|---|---|---|
| `backend/interfaces/public_api.py` | 1007 | API facade + session + response builder + models |
| `backend/interfaces/http_service.py` | 596 | aiohttp adapter (to be replaced) |
| `backend/interfaces/__init__.py` | 19 | Package exports |
| `backend/infrastructure/supabase/client.py` | 857 | All DB operations in one class |
| `backend/agents/executor_agent.py` | 645 | All tool handlers + dispatch |
| `backend/config/settings.py` | 259 | Settings with `cors_allowed_origin` |
| `backend/tests/conftest.py` | 164 | Shared test fixtures |
| `pyproject.toml` | ~ | Dependencies + scripts |
| `Makefile` | 106 | Dev commands |
| `Dockerfile` | 41 | Container CMD |

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/interfaces/schemas.py` | Create | `PublicAPIRequest`, `PublicAPIResponse`, `PublicAPIError` |
| `backend/interfaces/response_builder.py` | Create | `_pipeline_result_to_public_response`, `_application_error_response`, `_serialize_step_result`, `_UI_MAP` |
| `backend/interfaces/session_facade.py` | Create | All session load/persist/compact/memory/route logic |
| `backend/interfaces/public_api.py` | Modify | `RuntimeAPI.handle()` only — delegates to above |
| `backend/interfaces/fastapi_service.py` | Create | FastAPI app with all routes |
| `backend/interfaces/dependencies.py` | Create | FastAPI `Depends()` providers |
| `backend/interfaces/__init__.py` | Modify | Update exports |
| `backend/infrastructure/supabase/repositories/__init__.py` | Create | Re-export all repos |
| `backend/infrastructure/supabase/repositories/bangumi.py` | Create | Bangumi table ops |
| `backend/infrastructure/supabase/repositories/points.py` | Create | Points table ops |
| `backend/infrastructure/supabase/repositories/session.py` | Create | Session + conversation ops |
| `backend/infrastructure/supabase/repositories/feedback.py` | Create | Feedback + request_log ops |
| `backend/infrastructure/supabase/repositories/user_memory.py` | Create | User memory ops |
| `backend/infrastructure/supabase/repositories/routes.py` | Create | Route persistence |
| `backend/infrastructure/supabase/repositories/messages.py` | Create | Message insert/get |
| `backend/infrastructure/supabase/client.py` | Modify | Pool management + facade |
| `backend/agents/messages.py` | Create | `_MESSAGES` + `_build_message()` |
| `backend/agents/handlers/__init__.py` | Create | Handler registry |
| `backend/agents/handlers/resolve_anime.py` | Create | resolve_anime handler |
| `backend/agents/handlers/search_bangumi.py` | Create | search_bangumi handler |
| `backend/agents/handlers/search_nearby.py` | Create | search_nearby handler |
| `backend/agents/handlers/plan_route.py` | Create | plan_route + optimize_route handler |
| `backend/agents/handlers/plan_selected.py` | Create | plan_selected handler |
| `backend/agents/handlers/answer_question.py` | Create | answer_question + clarify handler |
| `backend/agents/handlers/greet_user.py` | Create | greet_user handler |
| `backend/agents/executor_agent.py` | Modify | Dispatch loop only |
| `pyproject.toml` | Modify | Add fastapi + uvicorn deps, change script |
| `Makefile` | Modify | No change needed (script name unchanged) |
| `Dockerfile` | Modify | Switch CMD to uvicorn |
| `backend/interfaces/http_service.py` | Delete | Old aiohttp adapter |

---

### Task 1: Extract Pydantic schemas to `schemas.py`

**Files:**

- Create: `backend/interfaces/schemas.py`
- Modify: `backend/interfaces/public_api.py`
- Modify: `backend/interfaces/__init__.py`
- Modify: `backend/tests/unit/test_public_api.py`

- [ ] **Step 1: Create `backend/interfaces/schemas.py`**

```python
"""Public API request/response schemas.

These Pydantic models define the stable contract between the HTTP adapter
and the runtime pipeline. Keep them in sync with the frontend TypeScript
types in ``frontend/lib/types.ts``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PublicAPIRequest(BaseModel):
    """Public request contract for runtime execution."""

    text: str = Field(default="", description="User message to process")
    session_id: str | None = Field(
        default=None,
        description="Optional session identifier for persisting conversation state",
    )
    model: str | None = Field(
        default=None,
        description="Optional override for the runtime model used by the pipeline",
    )
    locale: Literal["ja", "zh", "en"] = Field(
        default="ja",
        description="Response locale: ja (Japanese), zh (Chinese), or en (English)",
    )
    include_debug: bool = Field(
        default=False,
        description="Include plan and step-level details in the response",
    )
    selected_point_ids: list[str] | None = Field(
        default=None,
        description="Optional point IDs to route directly without planner execution.",
    )
    origin: str | None = Field(
        default=None,
        description="Optional departure location for selected-point routing.",
    )

    @model_validator(mode="after")
    def validate_request(self) -> PublicAPIRequest:
        self.text = self.text.strip()
        if self.origin is not None:
            self.origin = self.origin.strip() or None
        if self.selected_point_ids is not None:
            cleaned_ids = [
                point_id
                for point_id in (
                    str(point_id).strip() for point_id in self.selected_point_ids
                )
                if point_id
            ]
            self.selected_point_ids = cleaned_ids or None
        if not self.text and not self.selected_point_ids:
            raise ValueError(
                "text cannot be blank unless selected_point_ids is provided"
            )
        return self


class PublicAPIError(BaseModel):
    """Stable error payload for public callers."""

    code: str
    message: str
    details: dict[str, object] = Field(default_factory=dict)


class PublicAPIResponse(BaseModel):
    """Public response contract for runtime execution."""

    success: bool
    status: str
    intent: str
    session_id: str | None = None
    message: str = ""
    data: dict[str, object] = Field(default_factory=dict)
    session: dict[str, object] = Field(default_factory=dict)
    route_history: list[dict[str, object]] = Field(default_factory=list)
    errors: list[PublicAPIError] = Field(default_factory=list)
    ui: dict[str, object] | None = Field(
        default=None,
        description="Optional Generative UI descriptor: {component, props}",
    )
    debug: dict[str, object] | None = None
```

- [ ] **Step 2: Update `public_api.py` imports**

Remove the three class definitions (`PublicAPIRequest`, `PublicAPIResponse`, `PublicAPIError`) from `backend/interfaces/public_api.py` and replace with:

```python
from backend.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
)
```

Keep everything else in `public_api.py` unchanged.

- [ ] **Step 3: Update `__init__.py` to re-export from schemas**

```python
"""Interface layer - web UIs, APIs, and external interfaces."""

from backend.interfaces.public_api import (
    RuntimeAPI,
    handle_public_request,
)
from backend.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
)

__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "handle_public_request",
]
```

Note: `create_http_app` removed from exports — it will be replaced by FastAPI in Task 6.

- [ ] **Step 4: Update test imports**

In `backend/tests/unit/test_public_api.py`, the existing import already goes through `backend.interfaces.public_api` which now re-exports from `schemas`. Verify no direct `from backend.interfaces.public_api import PublicAPIRequest` breaks. If tests import the models directly, they still work because `public_api.py` re-imports them.

Run:

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make check
```

Expected: All checks pass (lint, typecheck, tests).

- [ ] **Step 5: Commit**

```bash
git add backend/interfaces/schemas.py backend/interfaces/public_api.py backend/interfaces/__init__.py
git commit -m "refactor(api): extract Pydantic schemas to interfaces/schemas.py"
```

---

### Task 2: Decompose `supabase/client.py` into repositories

**Files:**

- Create: `backend/infrastructure/supabase/repositories/__init__.py`
- Create: `backend/infrastructure/supabase/repositories/bangumi.py`
- Create: `backend/infrastructure/supabase/repositories/points.py`
- Create: `backend/infrastructure/supabase/repositories/session.py`
- Create: `backend/infrastructure/supabase/repositories/feedback.py`
- Create: `backend/infrastructure/supabase/repositories/user_memory.py`
- Create: `backend/infrastructure/supabase/repositories/routes.py`
- Create: `backend/infrastructure/supabase/repositories/messages.py`
- Modify: `backend/infrastructure/supabase/client.py`

- [ ] **Step 1: Create the repositories directory**

```bash
mkdir -p backend/infrastructure/supabase/repositories
```

- [ ] **Step 2: Create `repositories/bangumi.py`**

```python
"""Bangumi (anime title) repository."""

from __future__ import annotations

from collections.abc import Mapping

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool, Row

logger = structlog.get_logger(__name__)


class BangumiRepository:
    """Read/write operations for the bangumi table."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get(self, bangumi_id: str) -> Row | None:
        return await self._pool.fetchrow(
            "SELECT * FROM bangumi WHERE id = $1", bangumi_id
        )

    async def list(self, *, limit: int = 50) -> list[Row]:
        return await self._pool.fetch(
            "SELECT * FROM bangumi ORDER BY title LIMIT $1", limit
        )

    async def upsert(self, bangumi_id: str, **fields: object) -> None:
        from backend.infrastructure.supabase.client import (
            _BANGUMI_COLUMNS,
            _validate_columns,
        )

        _validate_columns(_BANGUMI_COLUMNS, fields)
        columns = list(fields.keys())
        values = list(fields.values())
        set_clause = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(columns))
        insert_cols = ", ".join(["id", *columns])
        placeholders = ", ".join(f"${i + 1}" for i in range(len(columns) + 1))
        sql = (
            f"INSERT INTO bangumi ({insert_cols}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {set_clause}"
        )
        await self._pool.execute(sql, bangumi_id, *values)

    async def get_by_area(
        self, area: str, *, limit: int = 20
    ) -> list[Row]:
        return await self._pool.fetch(
            "SELECT * FROM bangumi WHERE city = $1 ORDER BY title LIMIT $2",
            area,
            limit,
        )

    async def find_by_title(self, title: str) -> str | None:
        row = await self._pool.fetchrow(
            "SELECT bangumi_id FROM bangumi_titles WHERE LOWER(title) = LOWER($1)",
            title,
        )
        if row is None:
            return None
        raw = row["bangumi_id"]
        return str(raw) if raw is not None else None

    async def upsert_title(self, title: str, bangumi_id: str) -> None:
        await self._pool.execute(
            "INSERT INTO bangumi_titles (title, bangumi_id) VALUES ($1, $2) "
            "ON CONFLICT (title) DO UPDATE SET bangumi_id = $2",
            title,
            bangumi_id,
        )
```

- [ ] **Step 3: Create `repositories/points.py`**

```python
"""Points (pilgrimage locations) repository."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

import structlog

from backend.infrastructure.supabase.client import (
    AsyncPGPool,
    Row,
    _POINT_COLUMNS,
    _point_placeholder,
    _prepare_point_fields,
    _validate_columns,
    AsyncPGAcquireContext,
)

logger = structlog.get_logger(__name__)


class PointsRepository:
    """Read/write operations for the points table."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get_by_bangumi(self, bangumi_id: str) -> list[Row]:
        return await self._pool.fetch(
            "SELECT * FROM points WHERE bangumi_id = $1 ORDER BY episode, time_seconds",
            bangumi_id,
        )

    async def get_by_ids(self, point_ids: list[str]) -> list[dict[str, object]]:
        if not point_ids:
            return []
        placeholders = ", ".join(f"${i + 1}" for i in range(len(point_ids)))
        rows = await self._pool.fetch(
            f"SELECT * FROM points WHERE id IN ({placeholders})", *point_ids
        )
        return [dict(r) for r in rows]

    async def search_by_location(
        self,
        latitude: float,
        longitude: float,
        radius_m: float = 5000.0,
        *,
        limit: int = 50,
    ) -> list[Row]:
        return await self._pool.fetch(
            """
            SELECT *,
                   ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
            FROM points
            WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
            ORDER BY distance_m
            LIMIT $4
            """,
            longitude,
            latitude,
            radius_m,
            limit,
        )

    async def upsert(self, point_id: str, **fields: object) -> None:
        prepared = _prepare_point_fields(dict(fields))
        _validate_columns(_POINT_COLUMNS, prepared)
        columns = list(prepared.keys())
        values = list(prepared.values())
        placeholders = [_point_placeholder(col, i + 2) for i, col in enumerate(columns)]
        insert_cols = ", ".join(["id", *columns])
        insert_ph = ", ".join(["$1", *placeholders])
        set_clause = ", ".join(
            f"{col} = {ph}" for col, ph in zip(columns, placeholders)
        )
        sql = (
            f"INSERT INTO points ({insert_cols}) VALUES ({insert_ph}) "
            f"ON CONFLICT (id) DO UPDATE SET {set_clause}"
        )
        await self._pool.execute(sql, point_id, *values)

    async def upsert_batch(self, rows: list[dict[str, object]]) -> int:
        if not rows:
            return 0
        conn_ctx: AsyncPGAcquireContext = self._pool.acquire()
        async with conn_ctx as conn:
            async with conn.transaction():
                count = 0
                for row in rows:
                    point_id = str(row.pop("id", row.pop("point_id", "")))
                    if not point_id:
                        continue
                    prepared = _prepare_point_fields(row)
                    _validate_columns(_POINT_COLUMNS, prepared)
                    columns = list(prepared.keys())
                    values = list(prepared.values())
                    placeholders = [
                        _point_placeholder(col, i + 2) for i, col in enumerate(columns)
                    ]
                    insert_cols = ", ".join(["id", *columns])
                    insert_ph = ", ".join(["$1", *placeholders])
                    set_clause = ", ".join(
                        f"{col} = {ph}" for col, ph in zip(columns, placeholders)
                    )
                    sql = (
                        f"INSERT INTO points ({insert_cols}) VALUES ({insert_ph}) "
                        f"ON CONFLICT (id) DO UPDATE SET {set_clause}"
                    )
                    await conn.executemany(sql, [[point_id, *values]])
                    count += 1
                return count
```

- [ ] **Step 4: Create `repositories/session.py`**

```python
"""Session and conversation repository."""

from __future__ import annotations

import json

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool, Row, _require_row

logger = structlog.get_logger(__name__)


class SessionRepository:
    """Read/write operations for sessions and conversations."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get_session(self, session_id: str) -> Row | None:
        return await self._pool.fetchrow(
            "SELECT * FROM sessions WHERE id = $1", session_id
        )

    async def upsert_session(
        self,
        session_id: str,
        state: dict[str, object],
        *,
        metadata: dict[str, object] | None = None,
    ) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        meta_json = json.dumps(metadata or {}, ensure_ascii=False, default=str)
        await self._pool.execute(
            "INSERT INTO sessions (id, state, metadata) VALUES ($1, $2::jsonb, $3::jsonb) "
            "ON CONFLICT (id) DO UPDATE SET state = $2::jsonb, metadata = $3::jsonb",
            session_id,
            state_json,
            meta_json,
        )

    async def upsert_conversation(
        self, session_id: str, user_id: str, first_message: str
    ) -> None:
        await self._pool.execute(
            "INSERT INTO conversations (session_id, user_id, first_message) "
            "VALUES ($1, $2, $3) "
            "ON CONFLICT (session_id) DO NOTHING",
            session_id,
            user_id,
            first_message[:200],
        )

    async def update_conversation_title(
        self, session_id: str, title: str, *, user_id: str | None = None
    ) -> None:
        if user_id:
            await self._pool.execute(
                "UPDATE conversations SET title = $1 "
                "WHERE session_id = $2 AND user_id = $3",
                title,
                session_id,
                user_id,
            )
        else:
            await self._pool.execute(
                "UPDATE conversations SET title = $1 WHERE session_id = $2",
                title,
                session_id,
            )

    async def get_conversations(self, user_id: str) -> list[dict[str, object]]:
        rows = await self._pool.fetch(
            "SELECT session_id, title, first_message, created_at, updated_at "
            "FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
            user_id,
        )
        return [dict(r) for r in rows]

    async def get_conversation(self, session_id: str) -> dict[str, object] | None:
        row = await self._pool.fetchrow(
            "SELECT * FROM conversations WHERE session_id = $1", session_id
        )
        return dict(row) if row else None

    async def upsert_session_state(
        self, session_id: str, state: dict[str, object]
    ) -> None:
        state_json = json.dumps(state, ensure_ascii=False, default=str)
        await self._pool.execute(
            "INSERT INTO session_states (session_id, state) VALUES ($1, $2::jsonb) "
            "ON CONFLICT (session_id) DO UPDATE SET state = $2::jsonb",
            session_id,
            state_json,
        )

    async def get_session_state(self, session_id: str) -> dict[str, object] | None:
        row = await self._pool.fetchrow(
            "SELECT state FROM session_states WHERE session_id = $1", session_id
        )
        if row is None:
            return None
        raw = row["state"]
        if isinstance(raw, str):
            return json.loads(raw)
        if isinstance(raw, dict):
            return dict(raw)
        return None

    async def delete_session_state(self, session_id: str) -> None:
        await self._pool.execute(
            "DELETE FROM session_states WHERE session_id = $1", session_id
        )
```

- [ ] **Step 5: Create `repositories/feedback.py`**

```python
"""Feedback and request log repository."""

from __future__ import annotations

import json

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool

logger = structlog.get_logger(__name__)


class FeedbackRepository:
    """Read/write operations for feedback and request_log tables."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def save_feedback(
        self,
        *,
        session_id: str | None,
        query_text: str,
        intent: str | None,
        rating: str,
        comment: str | None,
    ) -> str:
        row = await self._pool.fetchrow(
            "INSERT INTO feedback (session_id, query_text, intent, rating, comment) "
            "VALUES ($1, $2, $3, $4, $5) RETURNING id",
            session_id,
            query_text,
            intent,
            rating,
            comment,
        )
        return str(row["id"]) if row else ""

    async def insert_request_log(
        self,
        *,
        session_id: str | None,
        query_text: str,
        locale: str,
        plan_steps: list[str] | None,
        intent: str,
        status: str,
        latency_ms: int,
    ) -> None:
        steps_json = json.dumps(plan_steps) if plan_steps else None
        await self._pool.execute(
            "INSERT INTO request_log "
            "(session_id, query_text, locale, plan_steps, intent, status, latency_ms) "
            "VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)",
            session_id,
            query_text,
            locale,
            steps_json,
            intent,
            status,
            latency_ms,
        )

    async def fetch_bad_feedback(self, *, limit: int = 100) -> list[dict[str, object]]:
        rows = await self._pool.fetch(
            "SELECT * FROM feedback WHERE rating = 'bad' ORDER BY created_at DESC LIMIT $1",
            limit,
        )
        return [dict(r) for r in rows]

    async def fetch_request_log_unscored(
        self, *, limit: int = 100
    ) -> list[dict[str, object]]:
        rows = await self._pool.fetch(
            "SELECT * FROM request_log WHERE plan_quality_score IS NULL "
            "ORDER BY created_at DESC LIMIT $1",
            limit,
        )
        return [dict(r) for r in rows]

    async def update_request_log_score(
        self, *, log_id: str, score: float
    ) -> None:
        await self._pool.execute(
            "UPDATE request_log SET plan_quality_score = $1 WHERE id = $2",
            score,
            log_id,
        )
```

- [ ] **Step 6: Create `repositories/user_memory.py`**

```python
"""User memory repository."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool

logger = structlog.get_logger(__name__)


class UserMemoryRepository:
    """Read/write operations for user memory."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def upsert(
        self,
        user_id: str,
        *,
        bangumi_id: object = None,
        anime_title: object = None,
    ) -> None:
        existing = await self.get(user_id)
        visited: list[dict[str, object]] = []
        if existing:
            raw = existing.get("visited_anime")
            visited = list(raw) if isinstance(raw, list) else []

        if bangumi_id is not None:
            now = datetime.now(UTC).isoformat()
            found = False
            for entry in visited:
                if isinstance(entry, dict) and entry.get("bangumi_id") == str(bangumi_id):
                    entry["last_at"] = now
                    if anime_title:
                        entry["title"] = str(anime_title)
                    found = True
                    break
            if not found:
                visited.append(
                    {
                        "bangumi_id": str(bangumi_id),
                        "title": str(anime_title) if anime_title else None,
                        "last_at": now,
                    }
                )

        memory_json = json.dumps(
            {"visited_anime": visited}, ensure_ascii=False, default=str
        )
        await self._pool.execute(
            "INSERT INTO user_memory (user_id, memory) VALUES ($1, $2::jsonb) "
            "ON CONFLICT (user_id) DO UPDATE SET memory = $2::jsonb",
            user_id,
            memory_json,
        )

    async def get(self, user_id: str) -> dict[str, object] | None:
        row = await self._pool.fetchrow(
            "SELECT memory FROM user_memory WHERE user_id = $1", user_id
        )
        if row is None:
            return None
        raw = row["memory"]
        if isinstance(raw, str):
            return json.loads(raw)
        if isinstance(raw, dict):
            return dict(raw)
        return None
```

- [ ] **Step 7: Create `repositories/routes.py`**

```python
"""Route persistence repository."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool

logger = structlog.get_logger(__name__)


class RoutesRepository:
    """Read/write operations for saved routes."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def save(
        self,
        session_id: str,
        bangumi_id: str,
        point_ids: list[str],
        route_data: dict[str, object],
        *,
        origin_station: str | None = None,
    ) -> str | None:
        def _default(o: object) -> object:
            if hasattr(o, "isoformat"):
                return str(getattr(o, "isoformat")())
            if isinstance(o, set):
                return list(o)
            return str(o)

        route_json = json.dumps(route_data, ensure_ascii=False, default=_default)
        points_json = json.dumps(point_ids, ensure_ascii=False)
        row = await self._pool.fetchrow(
            "INSERT INTO routes "
            "(session_id, bangumi_id, point_ids, route_data, origin_station) "
            "VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) RETURNING id",
            session_id,
            bangumi_id,
            points_json,
            route_json,
            origin_station,
        )
        return str(row["id"]) if row else None

    async def get_user_routes(self, user_id: str) -> list[dict[str, object]]:
        rows = await self._pool.fetch(
            "SELECT r.* FROM routes r "
            "JOIN conversations c ON r.session_id = c.session_id "
            "WHERE c.user_id = $1 ORDER BY r.created_at DESC LIMIT 20",
            user_id,
        )
        return [dict(r) for r in rows]
```

- [ ] **Step 8: Create `repositories/messages.py`**

```python
"""Conversation messages repository."""

from __future__ import annotations

import json

import structlog

from backend.infrastructure.supabase.client import AsyncPGPool

logger = structlog.get_logger(__name__)


class MessagesRepository:
    """Read/write operations for conversation_messages table."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def insert(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> None:
        meta_json = json.dumps(metadata, ensure_ascii=False, default=str) if metadata else None
        await self._pool.execute(
            "INSERT INTO conversation_messages (session_id, role, content, metadata) "
            "VALUES ($1, $2, $3, $4::jsonb)",
            session_id,
            role,
            content,
            meta_json,
        )

    async def get(self, session_id: str) -> list[dict[str, object]]:
        rows = await self._pool.fetch(
            "SELECT role, content, metadata, created_at "
            "FROM conversation_messages WHERE session_id = $1 ORDER BY created_at",
            session_id,
        )
        return [dict(r) for r in rows]
```

- [ ] **Step 9: Create `repositories/__init__.py`**

```python
"""Supabase repository layer — one module per domain aggregate."""

from backend.infrastructure.supabase.repositories.bangumi import BangumiRepository
from backend.infrastructure.supabase.repositories.feedback import FeedbackRepository
from backend.infrastructure.supabase.repositories.messages import MessagesRepository
from backend.infrastructure.supabase.repositories.points import PointsRepository
from backend.infrastructure.supabase.repositories.routes import RoutesRepository
from backend.infrastructure.supabase.repositories.session import SessionRepository
from backend.infrastructure.supabase.repositories.user_memory import (
    UserMemoryRepository,
)

__all__ = [
    "BangumiRepository",
    "FeedbackRepository",
    "MessagesRepository",
    "PointsRepository",
    "RoutesRepository",
    "SessionRepository",
    "UserMemoryRepository",
]
```

- [ ] **Step 10: Update `client.py` to delegate to repositories**

Keep `SupabaseClient` as the public-facing class but delegate all operations to repositories. Keep backward-compatible method names so callers don't break.

In `backend/infrastructure/supabase/client.py`, after the `pool` property, replace the method bodies with delegation:

```python
    # --- Repository accessors (lazy-init) ---

    @property
    def bangumi(self) -> BangumiRepository:
        if not hasattr(self, "_bangumi"):
            self._bangumi = BangumiRepository(self.pool)
        return self._bangumi

    @property
    def points(self) -> PointsRepository:
        if not hasattr(self, "_points"):
            self._points = PointsRepository(self.pool)
        return self._points

    @property
    def sessions(self) -> SessionRepository:
        if not hasattr(self, "_sessions"):
            self._sessions = SessionRepository(self.pool)
        return self._sessions

    @property
    def feedback(self) -> FeedbackRepository:
        if not hasattr(self, "_feedback"):
            self._feedback = FeedbackRepository(self.pool)
        return self._feedback

    @property
    def user_memory(self) -> UserMemoryRepository:
        if not hasattr(self, "_user_memory"):
            self._user_memory = UserMemoryRepository(self.pool)
        return self._user_memory

    @property
    def routes(self) -> RoutesRepository:
        if not hasattr(self, "_routes"):
            self._routes = RoutesRepository(self.pool)
        return self._routes

    @property
    def messages(self) -> MessagesRepository:
        if not hasattr(self, "_messages_repo"):
            self._messages_repo = MessagesRepository(self.pool)
        return self._messages_repo
```

Then replace each method body to delegate. For example:

```python
    async def get_bangumi(self, bangumi_id: str) -> Row | None:
        return await self.bangumi.get(bangumi_id)

    async def find_bangumi_by_title(self, title: str) -> str | None:
        return await self.bangumi.find_by_title(title)
```

Repeat for all methods. Keep the existing method signatures identical — only the body changes to `return await self.<repo>.<method>(...)`.

- [ ] **Step 11: Run checks**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make check
```

Expected: All checks pass.

- [ ] **Step 12: Commit**

```bash
git add backend/infrastructure/supabase/repositories/ backend/infrastructure/supabase/client.py
git commit -m "refactor(db): decompose SupabaseClient into domain repositories"
```

---

### Task 3: Decompose `executor_agent.py` into handlers

**Files:**

- Create: `backend/agents/messages.py`
- Create: `backend/agents/handlers/__init__.py`
- Create: `backend/agents/handlers/resolve_anime.py`
- Create: `backend/agents/handlers/search_bangumi.py`
- Create: `backend/agents/handlers/search_nearby.py`
- Create: `backend/agents/handlers/plan_route.py`
- Create: `backend/agents/handlers/plan_selected.py`
- Create: `backend/agents/handlers/answer_question.py`
- Create: `backend/agents/handlers/greet_user.py`
- Modify: `backend/agents/executor_agent.py`

- [ ] **Step 1: Create `backend/agents/messages.py`**

Move `_MESSAGES` dict and `_build_message()` from `executor_agent.py`:

```python
"""Static response message templates for the executor.

Keyed by (primary_tool, locale). These replace LLM message calls,
saving one LLM round-trip per request.
"""

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
    ("plan_selected", "ja"): "{count}件の選択スポットでルートを作成しました。",
    ("plan_selected", "zh"): "已为{count}处选定取景地规划路线。",
    ("plan_selected", "en"): "Created a route with {count} selected stops.",
    ("answer_question", "ja"): "",
    ("answer_question", "zh"): "",
    ("answer_question", "en"): "",
    ("empty", "ja"): "該当する巡礼地が見つかりませんでした。",
    ("empty", "zh"): "没有找到相关的巡礼地。",
    ("empty", "en"): "No pilgrimage spots found.",
    ("unclear", "ja"): "もう少し具体的に教えていただけますか？",
    ("unclear", "zh"): "能再具体一些吗？",
    ("unclear", "en"): "Could you be more specific?",
    ("clarify", "ja"): "",
    ("clarify", "zh"): "",
    ("clarify", "en"): "",
}


def build_message(primary_tool: str, count: int, locale: str) -> str:
    """Build a static response message from template."""
    if count == 0:
        return _MESSAGES.get(("empty", locale), "")
    return _MESSAGES.get((primary_tool, locale), "").format(count=count)
```

- [ ] **Step 2: Create handler files**

Each handler is a standalone async function. Create `backend/agents/handlers/` directory:

```bash
mkdir -p backend/agents/handlers
```

**`handlers/resolve_anime.py`:**

```python
"""Handler: resolve anime title → bangumi_id."""

from __future__ import annotations

from typing import cast

import structlog

from backend.agents.models import PlanStep
from backend.agents.executor_agent import StepResult
from backend.infrastructure.gateways.bangumi import BangumiClientGateway
from backend.infrastructure.supabase.client import SupabaseClient

logger = structlog.get_logger(__name__)


async def execute(
    step: PlanStep, context: dict[str, object], *, db: object
) -> StepResult:
    """Resolve anime title → bangumi_id. DB first, API on miss (write-through)."""
    params = step.params or {}
    title = params.get("title")
    if not isinstance(title, str):
        title = ""
    if not title:
        return StepResult(tool="resolve_anime", success=False, error="No title provided")

    client = cast(SupabaseClient, db)
    bangumi_id = await client.find_bangumi_by_title(title)
    if bangumi_id:
        logger.info("resolve_anime_db_hit", title=title, bangumi_id=bangumi_id)
        return StepResult(
            tool="resolve_anime",
            success=True,
            data={"bangumi_id": bangumi_id, "title": title},
        )

    gateway = BangumiClientGateway()
    bangumi_id = await gateway.search_by_title(title)
    if bangumi_id:
        await client.upsert_bangumi_title(title, bangumi_id)
        logger.info("resolve_anime_api_hit", title=title, bangumi_id=bangumi_id)
        return StepResult(
            tool="resolve_anime",
            success=True,
            data={"bangumi_id": bangumi_id, "title": title},
        )

    return StepResult(
        tool="resolve_anime",
        success=False,
        error=f"Could not resolve anime: '{title}'",
    )
```

Create similar files for the other 6 handlers. Each follows the same pattern — extract the method body from `executor_agent.py`, change `self._db` to a `db` parameter and `self._retriever` to a `retriever` parameter where needed.

I won't repeat the full code for all 6 — the pattern is identical. The key signatures are:

- `search_bangumi.execute(step, context, *, retriever)`
- `search_nearby.execute(step, context, *, retriever)`
- `plan_route.execute(step, context, *, db, retriever)` (includes `_optimize_route`)
- `plan_selected.execute(step, context, *, db)`
- `answer_question.execute(step, context)` (also handles `clarify`)
- `greet_user.execute(step, context)`

- [ ] **Step 3: Create `handlers/__init__.py`**

```python
"""Tool handler registry for the ExecutorAgent."""

from backend.agents.handlers import (
    answer_question,
    greet_user,
    plan_route,
    plan_selected,
    resolve_anime,
    search_bangumi,
    search_nearby,
)
from backend.agents.models import ToolName

HANDLER_REGISTRY: dict[ToolName, object] = {
    ToolName.RESOLVE_ANIME: resolve_anime,
    ToolName.SEARCH_BANGUMI: search_bangumi,
    ToolName.SEARCH_NEARBY: search_nearby,
    ToolName.PLAN_ROUTE: plan_route,
    ToolName.PLAN_SELECTED: plan_selected,
    ToolName.ANSWER_QUESTION: answer_question,
    ToolName.CLARIFY: answer_question,
    ToolName.GREET_USER: greet_user,
}
```

- [ ] **Step 4: Slim down `executor_agent.py`**

Remove all `_execute_*` methods and `_MESSAGES`. The `_execute_step` method now looks up the handler from `HANDLER_REGISTRY` and calls `handler.execute(step, context, db=self._db, retriever=self._retriever)`:

```python
    async def _execute_step(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        tool: ToolName | None = getattr(step, "tool", None)
        tool_name = (
            tool.value if tool is not None
            else str(getattr(step, "step_type", "unknown"))
        )
        if not isinstance(tool, ToolName):
            return StepResult(
                tool=tool_name, success=False, error=f"No handler for tool: {tool_name}"
            )

        handler = HANDLER_REGISTRY.get(tool)
        if handler is None:
            return StepResult(
                tool=tool_name, success=False, error=f"No handler for tool: {tool_name}"
            )

        try:
            return await handler.execute(
                step, context, db=self._db, retriever=self._retriever
            )
        except TypeError:
            # Handlers that don't need db/retriever (greet_user, answer_question)
            return await handler.execute(step, context)
        except Exception as exc:
            logger.error("step_execution_error", tool=tool_name, error=str(exc))
            return StepResult(tool=tool_name, success=False, error=str(exc))
```

Also move `_build_output`, `_infer_primary_tool`, `_rewrite_image_urls`, `_build_query_payload` to stay in `executor_agent.py` (they're tightly coupled to the output-building logic).

- [ ] **Step 5: Run checks**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make check
```

Expected: All checks pass.

- [ ] **Step 6: Commit**

```bash
git add backend/agents/messages.py backend/agents/handlers/ backend/agents/executor_agent.py
git commit -m "refactor(agents): decompose executor into per-tool handler modules"
```

---

### Task 4: Decompose `public_api.py` into response_builder + session_facade

**Files:**

- Create: `backend/interfaces/response_builder.py`
- Create: `backend/interfaces/session_facade.py`
- Modify: `backend/interfaces/public_api.py`

- [ ] **Step 1: Create `backend/interfaces/response_builder.py`**

Move these functions from `public_api.py`:

- `_UI_MAP`
- `_pipeline_result_to_public_response()`
- `_application_error_response()`
- `_serialize_step_result()`
- `_extract_plan_steps()`
- `_build_selected_points_plan()`

```python
"""Convert pipeline results into public API response objects."""

from __future__ import annotations

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.application.errors import ApplicationError
from backend.interfaces.schemas import PublicAPIError, PublicAPIRequest, PublicAPIResponse

_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RoutePlannerWizard",
    "plan_selected": "RoutePlannerWizard",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
    "greet_user": "GeneralAnswer",
    "unclear": "Clarification",
    "clarify": "Clarification",
}


def pipeline_result_to_response(
    result: PipelineResult,
    *,
    include_debug: bool,
) -> PublicAPIResponse:
    final_output = result.final_output or {}
    raw_errors = final_output.get("errors", [])
    error_list = raw_errors if isinstance(raw_errors, list) else []
    errors = [
        PublicAPIError(
            code="pipeline_error",
            message="A processing step failed." if not include_debug else str(error),
        )
        for error in error_list
    ]
    component = _UI_MAP.get(result.intent)
    ui = {"component": component, "props": {}} if component else None
    response = PublicAPIResponse(
        success=bool(final_output.get("success", result.success)),
        status=str(final_output.get("status", "ok" if result.success else "error")),
        intent=result.intent,
        message=str(final_output.get("message") or ""),
        data={
            k: final_output[k]
            for k in ("results", "route")
            if final_output.get(k) is not None
        },
        errors=errors,
        ui=ui,
    )

    if include_debug:
        response.debug = {
            "plan": {
                "intent": result.intent,
                "reasoning": result.plan.reasoning,
                "steps": [step.tool.value for step in result.plan.steps],
            },
            "step_results": [serialize_step_result(step) for step in result.step_results],
        }

    return response


def application_error_response(exc: ApplicationError) -> PublicAPIResponse:
    return PublicAPIResponse(
        success=False,
        status="error",
        intent="unknown",
        message=exc.message,
        errors=[
            PublicAPIError(
                code=exc.error_code.value,
                message=exc.message,
                details=exc.details,
            )
        ],
    )


def serialize_step_result(step: StepResult) -> dict[str, object]:
    return {
        "tool": step.tool,
        "success": step.success,
        "error": step.error,
        "data": step.data,
    }


def extract_plan_steps(result: PipelineResult | None) -> list[str] | None:
    if result is None:
        return None
    steps: list[str] = []
    for step in getattr(result.plan, "steps", []) or []:
        tool = getattr(step, "tool", None)
        if tool is not None:
            steps.append(getattr(tool, "value", str(tool)))
            continue
        step_type = getattr(step, "step_type", None)
        if step_type is not None:
            steps.append(getattr(step_type, "value", str(step_type)))
            continue
        steps.append(str(step))
    return steps


def build_selected_points_plan(request: PublicAPIRequest) -> ExecutionPlan:
    point_ids = list(request.selected_point_ids or [])
    return ExecutionPlan(
        steps=[
            PlanStep(
                tool=ToolName.PLAN_SELECTED,
                params={"point_ids": point_ids, "origin": request.origin},
            )
        ],
        reasoning="User selected specific points for routing.",
        locale=request.locale,
    )
```

- [ ] **Step 2: Create `backend/interfaces/session_facade.py`**

Move all session-related functions and methods from `public_api.py`:

```python
"""Session state management facade.

Encapsulates session load/persist/compact logic that was previously
inlined in RuntimeAPI.handle().
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import structlog

from backend.agents.base import create_agent, get_default_model
from backend.agents.executor_agent import PipelineResult
from backend.infrastructure.session import SessionStore
from backend.interfaces.schemas import PublicAPIRequest, PublicAPIResponse

logger = structlog.get_logger(__name__)

_COMPACT_THRESHOLD = 8
_COMPACT_KEEP_RECENT = 2
_MAX_INTERACTIONS = 20
_MAX_ROUTE_HISTORY = 10


def normalize_session_state(state: dict[str, object] | None) -> dict[str, object]:
    base: dict[str, object] = {
        "interactions": [],
        "route_history": [],
        "last_intent": None,
        "last_status": None,
        "last_message": "",
        "summary": None,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if state is None:
        return base
    normalized = dict(base)
    normalized.update(state)
    raw_interactions = normalized.get("interactions")
    normalized["interactions"] = (
        list(raw_interactions) if isinstance(raw_interactions, list) else []
    )
    raw_route_history = normalized.get("route_history")
    normalized["route_history"] = (
        list(raw_route_history) if isinstance(raw_route_history, list) else []
    )
    normalized["summary"] = _as_str_or_none(normalized.get("summary"))
    return normalized


def build_updated_session_state(
    previous_state: dict[str, object],
    *,
    request: PublicAPIRequest,
    response: PublicAPIResponse,
    context_delta: dict[str, object] | None = None,
) -> dict[str, object]:
    raw = previous_state["interactions"]
    interactions = list(raw) if isinstance(raw, list) else []
    interactions.append(
        {
            "text": request.text,
            "intent": response.intent,
            "status": response.status,
            "success": response.success,
            "created_at": datetime.now(UTC).isoformat(),
            "context_delta": context_delta or {},
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


def build_session_summary(state: dict[str, object]) -> dict[str, object]:
    raw_interactions = state.get("interactions")
    raw_route_history = state.get("route_history")
    return {
        "interaction_count": len(raw_interactions)
        if isinstance(raw_interactions, list)
        else 0,
        "route_history_count": len(raw_route_history)
        if isinstance(raw_route_history, list)
        else 0,
        "last_intent": state.get("last_intent"),
        "last_status": state.get("last_status"),
        "last_message": state.get("last_message", ""),
    }


def build_context_block(
    session_state: dict[str, object],
    user_memory: dict[str, object] | None = None,
) -> dict[str, object] | None:
    raw_interactions = session_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    summary = _as_str_or_none(session_state.get("summary"))
    current_bangumi_id: str | None = None
    current_anime_title: str | None = None
    last_location: str | None = None
    visited_bangumi_ids: list[str] = []

    for interaction in reversed(interactions):
        if not isinstance(interaction, dict):
            continue
        raw_delta = interaction.get("context_delta")
        delta = raw_delta if isinstance(raw_delta, dict) else {}
        bangumi_id = _as_str_or_none(delta.get("bangumi_id"))
        anime_title = _as_str_or_none(delta.get("anime_title"))
        location = _as_str_or_none(delta.get("location"))
        if current_bangumi_id is None and bangumi_id:
            current_bangumi_id = bangumi_id
            current_anime_title = anime_title
        if last_location is None and location:
            last_location = location
        if bangumi_id and bangumi_id not in visited_bangumi_ids:
            visited_bangumi_ids.append(bangumi_id)
        if current_bangumi_id and last_location:
            break

    if user_memory:
        raw_visited = user_memory.get("visited_anime")
        visited_anime = raw_visited if isinstance(raw_visited, list) else []
        for entry in visited_anime:
            if not isinstance(entry, dict):
                continue
            bangumi_id = _as_str_or_none(entry.get("bangumi_id"))
            if bangumi_id and bangumi_id not in visited_bangumi_ids:
                visited_bangumi_ids.append(bangumi_id)
        if current_bangumi_id is None and visited_anime:
            most_recent = max(
                visited_anime,
                key=lambda e: e.get("last_at", "") if isinstance(e, dict) else "",
                default=None,
            )
            if isinstance(most_recent, dict):
                current_bangumi_id = _as_str_or_none(most_recent.get("bangumi_id"))
                current_anime_title = _as_str_or_none(most_recent.get("title"))

    if (
        not current_bangumi_id
        and not last_location
        and not visited_bangumi_ids
        and not summary
    ):
        return None

    return {
        "summary": summary,
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }


def extract_context_delta(result: PipelineResult) -> dict[str, object]:
    bangumi_id: str | None = None
    anime_title: str | None = None
    location: str | None = None

    for step_result in result.step_results:
        if step_result.tool != "resolve_anime" or not step_result.success:
            continue
        data = step_result.data if isinstance(step_result.data, dict) else {}
        bangumi_id = _as_str_or_none(data.get("bangumi_id"))
        anime_title = _as_str_or_none(data.get("title") or data.get("anime_title"))
        break

    for plan_step, step_result in zip(
        result.plan.steps, result.step_results, strict=False
    ):
        if not step_result.success:
            continue
        if step_result.tool == "search_nearby" and location is None:
            location = _as_str_or_none(plan_step.params.get("location"))
        if step_result.tool != "search_bangumi" or bangumi_id is not None:
            continue
        data = step_result.data if isinstance(step_result.data, dict) else {}
        rows = data.get("rows")
        if isinstance(rows, list) and rows:
            first_row = rows[0] if isinstance(rows[0], dict) else {}
            bangumi_id = _as_str_or_none(first_row.get("bangumi_id"))
            anime_title = _as_str_or_none(
                first_row.get("title") or first_row.get("title_cn")
            )
        if bangumi_id is None:
            bangumi_id = _as_str_or_none(
                plan_step.params.get("bangumi_id") or plan_step.params.get("bangumi")
            )

    context_delta: dict[str, object] = {}
    if bangumi_id is not None:
        context_delta["bangumi_id"] = bangumi_id
    if anime_title is not None:
        context_delta["anime_title"] = anime_title
    if location is not None:
        context_delta["location"] = location
    return context_delta


async def generate_and_save_title(
    *,
    session_id: str,
    first_query: str,
    response_message: str,
    db: object,
    user_id: str | None = None,
) -> None:
    title = first_query.strip()[:20] or first_query[:20]
    try:
        agent = create_agent(
            get_default_model(),
            system_prompt=(
                "Generate a very short conversation title (<=15 characters) in the "
                "same language as the query. Output only the title."
            ),
            retries=1,
        )
        result = await agent.run(
            f"Query: {first_query}\nResponse summary: {response_message[:200]}"
        )
        candidate = str(result.output).strip()[:20]
        if candidate:
            title = candidate
    except Exception:
        logger.warning("conversation_title_generation_failed", session_id=session_id)

    update_conversation_title = getattr(db, "update_conversation_title", None)
    if update_conversation_title is None:
        return
    try:
        await update_conversation_title(session_id, title, user_id=user_id)
    except TypeError:
        await update_conversation_title(session_id, title)
    except Exception:
        logger.warning("update_conversation_title_failed", session_id=session_id)


async def compact_session_interactions(
    session_id: str,
    session_state: dict[str, object],
    session_store: SessionStore,
) -> None:
    latest_state = await session_store.get(session_id)
    current_state = normalize_session_state(
        latest_state if latest_state is not None else session_state
    )
    raw_interactions = current_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    if len(interactions) < _COMPACT_THRESHOLD:
        return

    previous_summary = _as_str_or_none(current_state.get("summary"))
    compacted = interactions[:-_COMPACT_KEEP_RECENT]
    recent = interactions[-_COMPACT_KEEP_RECENT:]
    if not compacted:
        return

    prompt_lines: list[str] = []
    if previous_summary:
        prompt_lines.append(f"Existing summary: {previous_summary}")
    prompt_lines.append("Merge these interaction notes into a concise session summary:")
    for entry in compacted:
        if isinstance(entry, dict):
            intent = entry.get("intent") or "unknown"
            text = str(entry.get("text") or "").strip()[:120]
        else:
            intent = "unknown"
            text = str(entry).strip()[:120]
        prompt_lines.append(f"- [{intent}] {text}")

    agent = create_agent(
        get_default_model(),
        system_prompt=(
            "Summarize the session in 1-2 sentences. Capture what the user was "
            "researching and keep the same language as the interaction text."
        ),
        retries=1,
    )
    try:
        result = await agent.run("\n".join(prompt_lines))
    except Exception:
        logger.warning("compact_llm_failed", session_id=session_id)
        return

    summary = _as_str_or_none(getattr(result, "output", None))
    if summary is None:
        return

    updated_state = {
        **current_state,
        "interactions": recent,
        "summary": summary[:300],
        "updated_at": datetime.now(UTC).isoformat(),
    }
    try:
        await session_store.set(session_id, updated_state)
    except Exception:
        logger.warning("compact_write_failed", session_id=session_id)
        return

    logger.info(
        "compact_complete",
        session_id=session_id,
        summary_length=len(str(updated_state["summary"])),
    )


def _as_str_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
```

- [ ] **Step 3: Slim down `public_api.py`**

Replace all the extracted functions with imports from `response_builder` and `session_facade`. The `RuntimeAPI.handle()` method stays but calls the new modules. The file should drop from ~1007 lines to ~250 lines.

Update imports at top of `public_api.py`:

```python
from backend.interfaces.response_builder import (
    application_error_response,
    build_selected_points_plan,
    extract_plan_steps,
    pipeline_result_to_response,
)
from backend.interfaces.session_facade import (
    build_context_block,
    build_session_summary,
    build_updated_session_state,
    compact_session_interactions,
    extract_context_delta,
    generate_and_save_title,
    normalize_session_state,
)
```

Then replace all `_function_name(...)` calls with the imported `function_name(...)` (drop the leading underscore since they're now public module functions).

- [ ] **Step 4: Update test imports**

`test_public_api.py` imports `_build_context_block` — update to:

```python
from backend.interfaces.session_facade import build_context_block
```

- [ ] **Step 5: Run checks**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make check
```

Expected: All checks pass.

- [ ] **Step 6: Commit**

```bash
git add backend/interfaces/response_builder.py backend/interfaces/session_facade.py backend/interfaces/public_api.py backend/tests/unit/test_public_api.py
git commit -m "refactor(api): decompose public_api into response_builder + session_facade"
```

---

### Task 5: Create FastAPI adapter

**Files:**

- Create: `backend/interfaces/fastapi_service.py`
- Create: `backend/interfaces/dependencies.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Add FastAPI + uvicorn to dependencies**

In `pyproject.toml`, add to `dependencies`:

```toml
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
```

Run:

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && uv sync --extra dev
```

- [ ] **Step 2: Create `backend/interfaces/dependencies.py`**

```python
"""FastAPI dependency injection providers."""

from __future__ import annotations

from functools import lru_cache
from typing import cast

from backend.config.settings import Settings, get_settings
from backend.infrastructure.session import SessionStore, create_session_store
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import RuntimeAPI

_runtime_api: RuntimeAPI | None = None
_db: SupabaseClient | None = None


def get_db() -> SupabaseClient:
    if _db is None:
        raise RuntimeError("Database not initialized. Call lifespan() first.")
    return _db


def get_runtime_api() -> RuntimeAPI:
    if _runtime_api is None:
        raise RuntimeError("RuntimeAPI not initialized. Call lifespan() first.")
    return _runtime_api


async def startup(settings: Settings | None = None) -> None:
    global _runtime_api, _db
    resolved = settings or get_settings()
    dsn = resolved.supabase_db_url.strip()
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL is required.")
    _db = SupabaseClient(dsn)
    await _db.connect()
    session_store = create_session_store(db=_db)
    _runtime_api = RuntimeAPI(_db, session_store=session_store)


async def shutdown() -> None:
    global _runtime_api, _db
    if _db is not None:
        await _db.close()
    _runtime_api = None
    _db = None
```

- [ ] **Step 3: Create `backend/interfaces/fastapi_service.py`**

```python
"""FastAPI runtime service — replaces the aiohttp adapter."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import structlog
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from backend.config.settings import Settings, get_settings
from backend.infrastructure.observability import setup_observability, shutdown_observability
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.dependencies import (
    get_db,
    get_runtime_api,
    shutdown,
    startup,
)
from backend.interfaces.public_api import RuntimeAPI
from backend.interfaces.schemas import PublicAPIRequest, PublicAPIResponse

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.observability_enabled:
        setup_observability(settings)
    await startup(settings)
    try:
        yield
    finally:
        await shutdown()
        if settings.observability_enabled:
            shutdown_observability()


app = FastAPI(
    title="Seichijunrei Runtime",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_allowed_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-User-Id", "X-User-Type"],
)


# --- Error handlers ---

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "invalid_request",
                "message": "Request payload did not match the public API schema.",
                "details": exc.errors(),
            }
        },
    )


# --- Routes ---

@app.get("/")
async def root() -> dict[str, object]:
    s = get_settings()
    return {
        "service": "seichijunrei-runtime",
        "status": "ok",
        "app_env": s.app_env,
        "endpoints": {"healthz": "/healthz", "runtime": "/v1/runtime", "feedback": "/v1/feedback"},
    }


@app.get("/healthz")
async def healthz(
    runtime_api: Annotated[RuntimeAPI, Depends(get_runtime_api)],
) -> dict[str, object]:
    s = get_settings()
    return {
        "status": "ok",
        "service": "seichijunrei-runtime",
        "app_env": s.app_env,
        "observability_enabled": s.observability_enabled,
        "db_adapter": type(getattr(runtime_api, "_db", None)).__name__,
        "session_store": type(getattr(runtime_api, "_session_store", None)).__name__,
    }


@app.post("/v1/runtime")
async def runtime(
    body: PublicAPIRequest,
    runtime_api: Annotated[RuntimeAPI, Depends(get_runtime_api)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> JSONResponse:
    response = await runtime_api.handle(body, user_id=x_user_id)
    status = _http_status(response)
    return JSONResponse(content=response.model_dump(mode="json"), status_code=status)


@app.post("/v1/runtime/stream")
async def runtime_stream(
    body: PublicAPIRequest,
    runtime_api: Annotated[RuntimeAPI, Depends(get_runtime_api)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> StreamingResponse:
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def on_step(
        tool: str,
        status: str,
        data: dict[str, object],
        thought: str = "",
        observation: str = "",
    ) -> None:
        payload = json.dumps(
            {"event": "step", "tool": tool, "status": status, "thought": thought, "observation": observation, "data": data},
            ensure_ascii=False,
        )
        await queue.put(f"event: step\ndata: {payload}\n\n")

    async def run_pipeline() -> None:
        try:
            await queue.put(f"event: planning\ndata: {json.dumps({'event': 'planning', 'status': 'running'})}\n\n")
            response = await runtime_api.handle(body, user_id=x_user_id, on_step=on_step)
            done_payload = json.dumps({"event": "done", **response.model_dump(mode="json")}, ensure_ascii=False)
            await queue.put(f"event: done\ndata: {done_payload}\n\n")
        except Exception as exc:
            logger.exception("sse_pipeline_error", error=str(exc))
            err = json.dumps({"event": "error", "code": "internal_error", "message": "Something went wrong."})
            await queue.put(f"event: error\ndata: {err}\n\n")
        finally:
            await queue.put(None)

    async def event_generator() -> AsyncIterator[str]:
        task = asyncio.create_task(run_pipeline())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/v1/conversations")
async def get_conversations(
    db: Annotated[SupabaseClient, Depends(get_db)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> JSONResponse:
    if not x_user_id:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "missing_user_id", "message": "X-User-Id header required."}},
        )
    conversations = await db.get_conversations(x_user_id)
    return JSONResponse(content=conversations)


@app.patch("/v1/conversations/{session_id}")
async def patch_conversation(
    session_id: str,
    request: Request,
    db: Annotated[SupabaseClient, Depends(get_db)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> JSONResponse:
    if not x_user_id:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "missing_user_id", "message": "X-User-Id header required."}},
        )
    payload = await request.json()
    title = str(payload.get("title", "")).strip()
    if not title:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": "title must be a non-empty string."}},
        )
    await db.update_conversation_title(session_id, title, user_id=x_user_id)
    return JSONResponse(content={"ok": True})


@app.get("/v1/conversations/{session_id}/messages")
async def get_messages(
    session_id: str,
    db: Annotated[SupabaseClient, Depends(get_db)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> JSONResponse:
    if not x_user_id:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "missing_user_id", "message": "X-User-Id header required."}},
        )
    conv = await db.get_conversation(session_id)
    if not conv or conv.get("user_id") != x_user_id:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    messages = await db.get_messages(session_id)
    return JSONResponse(content={"messages": messages})


@app.get("/v1/routes")
async def get_routes(
    db: Annotated[SupabaseClient, Depends(get_db)],
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> JSONResponse:
    if not x_user_id:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "missing_user_id", "message": "X-User-Id header required."}},
        )
    routes = await db.get_user_routes(x_user_id)
    return JSONResponse(content={"routes": routes})


@app.post("/v1/feedback")
async def post_feedback(
    request: Request,
    db: Annotated[SupabaseClient, Depends(get_db)],
) -> JSONResponse:
    body = await request.json()
    rating = body.get("rating")
    if rating not in ("good", "bad"):
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": "rating must be 'good' or 'bad'."}},
        )
    query_text = body.get("query_text", "")
    if not query_text:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": "query_text is required."}},
        )
    feedback_id = await db.save_feedback(
        session_id=body.get("session_id"),
        query_text=query_text,
        intent=body.get("intent"),
        rating=rating,
        comment=body.get("comment"),
    )
    return JSONResponse(content={"feedback_id": feedback_id})


def _http_status(response: PublicAPIResponse) -> int:
    if response.success:
        return 200
    codes = {error.code for error in response.errors}
    if codes & {"invalid_input", "missing_required_field", "invalid_format"}:
        return 400
    if codes & {"authentication_error", "invalid_credentials"}:
        return 401
    if codes & {"not_found"}:
        return 404
    if codes & {"rate_limited"}:
        return 429
    return 500


def main() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "backend.interfaces.fastapi_service:app",
        host=s.service_host,
        port=s.service_port,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run checks**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && uv run python -c "from backend.interfaces.fastapi_service import app; print('fastapi OK')"
```

Expected: `fastapi OK`

- [ ] **Step 5: Commit**

```bash
git add backend/interfaces/fastapi_service.py backend/interfaces/dependencies.py pyproject.toml
git commit -m "feat(api): add FastAPI runtime adapter with all endpoints"
```

---

### Task 6: Switch entrypoints and remove aiohttp adapter

**Files:**

- Modify: `pyproject.toml`
- Modify: `Dockerfile`
- Modify: `backend/interfaces/__init__.py`
- Delete: `backend/interfaces/http_service.py`
- Modify: `.github/workflows/ci.yml` (if exists)

- [ ] **Step 1: Switch pyproject.toml script**

```toml
[project.scripts]
seichijunrei-api = "backend.interfaces.fastapi_service:main"
```

- [ ] **Step 2: Switch Dockerfile CMD**

```dockerfile
CMD ["uvicorn", "backend.interfaces.fastapi_service:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3: Update `__init__.py`**

```python
"""Interface layer - FastAPI service, public API facade, schemas."""

from backend.interfaces.fastapi_service import app, main
from backend.interfaces.public_api import RuntimeAPI, handle_public_request
from backend.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
)

__all__ = [
    "app",
    "main",
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "handle_public_request",
]
```

- [ ] **Step 4: Delete `http_service.py`**

```bash
git rm backend/interfaces/http_service.py
```

- [ ] **Step 5: Update CI import check (if applicable)**

In `.github/workflows/ci.yml`, replace:
```bash
uv run python -c "from backend.interfaces.http_service import create_http_app; print('http OK')"
```
with:
```bash
uv run python -c "from backend.interfaces.fastapi_service import app; print('fastapi OK')"
```

- [ ] **Step 6: Update aiohttp test references**

Delete or rename `backend/tests/unit/test_http_service.py` → the new FastAPI tests will be in Plan C (test suite).

- [ ] **Step 7: Verify**

```bash
cd /Users/lumimamini/Documents/Seichijunrei-agent && make serve
```

Expected: Server starts on 0.0.0.0:8080 via uvicorn. Ctrl+C to stop.

```bash
make check
```

Expected: All checks pass (excluding deleted http_service tests).

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml Dockerfile backend/interfaces/__init__.py
git rm backend/interfaces/http_service.py
git commit -m "refactor(api): switch entrypoints from aiohttp to FastAPI, retire http_service"
```
