"""Session management facade for the public API.

Handles session state normalization, context building, interaction
compaction, title generation, and selected-point plan construction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import structlog

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.base import create_agent, get_default_model
from backend.infrastructure.session import SessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.schemas import PublicAPIRequest

logger = structlog.get_logger(__name__)

COMPACT_THRESHOLD = 8
COMPACT_KEEP_RECENT = 2
MAX_INTERACTIONS = 20
MAX_ROUTE_HISTORY = 10


@dataclass(frozen=True)
class SessionUpdate:
    """Bundles all response fields needed to update session state."""

    request: PublicAPIRequest
    response_intent: str
    response_status: str
    response_success: bool
    response_message: str = field(default="")
    context_delta: dict[str, object] | None = field(default=None)


def normalize_session_state(state: dict[str, object] | None) -> dict[str, object]:
    """Return a well-typed session state dict with all required keys."""
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
    normalized["summary"] = as_str_or_none(normalized.get("summary"))
    return normalized


def build_updated_session_state(
    previous_state: dict[str, object],
    update: SessionUpdate,
) -> dict[str, object]:
    """Append the current interaction and return the updated session state."""
    raw = previous_state["interactions"]
    interactions = list(raw) if isinstance(raw, list) else []
    interactions.append(
        {
            "text": update.request.text,
            "intent": update.response_intent,
            "status": update.response_status,
            "success": update.response_success,
            "created_at": datetime.now(UTC).isoformat(),
            "context_delta": update.context_delta or {},
        }
    )
    interactions = interactions[-MAX_INTERACTIONS:]

    return {
        **previous_state,
        "interactions": interactions,
        "last_intent": update.response_intent,
        "last_status": update.response_status,
        "last_message": update.response_message,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def build_session_summary(state: dict[str, object]) -> dict[str, object]:
    """Build a compact summary dict suitable for the response payload."""
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


@dataclass(frozen=True)
class _InteractionContext:
    """Extracted context fields from session interactions."""

    current_bangumi_id: str | None
    current_anime_title: str | None
    last_location: str | None
    last_search_data: dict[str, object] | None
    visited_bangumi_ids: list[str]
    resolve_candidates: list[dict[str, object]] | None
    pending_clarify: bool


def _extract_from_interactions(
    interactions: list[object],
) -> _InteractionContext:
    """Walk interactions in reverse and extract context fields."""
    current_bangumi_id: str | None = None
    current_anime_title: str | None = None
    last_location: str | None = None
    last_search_data: dict[str, object] | None = None
    visited_bangumi_ids: list[str] = []
    resolve_candidates: list[dict[str, object]] | None = None
    pending_clarify: bool = False

    for interaction in reversed(interactions):
        if not isinstance(interaction, dict):
            continue
        raw_delta = interaction.get("context_delta")
        delta = raw_delta if isinstance(raw_delta, dict) else {}

        bangumi_id = as_str_or_none(delta.get("bangumi_id"))
        anime_title = as_str_or_none(delta.get("anime_title"))
        location = as_str_or_none(delta.get("location"))

        if current_bangumi_id is None and bangumi_id:
            current_bangumi_id = bangumi_id
            current_anime_title = anime_title
        if last_location is None and location:
            last_location = location
        if bangumi_id and bangumi_id not in visited_bangumi_ids:
            visited_bangumi_ids.append(bangumi_id)

        if last_search_data is None:
            raw_search = delta.get("last_search_data")
            if isinstance(raw_search, dict):
                last_search_data = raw_search

        # Only grab clarify state from the most recent interaction
        if resolve_candidates is None:
            raw_candidates = delta.get("resolve_candidates")
            if isinstance(raw_candidates, list) and raw_candidates:
                resolve_candidates = [c for c in raw_candidates if isinstance(c, dict)]
            if delta.get("pending_clarify") is True:
                pending_clarify = True

        if current_bangumi_id and last_location:
            break

    return _InteractionContext(
        current_bangumi_id=current_bangumi_id,
        current_anime_title=current_anime_title,
        last_location=last_location,
        last_search_data=last_search_data,
        visited_bangumi_ids=visited_bangumi_ids,
        resolve_candidates=resolve_candidates,
        pending_clarify=pending_clarify,
    )


def build_context_block(
    session_state: dict[str, object],
    user_memory: dict[str, object] | None = None,
) -> dict[str, object] | None:
    """Derive a context block from session history and cross-session memory."""
    raw_interactions = session_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    summary = as_str_or_none(session_state.get("summary"))

    ictx = _extract_from_interactions(interactions)

    current_bangumi_id = ictx.current_bangumi_id
    current_anime_title = ictx.current_anime_title
    visited_bangumi_ids = list(ictx.visited_bangumi_ids)

    if user_memory:
        raw_visited = user_memory.get("visited_anime")
        visited_anime = raw_visited if isinstance(raw_visited, list) else []
        for entry in visited_anime:
            if not isinstance(entry, dict):
                continue
            bangumi_id = as_str_or_none(entry.get("bangumi_id"))
            if bangumi_id and bangumi_id not in visited_bangumi_ids:
                visited_bangumi_ids.append(bangumi_id)

        if current_bangumi_id is None and visited_anime:
            most_recent = max(
                visited_anime,
                key=lambda e: e.get("last_at", "") if isinstance(e, dict) else "",
                default=None,
            )
            if isinstance(most_recent, dict):
                current_bangumi_id = as_str_or_none(most_recent.get("bangumi_id"))
                current_anime_title = as_str_or_none(most_recent.get("title"))

    has_content = (
        current_bangumi_id
        or ictx.last_location
        or visited_bangumi_ids
        or summary
        or ictx.last_search_data is not None
        or ictx.pending_clarify
    )
    if not has_content:
        return None

    block: dict[str, object] = {
        "summary": summary,
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": ictx.last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }
    if ictx.last_search_data is not None:
        block["last_search_data"] = ictx.last_search_data
    if ictx.resolve_candidates is not None:
        block["resolve_candidates"] = ictx.resolve_candidates
    if ictx.pending_clarify:
        block["pending_clarify"] = True
    return block


def _extract_from_search_step(
    step: StepRecord,
    bangumi_id: str | None,
) -> tuple[str | None, str | None, dict[str, object]]:
    """Extract bangumi_id, anime_title, and last_search_data from a search step."""
    data = step.data if isinstance(step.data, dict) else {}
    last_search_data: dict[str, object] = data
    resolved_bangumi_id = bangumi_id
    anime_title: str | None = None

    rows = data.get("rows")
    if isinstance(rows, list) and rows and resolved_bangumi_id is None:
        first_row = rows[0] if isinstance(rows[0], dict) else {}
        resolved_bangumi_id = as_str_or_none(first_row.get("bangumi_id"))
        anime_title = as_str_or_none(
            first_row.get("title") or first_row.get("title_cn")
        )
    if resolved_bangumi_id is None:
        resolved_bangumi_id = as_str_or_none(
            step.params.get("bangumi_id") or step.params.get("bangumi")
        )

    return resolved_bangumi_id, anime_title, last_search_data


def extract_context_delta(result: AgentResult) -> dict[str, object]:
    """Extract bangumi_id / anime_title / location / last_search_data / clarify state."""
    bangumi_id: str | None = None
    anime_title: str | None = None
    location: str | None = None
    last_search_data: dict[str, object] | None = None
    resolve_candidates: list[dict[str, object]] | None = None
    pending_clarify: bool = False

    for step in result.steps:
        if step.tool == "resolve_anime" and step.success:
            data = step.data if isinstance(step.data, dict) else {}
            bangumi_id = as_str_or_none(data.get("bangumi_id"))
            anime_title = as_str_or_none(data.get("title") or data.get("anime_title"))
            raw_candidates = data.get("candidates")
            if isinstance(raw_candidates, list) and raw_candidates:
                resolve_candidates = [c for c in raw_candidates if isinstance(c, dict)]
            break

    for step in result.steps:
        if not step.success:
            continue
        if step.tool == "search_nearby" and location is None:
            location = as_str_or_none(step.params.get("location"))
        if step.tool == "search_bangumi":
            new_bid, new_title, last_search_data = _extract_from_search_step(
                step, bangumi_id
            )
            if bangumi_id is None:
                bangumi_id = new_bid
            if anime_title is None:
                anime_title = new_title
        if step.tool == "clarify":
            pending_clarify = True

    # Also mark pending_clarify based on intent — some models output
    # ClarifyResponseModel directly without calling the clarify() tool.
    if not pending_clarify and result.intent == "clarify" and resolve_candidates:
        pending_clarify = True

    context_delta: dict[str, object] = {}
    if bangumi_id is not None:
        context_delta["bangumi_id"] = bangumi_id
    if anime_title is not None:
        context_delta["anime_title"] = anime_title
    if location is not None:
        context_delta["location"] = location
    if last_search_data is not None:
        context_delta["last_search_data"] = last_search_data
    if resolve_candidates is not None:
        context_delta["resolve_candidates"] = resolve_candidates
    if pending_clarify:
        context_delta["pending_clarify"] = True
    return context_delta


async def compact_session_interactions(
    session_id: str,
    session_state: dict[str, object],
    session_store: SessionStore,
) -> None:
    """Compress older interactions into a short summary in the background."""
    latest_state = await session_store.get(session_id)
    current_state = normalize_session_state(
        latest_state if latest_state is not None else session_state
    )
    raw_interactions = current_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    if len(interactions) < COMPACT_THRESHOLD:
        return

    previous_summary = as_str_or_none(current_state.get("summary"))
    compacted = interactions[:-COMPACT_KEEP_RECENT]
    recent = interactions[-COMPACT_KEEP_RECENT:]
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
    except (OSError, RuntimeError, ValueError):
        logger.warning("compact_llm_failed", session_id=session_id)
        return

    summary = as_str_or_none(getattr(result, "output", None))
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
    except (OSError, RuntimeError):
        logger.warning("compact_write_failed", session_id=session_id)
        return

    logger.info(
        "compact_complete",
        session_id=session_id,
        summary_length=len(str(updated_state["summary"])),
    )


async def generate_and_save_title(
    *,
    session_id: str,
    first_query: str,
    response_message: str,
    db: object,
    user_id: str | None = None,
) -> str:
    """Generate a short conversation title, persist it, and return it."""
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
    except (OSError, RuntimeError, ValueError):
        logger.warning("conversation_title_generation_failed", session_id=session_id)

    if not isinstance(db, SupabaseClient):
        return title

    try:
        await db.session.update_conversation_title(session_id, title, user_id=user_id)
    except TypeError:
        await db.session.update_conversation_title(session_id, title)
    except (OSError, RuntimeError):
        logger.warning("update_conversation_title_failed", session_id=session_id)

    return title


def as_str_or_none(value: object) -> str | None:
    """Coerce a value to a stripped string, returning ``None`` for blanks."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None
