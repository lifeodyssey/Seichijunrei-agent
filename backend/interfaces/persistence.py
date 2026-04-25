"""Persistence helpers for the runtime API.

Extracted from ``public_api`` to keep orchestration and persistence separated.
Each function is stateless — the ``db`` and ``session_store`` are passed in.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import structlog

from backend.agents.executor_agent import PipelineResult
from backend.infrastructure.session import SessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.schemas import (
    PublicAPIRequest,
    PublicAPIResponse,
)
from backend.interfaces.session_facade import (
    MAX_ROUTE_HISTORY,
    SessionUpdate,
    build_session_summary,
    build_updated_session_state,
    normalize_session_state,
)

logger = structlog.get_logger(__name__)

# Background tasks must be saved to prevent premature GC (python:S7502).
_background_tasks: set[asyncio.Task[object]] = set()


def _spawn_background(coro: object) -> None:
    """Create a background task and prevent premature garbage collection."""
    task: asyncio.Task[object] = asyncio.create_task(coro)  # type: ignore[arg-type]
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


# Common exception base for best-effort DB/IO persistence calls.
# asyncpg raises asyncpg.PostgresError (subclass of Exception) for SQL errors
# and OSError for connection issues. We also catch RuntimeError (pool closed)
# and ValueError (malformed data).
_PERSIST_ERRORS = (OSError, RuntimeError, ValueError, TypeError)


async def persist_result(
    *,
    db: object,
    session_store: SessionStore,
    session_id: str,
    request: PublicAPIRequest,
    result: PipelineResult | None,
    response: PublicAPIResponse,
    context_delta: dict[str, object],
    previous_state: dict[str, object],
    user_id: str | None,
) -> tuple[dict[str, object], bool, str | None]:
    """Persist session state, route, user state, and messages.

    Returns (session_state, user_message_persisted, generated_title).
    """
    session_state = build_updated_session_state(
        previous_state,
        SessionUpdate(
            request=request,
            response_intent=response.intent,
            response_status=response.status,
            response_success=response.success,
            response_message=response.message,
            context_delta=context_delta,
        ),
    )

    route_record = None
    if result is not None:
        route_record = await maybe_persist_route(
            db=db,
            session_id=session_id,
            request=request,
            result=result,
            response=response,
        )

    if route_record is not None:
        raw_rh = session_state["route_history"]
        route_history: list[object] = list(raw_rh) if isinstance(raw_rh, list) else []
        route_history.append(route_record)
        session_state["route_history"] = route_history[-MAX_ROUTE_HISTORY:]

    await persist_session(db, session_store, session_id, session_state, response)
    generated_title = await persist_user_state(
        db=db,
        session_id=session_id,
        user_id=user_id,
        request=request,
        response=response,
        result=result,
        context_delta=context_delta,
        previous_state=previous_state,
    )
    await persist_messages(
        db=db,
        session_id=session_id,
        user_text=request.text,
        result=result,
        response=response,
        persist_user_only=not response.success,
    )

    # TODO: re-enable session compaction with proper async task management
    # raw_ints = session_state.get("interactions")
    # interaction_count = len(raw_ints) if isinstance(raw_ints, list) else 0
    # if interaction_count >= COMPACT_THRESHOLD:
    #     _spawn_background(
    #         compact_session_interactions(
    #             session_id,
    #             session_state,
    #             session_store,
    #         )
    #     )

    return session_state, True, generated_title


async def _safe_insert_message(
    insert_fn: object,
    session_id: str,
    *args: object,
    label: str,
) -> None:
    """Best-effort message insert with structured logging on failure."""
    if not callable(insert_fn):
        return
    try:
        await insert_fn(session_id, *args)
    except _PERSIST_ERRORS:
        logger.warning(f"{label}_failed", session_id=session_id)


async def persist_messages(
    *,
    db: object,
    session_id: str,
    user_text: str,
    result: PipelineResult | None,
    response: PublicAPIResponse,
    persist_user_only: bool = False,
) -> None:
    """Persist user and bot messages to conversation_messages (best-effort)."""
    insert_message = getattr(db, "insert_message", None)
    if insert_message is None:
        return

    await _safe_insert_message(
        insert_message, session_id, "user", user_text, label="insert_user_message"
    )

    if persist_user_only:
        return

    response_data: dict[str, object] | None = None
    if result is not None:
        response_data = {
            "intent": result.intent,
            "success": result.success,
            "final_output": result.final_output,
        }
    await _safe_insert_message(
        insert_message,
        session_id,
        "assistant",
        response.message,
        response_data,
        label="insert_bot_message",
    )


async def persist_session(
    db: object,
    session_store: SessionStore,
    session_id: str,
    session_state: dict[str, object],
    response: PublicAPIResponse,
) -> None:
    await session_store.set(session_id, session_state)

    if isinstance(db, SupabaseClient):
        metadata = {
            "intent": response.intent,
            "status": response.status,
            "updated_at": session_state["updated_at"],
        }
        await db.session.upsert_session(session_id, session_state, metadata=metadata)


async def persist_user_state(
    *,
    db: object,
    session_id: str,
    user_id: str | None,
    request: PublicAPIRequest,
    response: PublicAPIResponse,
    result: PipelineResult | None,
    context_delta: dict[str, object],
    previous_state: dict[str, object],
) -> str | None:
    """Persist user state and return generated title (if first interaction)."""
    if not user_id or result is None or not response.success:
        return None

    generated_title: str | None = None
    if isinstance(db, SupabaseClient):
        try:
            await db.session.upsert_conversation(session_id, user_id, request.text)
        except _PERSIST_ERRORS:
            logger.warning("upsert_conversation_failed", session_id=session_id)
        # TODO: re-enable when conversation history feature is fully wired
        # else:
        #     raw_prev_ints = previous_state.get("interactions")
        #     is_first_interaction = (
        #         len(raw_prev_ints) == 0
        #         if isinstance(raw_prev_ints, list) else True
        #     )
        #     if is_first_interaction:
        #         generated_title = request.text.strip()[:20] or request.text[:20]
        #         _spawn_background(
        #             generate_and_save_title(
        #                 session_id=session_id,
        #                 first_query=request.text,
        #                 response_message=response.message,
        #                 db=db,
        #                 user_id=user_id,
        #             )
        #         )

    bangumi_id = context_delta.get("bangumi_id")
    if not isinstance(bangumi_id, str) or not isinstance(db, SupabaseClient):
        return generated_title

    anime_title_raw = context_delta.get("anime_title")
    anime_title = anime_title_raw if isinstance(anime_title_raw, str) else None
    try:
        await db.user_memory.upsert_user_memory(
            user_id,
            bangumi_id=bangumi_id,
            anime_title=anime_title,
        )
    except _PERSIST_ERRORS:
        logger.warning("upsert_user_memory_failed", user_id=user_id)

    return generated_title


async def load_user_memory(db: object, user_id: str | None) -> dict[str, object] | None:
    if not user_id or not isinstance(db, SupabaseClient):
        return None

    try:
        result = await db.user_memory.get_user_memory(user_id)
        return dict(result) if result else None
    except _PERSIST_ERRORS:
        logger.warning("get_user_memory_failed", user_id=user_id)
        return None


async def load_session_state(
    session_store: SessionStore, session_id: str
) -> dict[str, object]:
    state = await session_store.get(session_id)
    return normalize_session_state(state)


async def maybe_persist_route(
    *,
    db: object,
    session_id: str,
    request: PublicAPIRequest,
    result: PipelineResult,
    response: PublicAPIResponse,
) -> dict[str, object] | None:
    if not response.success or result.intent != "plan_route":
        return None

    route_data = response.data.get("route")
    if not isinstance(route_data, dict):
        return None

    ordered_points = route_data.get("ordered_points")
    if not isinstance(ordered_points, list) or not ordered_points:
        return None

    point_ids = [
        str(point["id"])
        for point in ordered_points
        if isinstance(point, dict) and point.get("id") is not None
    ]
    if not point_ids:
        return None

    plan_params = get_plan_params(result)
    bangumi_id_raw = plan_params.get("bangumi") or infer_bangumi_id(
        response.data.get("results")
    )
    if not isinstance(bangumi_id_raw, str):
        return None
    bangumi_id = bangumi_id_raw

    origin_station = plan_params.get("origin")
    if not isinstance(origin_station, str):
        origin_station = None
    if (
        origin_station is None
        and request.origin_lat is not None
        and request.origin_lng is not None
    ):
        origin_station = f"{request.origin_lat},{request.origin_lng}"

    route_record: dict[str, object] = {
        "route_id": None,
        "bangumi_id": bangumi_id,
        "origin_station": origin_station,
        "point_count": len(point_ids),
        "status": response.status,
        "created_at": datetime.now(UTC).isoformat(),
    }

    if isinstance(db, SupabaseClient):
        route_id = await db.routes.save_route(
            session_id,
            bangumi_id,
            point_ids,
            {
                "message": response.message,
                "results": response.data.get("results"),
                "route": route_data,
            },
            origin_station=origin_station,
            origin_lat=request.origin_lat,
            origin_lon=request.origin_lng,
        )
        route_record["route_id"] = route_id

    return route_record


def build_response_session(
    session_state: dict[str, object],
) -> tuple[dict[str, object], list[object]]:
    """Build session summary and route history for response."""
    session = build_session_summary(session_state)
    raw_rh = session_state["route_history"]
    route_history = list(raw_rh) if isinstance(raw_rh, list) else []
    return session, route_history


def get_plan_params(result: PipelineResult) -> dict[str, object]:
    for step in result.plan.steps:
        if step.params:
            return dict(step.params)
    return {}


def infer_bangumi_id(results: object) -> str | None:
    if not isinstance(results, dict):
        return None
    rows = results.get("rows")
    if not isinstance(rows, list) or not rows:
        return None
    first_row = rows[0]
    if not isinstance(first_row, dict):
        return None
    bangumi_id = first_row.get("bangumi_id")
    return str(bangumi_id) if bangumi_id is not None else None


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
