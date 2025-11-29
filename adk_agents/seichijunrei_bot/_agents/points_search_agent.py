"""ADK BaseAgent for fetching ALL pilgrimage points from Anitabi.

In the simplified Capstone architecture this agent:

- Reads the selected bangumi ID from session state
- Fetches all pilgrimage points for that bangumi from Anitabi
- Writes them to state under the `all_points` key (no filtering)

Downstream, PointsSelectionAgent (LlmAgent) is responsible for selecting
the best 8–12 points for route planning. This keeps deterministic I/O
separate from LLM decision-making, following ADK best practices.
"""

from typing import Any

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from clients.anitabi import AnitabiClient
from domain.entities import APIError
from utils.logger import get_logger


class PointsSearchAgent(BaseAgent):
    """Fetch all pilgrimage points for the selected bangumi from Anitabi."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    def __init__(self, anitabi_client: AnitabiClient | None = None) -> None:
        super().__init__(name="PointsSearchAgent")
        self.anitabi_client = anitabi_client or AnitabiClient()
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: dict[str, Any] = ctx.session.state

        # Verify session state for debugging and ensuring state propagation
        extraction = state.get("extraction_result") or {}
        selected = state.get("selected_bangumi") or {}

        self.logger.info(
            "[PointsSearchAgent] Session state check",
            has_extraction_result=bool(extraction),
            has_location=bool(extraction.get("location")),
            location_value=extraction.get("location"),
            has_selected_bangumi=bool(selected),
            has_bangumi_id=bool(selected.get("bangumi_id")),
            bangumi_id_value=selected.get("bangumi_id"),
        )

        # Prefer the new Capstone state shape first: selected_bangumi.bangumi_id
        selected_bangumi = state.get("selected_bangumi") or {}
        bangumi_id = selected_bangumi.get("bangumi_id")

        # Backward-compatible fallback: older workflow uses bangumi_result.bangumi_id
        if bangumi_id is None:
            bangumi_result = state.get("bangumi_result") or {}
            bangumi_id = bangumi_result.get("bangumi_id")

        if not isinstance(bangumi_id, int):
            raise ValueError(
                f"PointsSearchAgent requires valid bangumi_id. "
                f"Got: {bangumi_id} (type: {type(bangumi_id).__name__})"
            )

        self.logger.info(
            "[PointsSearchAgent] Fetching all bangumi points",
            bangumi_id=bangumi_id,
        )

        try:
            points = await self.anitabi_client.get_bangumi_points(str(bangumi_id))
        except APIError as exc:
            self.logger.error(
                "[PointsSearchAgent] Failed to get bangumi points",
                bangumi_id=bangumi_id,
                error=str(exc),
                exc_info=True,
            )
            raise

        self.logger.info(
            "[PointsSearchAgent] Points fetched",
            bangumi_id=bangumi_id,
            total_points=len(points),
        )

        # No distance filtering: expose ALL points to the LLM selector
        all_points_data = [p.model_dump() for p in points]
        points_meta = {
            "total": len(all_points_data),
            "source": "anitabi",
            "bangumi_id": bangumi_id,
        }

        # Write into session state using the new all_points key
        state["all_points"] = all_points_data
        state["points_meta"] = points_meta

        self.logger.info(
            "[PointsSearchAgent] All points prepared",
            points_count=len(all_points_data),
        )

        # BaseAgent Event content must be None or specific ADK types, not arbitrary dict
        yield Event(
            invocation_id=ctx.invocation_id,  # Required: correlate events in same invocation
            author=self.name,
            content=None,
            actions=EventActions(escalate=False),
        )


points_search_agent = PointsSearchAgent()
