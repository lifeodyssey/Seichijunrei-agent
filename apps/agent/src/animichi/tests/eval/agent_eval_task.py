"""The three routes one eval case can take through the runtime.

Split out of ``eval_harness.py`` (#1493). ``make_agent_task`` there picks
between them per case, exactly as production does: a point selection and a
candidate selection bypass the model, and everything else runs the agent. The
in-function imports are deliberate — the eval mocks and the runtime entry
points are pulled in only on the route that uses them.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeAlias

from pydantic_ai.models import Model

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_deps import TitleTranslator, WebSearcher
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.domain.ports import CatalogLookup
from animichi.tests.eval.agent_eval_cases import message_history
from animichi.tests.eval.evaluators import AgentInput

CatalogFactory: TypeAlias = Callable[[], CatalogClientProtocol]


async def selected_task(inp: AgentInput) -> AgentResult:
    from animichi.agents.selected_route import execute_selected_itinerary
    from animichi.agents.session_state import SessionState
    from animichi.tests.eval.mock_catalog_client import MockCatalogClient

    return await execute_selected_itinerary(
        point_ids=inp.selected_point_ids or [],
        state=SessionState(),
        origin=None,
        locale=inp.locale,
        catalog=MockCatalogClient(),
    )


async def selection_task(inp: AgentInput) -> AgentResult:
    from animichi.agents.selection import (
        execute_multi_selection,
        execute_place_selection,
        validate_candidate_selection,
    )
    from animichi.agents.session_state import PendingClarification, SessionState
    from animichi.tests.eval.mock_catalog_client import MockCatalogClient

    pending = PendingClarification.model_validate(inp.seeded_pending or {})
    state = SessionState(
        pending_clarification=pending,
        clarification_revision=pending.revision,
    )
    selected = validate_candidate_selection(
        state,
        inp.selected_candidate_ids or [],
        inp.clarification_id if inp.clarification_id is not None else -1,
    )
    if selected.reason == "anime_ambiguity":
        return await execute_multi_selection(
            candidate_ids=selected.candidate_ids,
            state=state,
            locale=inp.locale,
            catalog=MockCatalogClient(),
        )
    return await execute_place_selection(
        candidate_id=selected.candidate_ids[0],
        state=state,
        locale=inp.locale,
        catalog=MockCatalogClient(),
    )


async def agent_task(
    inp: AgentInput,
    db: CatalogLookup,
    catalog_factory: CatalogFactory,
    model: Model,
    web_searcher: WebSearcher | None,
    title_translator: TitleTranslator | None,
) -> AgentResult:
    from animichi.agents.animichi_runner import run_animichi_agent
    from animichi.application.errors import InvalidInputError

    try:
        return await run_animichi_agent(
            text=inp.query,
            db=db,
            model=model,
            locale=inp.locale,
            context=dict(inp.context) if inp.context is not None else None,
            message_history=message_history(inp.context),
            catalog=catalog_factory(),
            web_searcher=web_searcher,
            title_translator=title_translator,
        )
    except InvalidInputError:
        # #984 rejects blank input with InvalidInputError; the production
        # AgentTurn boundary turns that into a graceful rejection result (not a
        # crash). Mirror it here so the L0 empty_input smoke case evaluates as a
        # produced result instead of an agent error.
        from pydantic_ai.usage import RunUsage

        from animichi.agents.runtime_models import BlockedResponseModel
        from animichi.agents.session_state import SessionState

        return AgentResult(
            output=BlockedResponseModel(message="Empty message."),
            intent="general_qa",
            session_state=SessionState(),
            usage=RunUsage(),
            status="blocked",
            success_override=False,
        )
