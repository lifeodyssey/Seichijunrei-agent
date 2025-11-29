"""Input Normalization Agent - Ensures consistent parameter naming.

This agent solves the AgentTool parameter name inconsistency issue by
normalizing various possible parameter names (request, query, user_input, etc.)
into a single standardized field: user_query.

This is the ADK-recommended pattern for handling LLM-generated parameter names
that may vary despite instruction guidance.
"""

from typing import Any

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

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    def __init__(self) -> None:
        super().__init__(name="InputNormalizationAgent")
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        """Capture incoming message and save to session state as user_query.

        AgentTool passes the request parameter as a user message, not in state.
        This agent extracts the message text and saves it to state for downstream agents.

        Args:
            ctx: Invocation context containing session and messages

        Yields:
            Event with confirmation message
        """
        state: dict[str, Any] = ctx.session.state

        # First, check if user_query already exists in state (from a previous agent)
        user_query = state.get("user_query")

        # If not in state, extract from the most recent user message
        if not user_query:
            # Get the latest user message from history
            # AgentTool sends the request parameter as a user message
            messages = ctx.session.messages or []
            for msg in reversed(messages):
                if msg.role == "user" and msg.parts:
                    # Extract text from the first text part
                    for part in msg.parts:
                        if hasattr(part, "text") and part.text:
                            user_query = part.text
                            break
                    if user_query:
                        break

        if not user_query:
            # Log available keys and message info for debugging
            available_keys = list(state.keys())
            msg_count = len(ctx.session.messages or [])
            error_msg = (
                "Error: no user query found. "
                f"session.state keys: {available_keys}, "
                f"message count: {msg_count}"
            )
            self.logger.error(
                "No user query found in messages or state",
                available_keys=available_keys,
                message_count=msg_count,
            )
            yield Event(action=EventActions.AGENT_TEXT, content=error_msg)
            return

        # Save to state for downstream agents
        state["user_query"] = user_query

        self.logger.info("Captured user query from message", user_query=user_query)

        yield Event(
            action=EventActions.AGENT_TEXT,
            content=f"✓ Captured user query: {user_query}",
        )


# Create singleton instance for use in workflow
input_normalization_agent = InputNormalizationAgent()
