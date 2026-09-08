"""Thin public API surface over the AgentTurn use case (TURN-4 #955).

Orchestration only — the turn lifecycle (admission verdict, dispatch-certainty,
exactly-once settlement, session load/persist, kind dispatch) lives in
``application/agent_turn.AgentTurn``; this module wires its ports to the
runtime services and maps :class:`TurnResult` back onto
:class:`PublicAPIResponse`. Response building lives in ``response_builder``,
session management in ``session_facade``, and persistence in ``persistence``.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from functools import cached_property
from time import perf_counter
from typing import Protocol, cast
from uuid import uuid4

import httpx
import structlog
from fastapi import HTTPException
from pydantic_ai.usage import RunUsage
from pydantic_core import to_jsonable_python

from animichi.agents.agent_result import AgentResult, AttributedUsage, UsagePayer
from animichi.agents.animichi_agent import _input_guard_enabled, animichi_agent
from animichi.agents.animichi_runner import (
    MemoryStore,
    build_translation_context,
    deserialize_message_history,
    new_translation_usage,
    resolve_request_model,
    run_animichi_agent,
    to_model_turn_usage,
    translation_usage,
)
from animichi.agents.base import (
    ModelAliasError,
    conversation_routing_settings,
    resolve_model,
)
from animichi.agents.error_boundary import (
    is_byok_credential_rejection,
    is_provider_error,
)
from animichi.agents.runtime_deps import (
    OnStep,
    StepEvent,
    StepStatus,
    TitleTranslator,
    new_step_call_id,
)
from animichi.agents.selected_route import execute_selected_itinerary
from animichi.agents.selection import (
    SelectionError,
    execute_multi_selection,
    execute_place_selection,
    validate_candidate_selection,
)
from animichi.agents.session_state import SessionState
from animichi.agents.translation import (
    TranslationContext,
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from animichi.agents.web_trust import detect_prompt_injection
from animichi.application.agent_turn import AgentTurn
from animichi.application.errors import ApplicationError, ErrorCode
from animichi.application.outbox_payload import SettlementPayload, UsageItem
from animichi.application.outbox_port import OutboxEntry, OutboxKind, OutboxStore
from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionVerdict,
    TurnAdmission,
)
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import TurnOutcomeStore, TurnRef
from animichi.application.turn_types import (
    AdmissionRejection,
    CandidateSelectionTurn,
    ExecutionResult,
    PersistOutcome,
    PointSelectionTurn,
    ReservationBinding,
    SessionSnapshot,
    SessionUpdate,
    TextTurn,
    TurnInput,
    TurnKind,
    TurnResult,
    TurnSelectionError,
    TurnSideEffects,
    TurnStageEvent,
    TurnStageSink,
)
from animichi.clients.catalog_client import CatalogClient, CatalogClientProtocol
from animichi.config.settings import Settings, get_settings
from animichi.domain.fact_ledger import record_turn_facts
from animichi.domain.ports import (
    BangumiRepo,
    CatalogLookup,
    ConversationLog,
    RequestAudit,
    SessionRepo,
    UsageMeter,
)
from animichi.domain.repo_types import SessionStateData
from animichi.infrastructure.observability import (
    record_runtime_request,
    runtime_span,
)
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    state_digest,
)
from animichi.infrastructure.session import SessionStore, create_session_store
from animichi.interfaces.admission_policy import admission_policy
from animichi.interfaces.db_repos import (
    anon_quota_repo,
    bangumi_repo,
    messages_repo,
    outbox_repo,
    request_audit_repo,
    session_repo,
    turn_reservation_store,
    usage_repo,
)
from animichi.interfaces.error_registry import (
    internal_error_response,
    public_error_response,
    timeout_error_response,
)
from animichi.interfaces.persistence import (
    build_response_session,
    create_owned_session,
    extract_plan_steps,
    load_session_state,
    persist_result,
)
from animichi.interfaces.response_builder import agent_result_to_response
from animichi.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
    as_json_object,
)
from animichi.interfaces.session_facade import (
    build_context_block,
    build_message_history,
    extract_context_delta,
    normalize_session_state,
)
from animichi.interfaces.usage_metering import (
    UsagePrices,
    record_turn_usage,
    scope_for_identity,
)
from animichi.utils.language import detect_language, resolve_reply_language

__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "detect_language",
    "handle_public_request",
]

logger = structlog.get_logger(__name__)


class _ModelLike(Protocol):
    """Structural stand-in for the framework model type (opaque passthrough)."""


def _byok_credential_rejected_response() -> PublicAPIResponse:
    """Fixed, safe copy only (T7): never echoes `str(exc)`, which could carry
    provider response body content."""
    return public_error_response(
        "byok_credential_rejected",
        intent="error",
    )


def default_catalog_client() -> CatalogClient:
    """Build the default Catalog read-path client from settings.

    Used when no client is injected so the catalog-only agent always has a
    client to route through; production injects one explicitly via the lifespan.
    """
    return CatalogClient(base_url=get_settings().catalog_api_url)


def _input_error_response(
    request: PublicAPIRequest, limit: int
) -> PublicAPIResponse | None:
    """Reject oversized text with safe localized copy."""
    if len(request.text) <= limit:
        return None
    from animichi.agents.error_messages import build_input_error_message

    message = build_input_error_message("message_too_long", request.locale)
    error = PublicAPIError(code=ErrorCode.INVALID_INPUT.value, message=message)
    return PublicAPIResponse(
        success=False,
        status="invalid_request",
        intent="unknown",
        message=message,
        errors=[error],
    )


def _selection_state(context: dict[str, object] | None) -> SessionState:
    """Restore the typed selection oracle from the unified session context."""
    raw = context.get("session_state_v2") if context is not None else None
    return SessionState.model_validate(raw) if isinstance(raw, dict) else SessionState()


def _invalid_selection_response(_message: str | None = None) -> PublicAPIResponse:
    """Return a typed stale/invalid selection response without mutating state."""
    return public_error_response(
        "invalid_selection",
        intent="clarify",
        ui={"component": "Clarification"},
    )


def _request_digest(request: PublicAPIRequest) -> str:
    """Canonical sha256 hex of the turn request for exactly-once conflicts (AC4).

    Two retries of the same user turn must hash identically so admission can
    tell a safe replay from a same-key/different-request conflict.
    """
    import hashlib

    payload = "\n".join(
        [
            request.text or "",
            request.session_id or "",
            "|".join(request.selected_point_ids or ()),
            "|".join(request.selected_candidate_ids or ()),
            str(request.clarification_id or ""),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _kind_from_request(request: PublicAPIRequest) -> TurnKind:
    """Map the request carrier onto its typed turn kind."""
    if request.selected_point_ids is not None:
        return PointSelectionTurn(
            point_ids=tuple(request.selected_point_ids),
            locale=request.locale,
            origin=request.origin,
        )
    if request.selected_candidate_ids is not None:
        return CandidateSelectionTurn(
            candidate_ids=tuple(request.selected_candidate_ids),
            clarification_id=cast(int, request.clarification_id),
            locale=request.locale,
        )
    return TextTurn(
        text=request.text,
        locale=request.locale,
        include_debug=request.include_debug,
        origin=request.origin,
        origin_lat=request.origin_lat,
        origin_lng=request.origin_lng,
    )


def _stage_sink(on_step: OnStep | None) -> TurnStageSink | None:
    """Bridge the raw framework OnStep onto the neutral turn stage sink."""
    if on_step is None:
        return None

    async def sink(event: TurnStageEvent) -> None:
        await on_step(
            StepEvent(
                event.tool,
                event.call_id,
                cast(StepStatus, event.status),
                event.data or {},
            )
        )

    return sink


def _extract_delta_port() -> Callable[[object], dict[str, object]]:
    """Port: serialize an opaque output's typed session state (CQS query)."""

    def extract(output: object) -> dict[str, object]:
        if isinstance(output, AgentResult):
            return extract_context_delta(output)
        return {}

    return extract


class _RuntimeTurnExecution:
    """TurnExecution port: dispatch on the typed turn kind (TURN-4 #955)."""

    def __init__(
        self,
        api: RuntimeAPI,
        *,
        request: PublicAPIRequest,
        model: _ModelLike | str | None,
        is_byok: bool,
        user_id: str | None,
        on_step: OnStep | None,
    ) -> None:
        self._api = api
        self._request = request
        self._model = model
        self._is_byok = is_byok
        self._user_id = user_id
        self._on_step = on_step

    async def execute(
        self,
        kind: TurnKind,
        *,
        context: dict[str, object] | None,
        history: Sequence[object],
        model: object | None,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult:
        try:
            if isinstance(kind, TextTurn):
                return await self._text_turn(kind, context, history, model, on_step)
            if isinstance(kind, PointSelectionTurn):
                return await self._point_turn(kind, context, on_step)
            return await self._candidate_turn(kind, context, on_step)
        except SelectionError as exc:
            raise TurnSelectionError(str(exc)) from exc
        except TimeoutError:
            # AgentTurn owns deadline enforcement (wait_for) and the timeout
            # mapping; a timeout escaping the port must reach it untouched.
            raise
        except ModelAliasError:
            return self._failed("invalid_model_alias")
        except ApplicationError as exc:
            return self._failed(exc.error_code, dict(exc.details))
        except Exception as exc:
            if self._is_byok and is_byok_credential_rejection(exc):
                logger.warning("byok_credential_rejected")
                return self._failed("byok_credential_rejected")
            if is_provider_error(exc):
                logger.warning("provider_error", error=str(exc)[:200])
                return self._failed("provider_error")
            logger.error("pipeline_unhandled_exception", exc_info=exc)
            return self._failed("internal_error")

    async def _text_turn(
        self,
        kind: TextTurn,
        context: dict[str, object] | None,
        history: Sequence[object],
        model: object | None,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult:
        supplemental_usage: list[AttributedUsage] = []
        resolved = resolve_request_model(model, self._api._model_http_client)
        result = await run_animichi_agent(
            text=kind.text,
            db=cast(CatalogLookup, self._api._db),
            model=resolved,
            model_settings=conversation_routing_settings(
                resolved, self._request.session_id
            ),
            locale=kind.locale,
            context=context,
            message_history=deserialize_message_history(history),
            on_step=_to_on_step(on_step),
            catalog=self._api._catalog,
            title_translator=(
                self._api._server_title_translator(supplemental_usage)
                if self._is_byok
                else None
            ),
            memory_store=self._api._memory_store,
            user_id=self._user_id,
        )
        result.supplemental_usage.extend(supplemental_usage)
        await _apply_translation_gate(
            result,
            resolve_reply_language(kind.text, kind.locale),
            self._on_step,
            # D18: the post-turn translation pass reuses the run's own model
            # when it can (cheaper, same connection) — but on a BYOK turn
            # that model is the caller's own credential, and this helper call
            # must never be billed to it. `model=None` forces
            # `_translation_context`'s fallback to the server default.
            model=None if self._is_byok else resolved,
            isolate_platform_usage=self._is_byok,
        )
        return _execution_result(result)

    async def _point_turn(
        self,
        kind: PointSelectionTurn,
        context: dict[str, object] | None,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult:
        resolve_request_model(self._model, self._api._model_http_client)
        result = await execute_selected_itinerary(
            point_ids=list(kind.point_ids),
            state=_selection_state(context),
            origin=kind.origin,
            locale=kind.locale,
            catalog=self._api._catalog,
            on_step=_to_on_step(on_step),
        )
        return _execution_result(result)

    async def _candidate_turn(
        self,
        kind: CandidateSelectionTurn,
        context: dict[str, object] | None,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult:
        resolve_request_model(self._model, self._api._model_http_client)
        state = _selection_state(context)
        selected = validate_candidate_selection(
            state, list(kind.candidate_ids), kind.clarification_id
        )
        if selected.reason == "anime_ambiguity":
            result = await execute_multi_selection(
                candidate_ids=selected.candidate_ids,
                state=state,
                locale=kind.locale,
                catalog=self._api._catalog,
                on_step=_to_on_step(on_step),
            )
        else:
            result = await execute_place_selection(
                candidate_id=selected.candidate_ids[0],
                state=state,
                locale=kind.locale,
                catalog=self._api._catalog,
                on_step=_to_on_step(on_step),
            )
        return _execution_result(result)

    def _failed(
        self, error_code: str, error_details: dict[str, object] | None = None
    ) -> ExecutionResult:
        return ExecutionResult(
            output=None,
            context_delta={},
            intent="error",
            status="error",
            error_code=error_code,
            error_details=error_details,
        )


def _to_on_step(sink: TurnStageSink | None) -> OnStep | None:
    """Bridge the neutral turn stage sink back onto the framework OnStep."""
    if sink is None:
        return None

    async def on_step(step: StepEvent) -> None:
        await sink(TurnStageEvent(step.tool, step.call_id, step.status, step.data))

    return on_step


def _execution_result(result: AgentResult) -> ExecutionResult:
    """Command-then-query (CQS, OQ-4): record facts, then extract the delta."""
    record_turn_facts(
        result.session_state.fact_ledger, result.steps, now=datetime.now(UTC)
    )
    new_messages: list[object] = (
        list(to_jsonable_python(result.new_messages)) if result.new_messages else []
    )
    return ExecutionResult(
        output=result,
        context_delta=extract_context_delta(result),
        intent=result.intent,
        status=result.status or "ok",
        new_messages=new_messages,
    )


class _RuntimeSessionGateway:
    """SessionGateway port: ownership, load/create, and persist."""

    def __init__(
        self,
        api: RuntimeAPI,
        *,
        request: PublicAPIRequest,
        user_id: str | None,
    ) -> None:
        self._api = api
        self._request = request
        self._user_id = user_id
        self._previous_state: SessionStateData | None = None

    async def check_owner(self, session_id: str | None, user_id: str | None) -> bool:
        if session_id is None or user_id is None:
            return True
        repo = self._api._session_repo
        if repo is None or not await repo.check_session_owner(session_id, user_id):
            return False
        return True

    async def load(
        self,
        session_id: str | None,
        *,
        user_id: str | None,
    ) -> SessionSnapshot:
        if session_id is None and user_id is not None:
            return await self._create_owned(user_id)
        previous_state = (
            await load_session_state(self._api._session_store, session_id)
            if session_id is not None
            else normalize_session_state(None)
        )
        self._previous_state = previous_state
        if session_id is not None and user_id is not None:
            repo = self._api._session_repo
            if repo is None or not await repo.check_session_owner(session_id, user_id):
                raise HTTPException(status_code=404, detail="Conversation not found.")
        context = build_context_block(previous_state)
        if (
            self._request.origin_lat is not None
            and self._request.origin_lng is not None
        ):
            if context is None:
                context = {}
            context["origin_lat"] = self._request.origin_lat
            context["origin_lng"] = self._request.origin_lng
        return SessionSnapshot(
            session_id=session_id,
            session_state=previous_state,
            context=context,
            history=build_message_history(previous_state),
        )

    async def _create_owned(self, user_id: str) -> SessionSnapshot:
        session_id = uuid4().hex
        state = normalize_session_state(None)
        await create_owned_session(
            self._api._session_repo, session_id, user_id, self._request.text, state
        )
        self._previous_state = state
        return SessionSnapshot(
            session_id=session_id,
            session_state=state,
            context=None,
            history=(),
            is_new=True,
        )

    async def persist(self, session_id: str, update: SessionUpdate) -> PersistOutcome:
        result = update.output if isinstance(update.output, AgentResult) else None
        response = (
            agent_result_to_response(result, include_debug=self._request.include_debug)
            if result is not None
            else PublicAPIResponse(
                success=update.response_success,
                status=update.response_status,
                intent=update.response_intent,
                message=update.response_message,
            )
        )
        session_state, _, generated_title = await persist_result(
            session_repo=self._api._session_repo,
            bangumi_repo=self._api._bangumi_repo,
            messages_repo=self._api._messages_repo,
            session_store=self._api._session_store,
            session_id=session_id,
            request=self._request,
            result=result,
            response=response,
            context_delta=update.context_delta or {},
            previous_state=self._previous_state or normalize_session_state(None),
            user_id=self._user_id,
        )
        return PersistOutcome(
            session_state=session_state, generated_title=generated_title
        )


class _RuntimeTurnSettlement:
    """TurnSettlement port: ENQUEUE the effects, never apply them inline (AC5).

    On the CAS-win path the three external effects (usage metering / quota
    increment / request audit) are recorded as durable outbox rows. Enqueue is
    idempotent on ``(turn_key, kind)``, so a replayed settle of an
    already-settled turn creates NO new row (``created`` is ``False``) and
    applies nothing. The effects are applied exactly once by the transactional
    background drain, which runs each row's effect and its delivered-mark in
    one transaction — so a crash can never double-charge a non-idempotent
    effect nor leave it applied-but-undelivered (AC5).
    """

    def __init__(
        self,
        api: RuntimeAPI,
        *,
        request: PublicAPIRequest,
        user_id: str | None,
        user_type: str | None,
        is_byok: bool,
    ) -> None:
        self._api = api
        self._request = request
        self._user_id = user_id
        self._user_type = user_type
        self._is_byok = is_byok

    async def settle(self, side: TurnSideEffects) -> None:
        """Record the durable effects; the drain applies them exactly once."""
        payload = self._payload(side)
        outbox = self._api._outbox
        if outbox is None:
            return
        json_payload = payload.to_json()
        for kind in _OUTBOX_KINDS:
            await outbox.enqueue(
                OutboxEntry(
                    turn_key=side.turn_key,
                    kind=kind,
                    session_id=side.session_id,
                    payload=json_payload,
                )
            )

    def _payload(self, side: TurnSideEffects) -> SettlementPayload:
        """Extract every external effect into a serializable settlement payload."""
        result = side.result if isinstance(side.result, AgentResult) else None
        usage_items = _usage_items(result, side.is_byok) if result is not None else ()
        return SettlementPayload(
            session_id=side.session_id,
            user_id=side.user_id,
            user_type=side.user_type,
            is_byok=side.is_byok,
            settle_quota=side.settle_quota,
            elapsed_ms=side.elapsed_ms,
            intent=side.intent,
            status=side.status,
            request_text=side.request_text,
            locale=self._request.locale,
            user_message_persisted=side.user_message_persisted,
            usage=usage_items,
            plan_steps=extract_plan_steps(result),
        )


class RuntimeAPI:
    """Thin interface-layer facade over the AgentTurn use case."""

    def __init__(
        self,
        db: object,
        *,
        session_store: SessionStore | None = None,
        session_repo: SessionRepo | None = None,
        turn_store: TurnOutcomeStore | None = None,
        catalog: CatalogClientProtocol | None = None,
        settings: Settings | None = None,
        model_http_client: httpx.AsyncClient,
        memory_store: MemoryStore | None = None,
    ) -> None:
        self._db = db
        self._session_store = session_store or create_session_store()
        #: Explicit repository injection (#994): the SQLModel repositories are
        #: constructed by the lifespan and passed in; the db-client locator is
        #: only the fallback for the not-yet-migrated repos and test doubles.
        self._session_repo_override = session_repo
        self._turn_store_override = turn_store
        self._catalog: CatalogClientProtocol = catalog or default_catalog_client()
        self._settings = settings or get_settings()
        self._model_http_client = model_http_client
        self._memory_store = memory_store

    def bind_model_http_client(self, client: httpx.AsyncClient) -> None:
        """Bind the client owned by the surrounding application lifespan."""
        self._model_http_client = client

    # Iter6 C4: each repo is resolved at most once *per instance*, lazily,
    # on first actual use — never reflected on every call. `cached_property`
    # (not eager resolution in `__init__`) is deliberate: a `db` that is not
    # wired for a repo surfaces ``None`` here, which callers treat as
    # "feature unavailable" where they can respond gracefully, not while
    # merely constructing the `RuntimeAPI` facade itself (which is not
    # request-scoped and has no exception handler around it).
    @cached_property
    def _session_repo(self) -> SessionRepo | None:
        if self._session_repo_override is not None:
            return self._session_repo_override
        return session_repo(self._db)

    @cached_property
    def _bangumi_repo(self) -> BangumiRepo | None:
        return bangumi_repo(self._db)

    @cached_property
    def _usage_repo(self) -> UsageMeter | None:
        return usage_repo(self._db)

    @cached_property
    def _messages_repo(self) -> ConversationLog | None:
        #: #994: on the migrated path the injected SQLModel session repository
        #: owns the ordered transcript; the locator is the test-double
        #: fallback only.
        if self._session_repo_override is not None:
            return cast(ConversationLog, self._session_repo_override)
        return messages_repo(self._db)

    @cached_property
    def _request_audit_repo(self) -> RequestAudit | None:
        return request_audit_repo(self._db)

    @cached_property
    def _outbox(self) -> OutboxStore | None:
        return outbox_repo(self._db)

    @property
    def model_http_client(self) -> httpx.AsyncClient:
        """Return the required shared model transport."""
        return self._model_http_client

    async def validate_session_owner(
        self, session_id: str | None, user_id: str | None
    ) -> None:
        """Hide sessions that are not owned by the authenticated user."""
        if session_id is None or user_id is None:
            return
        repo = self._session_repo
        if repo is None or not await repo.check_session_owner(session_id, user_id):
            raise HTTPException(status_code=404, detail="Conversation not found.")

    async def handle(
        self,
        request: PublicAPIRequest,
        *,
        model: _ModelLike | str | None = None,
        is_byok: bool = False,
        user_id: str | None = None,
        user_type: str | None = None,
        on_step: OnStep | None = None,
        outcome: TurnOutcome | None = None,
        turn_ref: TurnRef | None = None,
        owner: str | None = None,
        verdict: AdmissionVerdict | None = None,
        turn_key: str | None = None,
    ) -> PublicAPIResponse:
        """Execute one turn through AgentTurn and map its result to a response.

        A route-granted reservation (``outcome`` + ``turn_ref`` + ``owner``)
        or admission ``verdict`` drives dispatch/settlement; absent both, the
        use case admits itself (direct callers).
        """
        rejection = _input_error_response(request, self._settings.message_max_chars)
        if rejection is not None:
            return rejection
        binding = None
        if outcome is not None and turn_ref is not None and owner is not None:
            binding = ReservationBinding(outcome, turn_ref, owner)
            if verdict is None:
                verdict = AdmissionVerdict(
                    admitted=True,
                    payer="user",
                    revision=0,
                    session_id=turn_ref.session_id,
                    owner=owner,
                )
        agent_turn = self._build_agent_turn(
            request, model, is_byok, user_id, user_type, on_step, outcome, binding
        )
        with runtime_span("runtime.handle") as span:
            started_at = perf_counter()
            result = await agent_turn(
                TurnInput(
                    session_id=request.session_id,
                    turn_key=turn_key or uuid4().hex,
                    identity=AdmissionIdentity(user_id=user_id, user_type=user_type),
                    kind=_kind_from_request(request),
                    request_digest=_request_digest(request),
                    is_byok=is_byok,
                    model=model if model is not None else request.model,
                    verdict=verdict,
                ),
                binding=binding,
                on_step=_stage_sink(on_step),
            )
            response = self._response(request, result)
            _record_result_span(span, request, response)
            record_runtime_request(
                duration_ms=int((perf_counter() - started_at) * 1000),
                intent=response.intent,
                status=response.status,
                transport="public_api",
            )
            return response

    def _build_agent_turn(
        self,
        request: PublicAPIRequest,
        model: _ModelLike | str | None,
        is_byok: bool,
        user_id: str | None,
        user_type: str | None,
        on_step: OnStep | None,
        outcome: TurnOutcome | None,
        binding: ReservationBinding | None,
    ) -> AgentTurn:
        return AgentTurn(
            outcome=outcome or self._lifecycle_outcome(),
            session=_RuntimeSessionGateway(self, request=request, user_id=user_id),
            settlement=_RuntimeTurnSettlement(
                self,
                request=request,
                user_id=user_id,
                user_type=user_type,
                is_byok=is_byok,
            ),
            execution=_RuntimeTurnExecution(
                self,
                request=request,
                model=model,
                is_byok=is_byok,
                user_id=user_id,
                on_step=on_step,
            ),
            detect_injection=detect_prompt_injection,
            guard_enabled=_input_guard_enabled,
            blocked_outcome=self._blocked_outcome(),
            extract_delta=_extract_delta_port(),
            timeout=self._settings.agent_deadline,
        )

    def _lifecycle_outcome(self) -> TurnOutcome:
        """Build a lifecycle use case for direct (non-route) callers."""
        db = self._db
        store = self._turn_store_override
        if store is None:
            store = turn_reservation_store(db)
        return TurnOutcome(
            store=store,
            admission=TurnAdmission(
                store=store,
                policy=admission_policy(self._settings),
                usage_repo=usage_repo(db),
                anon_quota_repo=anon_quota_repo(db),
            ),
        )

    def _blocked_outcome(self) -> Callable[[SessionSnapshot, str], object]:
        """Build the blocked AgentResult for the injection gate."""
        from animichi.agents.animichi_runner import _blocked_message
        from animichi.agents.runtime_models import BlockedResponseModel

        def build(snapshot: SessionSnapshot, locale: str) -> object:
            return AgentResult(
                output=BlockedResponseModel(message=_blocked_message(locale)),
                intent="blocked",
                session_state=_selection_state(snapshot.context),
                steps=[],
                usage=RunUsage(),
                status="blocked",
                success_override=False,
            )

        return build

    def _response(
        self,
        request: PublicAPIRequest,
        result: TurnResult,
    ) -> PublicAPIResponse:
        if result.outcome == "rejected":
            return _rejection_response(result.rejection)
        if result.outcome == "lease_lost":
            return PublicAPIResponse(
                success=False,
                status="blocked",
                intent="blocked",
                errors=[
                    PublicAPIError(
                        code="turn_lease_lost",
                        message=(
                            "The turn reservation expired before dispatch; please retry."
                        ),
                        action="retry",
                    )
                ],
            )
        if result.outcome == "error":
            response = _error_response_for(
                result.error_code, self._settings, result.error_details
            )
        else:
            output = result.output
            response = (
                agent_result_to_response(output, include_debug=request.include_debug)
                if isinstance(output, AgentResult)
                else _replayed_response(output, result.outcome == "replayed")
            )
        response.session_id = result.session_id
        response.revision = result.revision
        if result.persisted is not None:
            session_summary, route_history = build_response_session(
                result.persisted.session_state
            )
            response.session = as_json_object(session_summary)
            response.route_history = [
                as_json_object(item) for item in route_history if isinstance(item, dict)
            ]
            response.generated_title = result.persisted.generated_title
            response.session_digest = state_digest(result.persisted.session_state)
        return response

    def _usage_prices(self) -> UsagePrices:
        return UsagePrices(
            input_usd_per_mtok=self._settings.model_input_cost_per_mtok_usd,
            output_usd_per_mtok=self._settings.model_output_cost_per_mtok_usd,
        )

    def _server_title_translator(
        self, supplemental_usage: list[AttributedUsage]
    ) -> TitleTranslator:
        """D18: force `translate_anime_title` onto the server key on a BYOK
        turn. Without this override the tool inherits the active run's own
        model via `RunContext.model` (cheap connection reuse on every other
        turn) — which on a BYOK turn *is* the caller's credential. Passing an
        explicit callable here bypasses that inheritance: `ctx=None` makes
        `translate_title` fall back to `translation_agent`'s own baked-in
        server default, never the per-request override.
        """

        async def _translate(title: str, target_language: str) -> TranslationResult:
            usage = new_translation_usage()
            result = await translate_title(
                title,
                target_locale=target_language,
                kind="anime_title",
                catalog=self._catalog,
                ctx=build_translation_context(
                    resolve_model(translation_agent.model), usage
                ),
            )
            if usage.requests > 0:
                supplemental_usage.append(AttributedUsage(usage, "platform"))
            return result

        return _translate


def _replayed_response(output: object, replayed: bool) -> PublicAPIResponse:
    """Rebuild a committed response from a recovered (idempotency) payload.

    On a replay (AC3) the committed ``PublicAPIResponse`` is recovered from the
    reservation, not recomputed by the model; a dict payload is validated back
    onto the typed wire carrier.
    """
    if replayed and isinstance(output, dict):
        return PublicAPIResponse.model_validate(output, from_attributes=False)
    return PublicAPIResponse(success=True, status="ok", intent="unknown")


def _rejection_response(rejection: AdmissionRejection | None) -> PublicAPIResponse:
    """Map an admission refusal onto the internal response carrier."""
    if rejection is None:
        return internal_error_response()
    return PublicAPIResponse(
        success=False,
        status="rejected",
        intent="error",
        errors=[PublicAPIError(code=rejection.reason, message=rejection.reason)],
    )


def _error_response_for(
    error_code: str | None,
    settings: Settings,
    error_details: dict[str, object] | None = None,
) -> PublicAPIResponse:
    from animichi.interfaces.error_registry import PublicErrorCode

    if error_code == "timeout":
        return timeout_error_response(settings.agent_deadline)
    if error_code == "invalid_model_alias":
        return public_error_response("invalid_model_alias")
    if error_code == "invalid_selection":
        return _invalid_selection_response()
    if error_code == "byok_credential_rejected":
        return _byok_credential_rejected_response()
    if error_code == "provider_error":
        return public_error_response("provider_error", intent="error")
    if error_code is not None and error_code != "internal_error":
        return public_error_response(
            cast(PublicErrorCode, error_code), details=as_json_object(error_details)
        )
    return internal_error_response()


def _record_result_span(
    span: object, request: PublicAPIRequest, response: PublicAPIResponse
) -> None:
    set_attr = getattr(span, "set_attribute", None)
    if not callable(set_attr):
        return
    if response.session_id:
        set_attr("runtime.session_id", response.session_id)
    set_attr("runtime.include_debug", request.include_debug)
    set_attr("runtime.intent", response.intent)
    set_attr("runtime.status", response.status)
    set_attr("runtime.success", response.success)
    set_attr("runtime.error_count", len(response.errors))


async def handle_public_request(
    request: PublicAPIRequest,
    db: object,
    *,
    model: _ModelLike | str | None = None,
    session_store: SessionStore | None = None,
    user_id: str | None = None,
    on_step: OnStep | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    from animichi.agents.base import build_model_http_client
    from animichi.infrastructure.memory import postgres_memory_store

    model_client = build_model_http_client()
    api = RuntimeAPI(
        db,
        session_store=session_store,
        model_http_client=model_client,
        memory_store=postgres_memory_store(db),
    )
    try:
        return await api.handle(request, model=model, user_id=user_id, on_step=on_step)
    finally:
        await model_client.aclose()


async def _apply_translation_gate(
    result: AgentResult,
    locale: str,
    on_step: OnStep | None,
    *,
    model: object | None,
    isolate_platform_usage: bool = False,
) -> None:
    """Translate the agent message when its language mismatches *locale*.

    Mutates the output model's ``message`` field in place.
    """
    message = result.message
    if not message:
        return
    detected = resolve_reply_language(message, locale)
    if detected == locale:
        return
    call_id = new_step_call_id("translate")
    if on_step is not None:
        await on_step(StepEvent("translate", call_id, "running", {}))
    status: StepStatus = "done"
    try:
        translated = await translate_text(
            message,
            target_locale=locale,
            ctx=_translation_context(result, model, isolate_platform_usage),
        )
        object.__setattr__(result.output, "message", translated)
    except (OSError, RuntimeError, ValueError, TypeError):
        logger.warning("translation_gate_failed", locale=locale)
        status = "error"
    if on_step is not None:
        await on_step(StepEvent("translate", call_id, status, {}))


def _translation_context(
    result: AgentResult,
    model: object | None,
    isolate_platform_usage: bool = False,
) -> TranslationContext:
    selected = model or resolve_model(animichi_agent.model)
    usage = translation_usage(result, isolate_platform_usage)
    return build_translation_context(selected, usage)


def _attributed_usage(result: AgentResult, is_byok: bool) -> list[AttributedUsage]:
    payer: UsagePayer = "byok" if is_byok else "platform"
    primary = [] if result.usage is None else [AttributedUsage(result.usage, payer)]
    return [*primary, *result.supplemental_usage]


#: The three external effects a settled turn records durably (AC5).
_OUTBOX_KINDS: tuple[OutboxKind, ...] = ("usage", "quota", "audit")


def _usage_items(result: AgentResult, is_byok: bool) -> tuple[UsageItem, ...]:
    """Reduce the turn's metered calls to JSON-safe items for the outbox."""
    return tuple(
        UsageItem(
            payer=item.payer,
            requests=item.usage.requests,
            prompt_tokens=item.usage.input_tokens,
            completion_tokens=item.usage.output_tokens,
        )
        for item in _attributed_usage(result, is_byok)
    )


async def _record_attributed_usage(
    usage_repo: UsageMeter | None,
    item: AttributedUsage,
    user_id: str | None,
    user_type: str | None,
    platform_prices: UsagePrices,
) -> None:
    scope = scope_for_identity(user_id, user_type, is_byok=item.payer == "byok")
    prices = platform_prices if item.payer == "platform" else UsagePrices(0.0, 0.0)
    await record_turn_usage(
        usage_repo,
        usage=to_model_turn_usage(item.usage),
        scope=scope,
        prices=prices,
    )


async def record_attributed_usage(
    usage_repo: UsageMeter | None,
    item: AttributedUsage,
    user_id: str | None,
    user_type: str | None,
    platform_prices: UsagePrices,
) -> None:
    await _record_attributed_usage(
        usage_repo, item, user_id, user_type, platform_prices
    )
