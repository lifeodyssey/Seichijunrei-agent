"""Shared typed AgentResult builders for public API tests."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Literal

import pytest

from animichi.agents.agent_result import (
    AgentResult,
    ProducedItinerary,
    ProducedSearch,
    StepRecord,
    TurnProvenance,
)
from animichi.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    ItineraryResponseModel,
    QAResponseModel,
    RuntimeStageOutput,
    SearchResponseModel,
)
from animichi.agents.session_state import (
    CurrentAnime,
    ItineraryPayloadState,
    ItineraryRef,
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)


def _build_output(intent: str, message: str, state: SessionState) -> RuntimeStageOutput:
    if intent == "clarify":
        pending = state.pending_clarification
        reason = pending.reason if pending else "anime_not_found"
        ids = pending.candidate_ids if pending else []
        return ClarifyResponseModel(reason=reason, message=message, candidate_ids=ids)
    if intent in {"search_bangumi", "search_nearby"}:
        return SearchResponseModel(message=message)
    if intent in {"plan_route", "plan_selected", "plan_multi"}:
        return ItineraryResponseModel(message=message)
    if intent == "greet_user":
        return GreetingResponseModel(message=message)
    return QAResponseModel(message=message)


def _rows(data: dict[str, object], key: str) -> list[PointState]:
    value = data.get(key)
    payload = value if isinstance(value, dict) else {}
    raw_rows = payload.get("rows") or payload.get("ordered_points")
    rows = raw_rows if isinstance(raw_rows, list) else []
    return [PointState.model_validate(row) for row in rows if isinstance(row, dict)]


def _state(
    intent: str, data: dict[str, object], steps: list[StepRecord]
) -> SessionState:
    state = SessionState(current_anime=_resolved_anime(steps))
    if intent == "clarify":
        _seed_pending(state, data)
    if intent in {"search_bangumi", "search_nearby"}:
        _seed_search(state, intent, _rows(data, "results"))
    if intent in {"plan_route", "plan_selected", "plan_multi"}:
        _seed_route(state, intent, _rows(data, "route"))
    return state


def _resolved_anime(steps: list[StepRecord]) -> CurrentAnime | None:
    for step in reversed(steps):
        data = step.data or {}
        bangumi_id = data.get("bangumi_id")
        title = data.get("title") or data.get("anime_title")
        if isinstance(bangumi_id, str) and isinstance(title, str):
            return CurrentAnime(bangumi_id=bangumi_id, title=title)
    return None


def _seed_pending(state: SessionState, data: dict[str, object]) -> None:
    raw_ids = data.get("candidate_ids")
    ids = (
        [item for item in raw_ids if isinstance(item, str)]
        if isinstance(raw_ids, list)
        else []
    )
    reason = data.get("reason")
    valid_reason = reason if isinstance(reason, str) else "anime_not_found"
    candidates = [OrderedCandidate(id=item, title=item) for item in ids]
    state.pending_clarification = PendingClarification.model_validate(
        {
            "reason": valid_reason,
            "candidate_ids": ids,
            "ordered_candidates": candidates,
            "revision": 1,
        }
    )
    state.clarification_revision = 1


def _seed_search(state: SessionState, intent: str, rows: list[PointState]) -> None:
    ref = ResultRef("search:test")
    state.store_search_result(
        ref,
        SearchPayloadState(
            kind="nearby" if intent == "search_nearby" else "bangumi",
            rows=rows,
            row_count=len(rows),
            anime_id=state.current_anime.bangumi_id if state.current_anime else None,
        ),
    )


def _seed_route(state: SessionState, intent: str, rows: list[PointState]) -> None:
    source_ref = ResultRef("search:test")
    if rows:
        state.store_search_result(
            source_ref,
            SearchPayloadState(
                kind="multi" if intent == "plan_multi" else "bangumi",
                rows=rows,
                row_count=len(rows),
                anime_id=rows[0].bangumi_id,
                anime_ids=list(
                    dict.fromkeys(row.bangumi_id for row in rows if row.bangumi_id)
                ),
            ),
        )
    state.store_itinerary(
        ItineraryRef("itinerary:test"),
        ItineraryPayloadState(
            ordered_points=rows, source_ref=source_ref if rows else None
        ),
    )


def make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    message: str = "該当する巡礼地が見つかりませんでした。",
    data: Mapping[str, object] | None = None,
    steps: list[StepRecord] | None = None,
) -> AgentResult:
    """Build a compact output plus its authoritative typed registry."""
    del locale
    payload = (
        dict(data) if data is not None else {"results": {"rows": [], "row_count": 0}}
    )
    records = steps or []
    state = _state(intent, payload, records)
    return AgentResult(
        output=_build_output(intent, message, state),
        intent=intent,
        session_state=state,
        steps=records,
        provenance=_provenance(intent, state),
    )


def _provenance(intent: str, state: SessionState) -> TurnProvenance:
    search = None
    itinerary = None
    if intent in {"search_bangumi", "search_nearby", "plan_multi"}:
        ref = state.last_result_ref
        if ref is not None:
            payload = state.search_results[ref]
            outcome: Literal["ok", "empty"] = "ok" if payload.row_count else "empty"
            search = ProducedSearch(outcome=outcome, result_ref=ref)
    if intent in {"plan_route", "plan_selected", "plan_multi"} and state.itinerary_lru:
        itinerary = ProducedItinerary(
            status="ok", itinerary_ref=state.itinerary_lru[-1]
        )
    return TurnProvenance(search=search, itinerary=itinerary)


def make_fake_agent(
    result_fn: Callable[..., AgentResult] | None = None,
) -> Callable[..., Awaitable[AgentResult]]:
    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: object | None = None,
        catalog: object | None = None,
        title_translator: object | None = None,
        memory_store: object | None = None,
        user_id: str | None = None,
        model_settings: object | None = None,
    ) -> AgentResult:
        del (
            text,
            db,
            model,
            context,
            message_history,
            on_step,
            catalog,
            title_translator,
            memory_store,
            user_id,
            model_settings,
        )
        return (
            result_fn(locale=locale)
            if result_fn is not None
            else make_result(locale=locale)
        )

    return _fake


def install_mock_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "animichi.interfaces.public_api.run_animichi_agent", make_fake_agent()
    )


def make_run_agent_stub(
    result: AgentResult | None = None,
    *,
    capture: dict[str, object] | None = None,
    make: Callable[[str], AgentResult] | None = None,
) -> Callable[..., Awaitable[AgentResult]]:
    """A run_animichi_agent stand-in with the full production signature.

    Centralizes the ten-parameter boilerplate. `capture` records the call
    kwargs; the reply is `make(locale)` when given, else the fixed `result`.
    """
    if (result is None) == (make is None):
        raise ValueError("provide exactly one of result / make")

    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: object | None = None,
        catalog: object | None = None,
        title_translator: object | None = None,
        memory_store: object | None = None,
        user_id: str | None = None,
        model_settings: object | None = None,
    ) -> AgentResult:
        call: dict[str, object] = {
            "text": text,
            "db": db,
            "model": model,
            "locale": locale,
            "context": context,
            "message_history": message_history,
            "on_step": on_step,
            "catalog": catalog,
            "title_translator": title_translator,
            "memory_store": memory_store,
            "user_id": user_id,
            "model_settings": model_settings,
        }
        if capture is not None:
            capture.update(call)
        if make is not None:
            return make(locale)
        if result is None:  # unreachable by construction; narrows the type
            raise AssertionError("stub misconfigured")
        return result

    return _fake
