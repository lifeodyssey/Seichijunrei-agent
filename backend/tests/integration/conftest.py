"""Integration test fixtures — real PostgreSQL plus runtime API helpers."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.config.settings import Settings
from backend.infrastructure.session import create_session_store
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.fastapi_service import create_fastapi_app
from backend.interfaces.public_api import RuntimeAPI

pytest_plugins = ("backend.tests.conftest_db",)


@pytest.fixture
async def tc_db(pg_container: PostgresContainer) -> AsyncIterator[SupabaseClient]:
    """A real SupabaseClient connected to the testcontainer PostgreSQL."""
    dsn = pg_container.get_connection_url()
    # Convert psycopg2 DSN to asyncpg format
    dsn = dsn.replace("+psycopg2", "").replace("psycopg2", "")
    client = SupabaseClient(dsn, min_pool_size=1, max_pool_size=5)
    await client.connect()
    yield client
    await client.close()


def _make_plan(tool: ToolName, *, locale: str) -> ExecutionPlan:
    return ExecutionPlan(
        steps=[PlanStep(tool=tool, params={})],
        reasoning="integration contract fixture",
        locale=locale,
    )


def _clarify_payload() -> dict[str, object]:
    return {
        "success": True,
        "status": "needs_clarification",
        "message": "你是指哪部凉宫？",
        "question": "你是指哪部凉宫？",
        "options": ["凉宫春日的忧郁", "凉宫春日的消失"],
        "candidates": [
            {
                "title": "凉宫春日的忧郁",
                "cover_url": None,
                "spot_count": 2,
                "city": "西宫",
            },
            {
                "title": "凉宫春日的消失",
                "cover_url": None,
                "spot_count": 1,
                "city": "西宫",
            },
        ],
    }


def _nearby_payload() -> dict[str, object]:
    return {
        "success": True,
        "status": "ok",
        "message": "宇治站附近有 2 处相关圣地。",
        "results": {
            "rows": [
                {
                    "id": "pt-uji-1",
                    "name": "宇治桥",
                    "title": "響け！ユーフォニアム",
                    "bangumi_id": "120632",
                    "distance_m": 280.0,
                    "latitude": 34.889,
                    "longitude": 135.807,
                    "cover_url": "https://example.com/eupho.jpg",
                },
                {
                    "id": "pt-uji-2",
                    "name": "京阪宇治站",
                    "title": "響け！ユーフォニアム",
                    "bangumi_id": "120632",
                    "distance_m": 460.0,
                    "latitude": 34.891,
                    "longitude": 135.81,
                    "cover_url": "https://example.com/eupho.jpg",
                },
            ],
            "row_count": 2,
            "metadata": {
                "source": "geo",
                "anchor": "宇治站",
                "radius_m": 5000,
            },
            "nearby_groups": [
                {
                    "bangumi_id": "120632",
                    "title": "響け！ユーフォニアム",
                    "cover_url": "https://example.com/eupho.jpg",
                    "points_count": 2,
                    "closest_distance_m": 280.0,
                }
            ],
        },
    }


def _route_payload() -> dict[str, object]:
    return {
        "success": True,
        "status": "ok",
        "message": "已为你规划好 2 个巡礼点的路线。",
        "route": {
            "ordered_points": [
                {
                    "id": "pt-uji-1",
                    "name": "宇治桥",
                    "cover_url": "https://example.com/eupho.jpg",
                },
                {
                    "id": "pt-uji-2",
                    "name": "京阪宇治站",
                    "cover_url": "https://example.com/eupho.jpg",
                },
            ],
            "point_count": 2,
            "cover_url": "https://example.com/eupho.jpg",
            "timed_itinerary": {
                "stops": [],
                "legs": [],
                "total_minutes": 75,
                "total_distance_m": 2200.0,
            },
        },
    }


def _greet_payload() -> dict[str, object]:
    return {
        "success": True,
        "status": "info",
        "message": "我是 Seichijunrei，可以帮你查找动漫圣地并规划巡礼路线。",
        "answer": "我是 Seichijunrei，可以帮你查找动漫圣地并规划巡礼路线。",
    }


def _make_pipeline_result(text: str, locale: str) -> PipelineResult:
    if "宇治" in text and "附近" in text:
        return PipelineResult(
            intent="search_nearby",
            plan=_make_plan(ToolName.SEARCH_NEARBY, locale=locale),
            final_output=_nearby_payload(),
        )
    if "路线" in text or "ルート" in text:
        return PipelineResult(
            intent="plan_route",
            plan=_make_plan(ToolName.PLAN_ROUTE, locale=locale),
            final_output=_route_payload(),
        )
    if text.strip() in {"你好", "你是谁"}:
        return PipelineResult(
            intent="greet_user",
            plan=_make_plan(ToolName.GREET_USER, locale=locale),
            final_output=_greet_payload(),
        )
    return PipelineResult(
        intent="clarify",
        plan=_make_plan(ToolName.CLARIFY, locale=locale),
        final_output=_clarify_payload(),
    )


def _build_test_app(db: SupabaseClient) -> FastAPI:
    settings = Settings()
    settings_store = create_session_store(db=db)
    runtime_api = RuntimeAPI(db, session_store=settings_store)

    @asynccontextmanager
    async def _noop_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield

    app = create_fastapi_app(runtime_api=runtime_api, settings=settings, db=db)
    app.router.lifespan_context = _noop_lifespan
    app.state.settings = settings
    app.state.runtime_api = runtime_api
    app.state.db_client = db
    return app


class _AuthedClient:
    def __init__(self, client: TestClient) -> None:
        self._client = client

    @staticmethod
    def _headers(headers: dict[str, str] | None = None) -> dict[str, str]:
        merged = {"X-User-Id": "user-1", "X-User-Type": "human"}
        if headers:
            merged.update(headers)
        return merged

    def get(self, url: str, **kwargs: object):
        headers = kwargs.pop("headers", None)
        return self._client.get(url, headers=self._headers(headers), **kwargs)

    def post(self, url: str, **kwargs: object):
        headers = kwargs.pop("headers", None)
        return self._client.post(url, headers=self._headers(headers), **kwargs)


class _SSEClient:
    def __init__(self, client: TestClient) -> None:
        self._client = client

    def stream(self, url: str, **kwargs: object) -> list[dict[str, object]]:
        headers = kwargs.pop("headers", None)
        merged_headers = _AuthedClient._headers(headers)
        with self._client.stream("POST", url, headers=merged_headers, **kwargs) as resp:
            body = "".join(resp.iter_text())
        return _parse_sse_events(body)


def _parse_sse_events(raw: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    current_event: str | None = None
    current_data_lines: list[str] = []

    for line in raw.split("\n"):
        if line.startswith("event: "):
            current_event = line[len("event: ") :]
            continue
        if line.startswith("data: "):
            current_data_lines.append(line[len("data: ") :])
            continue
        if line != "" or current_event is None:
            continue

        payload = "\n".join(current_data_lines)
        events.append(
            {
                "event": current_event,
                **json.loads(payload),
            }
        )
        current_event = None
        current_data_lines = []

    return events


@pytest.fixture
def client(tc_db: SupabaseClient) -> AsyncIterator[_AuthedClient]:
    async def _fake_run_pilgrimage_agent(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        on_step: object | None = None,
    ) -> PipelineResult:
        _ = (db, model, context, on_step)
        return _make_pipeline_result(text, locale)

    async def _fake_generate_title(**kwargs: object) -> str:
        first_query = kwargs.get("first_query", "")
        return str(first_query)[:15] if isinstance(first_query, str) else "test"

    app = _build_test_app(tc_db)
    with (
        patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            side_effect=_fake_run_pilgrimage_agent,
        ),
        patch(
            "backend.interfaces.persistence.generate_and_save_title",
            side_effect=_fake_generate_title,
        ),
    ):
        with TestClient(app) as raw_client:
            yield _AuthedClient(raw_client)


@pytest.fixture
def sse_client(tc_db: SupabaseClient) -> AsyncIterator[_SSEClient]:
    async def _fake_run_pilgrimage_agent(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        on_step: object | None = None,
    ) -> PipelineResult:
        if callable(on_step):
            result = _make_pipeline_result(text, locale)
            if result.intent == "clarify":
                clarify_data = dict(_clarify_payload())
                await on_step(
                    "clarify",
                    "needs_clarification",
                    {
                        "question": clarify_data["question"],
                        "options": clarify_data["options"],
                        "candidates": clarify_data["candidates"],
                        "status": clarify_data["status"],
                    },
                    "",
                    str(clarify_data["message"]),
                )
            elif result.intent == "search_nearby":
                await on_step(
                    "search_nearby",
                    "done",
                    _nearby_payload()["results"],
                    "",
                    "",
                )
            elif result.intent == "plan_route":
                await on_step("plan_route", "done", _route_payload()["route"], "", "")
            return result
        _ = (db, model, context)
        return _make_pipeline_result(text, locale)

    async def _fake_generate_title(**kwargs: object) -> str:
        first_query = kwargs.get("first_query", "")
        return str(first_query)[:15] if isinstance(first_query, str) else "test"

    app = _build_test_app(tc_db)
    with (
        patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            side_effect=_fake_run_pilgrimage_agent,
        ),
        patch(
            "backend.interfaces.persistence.generate_and_save_title",
            side_effect=_fake_generate_title,
        ),
    ):
        with TestClient(app) as raw_client:
            yield _SSEClient(raw_client)
