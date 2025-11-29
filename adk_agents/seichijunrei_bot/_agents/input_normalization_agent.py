"""Input Normalization Agent - Ensures consistent parameter naming.

This agent solves the AgentTool parameter name inconsistency issue by
normalizing various possible parameter names (request, query, user_input, etc.)
into a single standardized field: user_query.

This is the ADK-recommended pattern for handling LLM-generated parameter names
that may vary despite instruction guidance.
"""

from typing import Any, Dict

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from utils.logger import get_logger


class InputNormalizationAgent(BaseAgent):
    """Normalizes input parameters to ensure consistent downstream access.

    ADK's AgentTool automatically adds function call parameters to session.state,
    but the parameter names are chosen by the calling LLM and cannot be strictly
    controlled. This agent searches for common parameter name variations and
    standardizes them to 'user_query' for reliable downstream consumption.
    """

    model_config = ConfigDict(extra='allow', arbitrary_types_allowed=True)

    def __init__(self) -> None:
        super().__init__(name="InputNormalizationAgent")
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        """Normalize input parameters to user_query field.

        Args:
            ctx: Invocation context containing session state

        Yields:
            Event with confirmation message
        """
        state: Dict[str, Any] = ctx.session.state

        # Search for possible parameter names in order of preference
        user_query = (
            state.get("user_query") or
            state.get("request") or
            state.get("query") or
            state.get("user_input") or
            state.get("input") or
            state.get("prompt")
        )

        if not user_query:
            # Log available keys for debugging
            available_keys = list(state.keys())
            error_msg = (
                f"错误：未找到用户查询。"
                f"session.state 中可用的键: {available_keys}"
            )
            self.logger.error(
                "No user query found in session state",
                available_keys=available_keys
            )
            yield Event(
                action=EventActions.AGENT_TEXT,
                content=error_msg
            )
            return

        # Standardize to user_query
        state["user_query"] = user_query

        self.logger.info(
            "Normalized user query",
            user_query=user_query
        )

        yield Event(
            action=EventActions.AGENT_TEXT,
            content=f"✓ 已规范化用户查询: {user_query}"
        )


# Create singleton instance for use in workflow
input_normalization_agent = InputNormalizationAgent()
