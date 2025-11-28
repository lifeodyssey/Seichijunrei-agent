"""ADK BaseAgent for weather lookup using WeatherClient.

Reads `user_coordinates` from `ctx.session.state`, calls WeatherClient to
get current weather, and writes a normalized `weather` dict back to state.
"""

from typing import Any, Dict, Optional

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from clients.weather import WeatherClient
from domain.entities import Coordinates, Weather, APIError
from utils.logger import get_logger


class WeatherAgent(BaseAgent):
    """Fetch current weather for the user's coordinates."""

    model_config = ConfigDict(extra='allow', arbitrary_types_allowed=True)

    def __init__(self, weather_client: Optional[WeatherClient] = None) -> None:
        super().__init__(name="WeatherAgent")
        self.weather_client = weather_client or WeatherClient()
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: Dict[str, Any] = ctx.session.state

        coordinates_data = state.get("user_coordinates")
        if not isinstance(coordinates_data, dict):
            raise ValueError("WeatherAgent requires user_coordinates dict in session.state")

        try:
            coordinates = Coordinates(**coordinates_data)
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid user_coordinates in session.state: {exc}") from exc

        self.logger.info(
            "[WeatherAgent] Querying current weather",
            coordinates=coordinates.to_string(),
        )

        try:
            weather: Weather = await self.weather_client.get_current_weather(coordinates=coordinates)
        except APIError as exc:
            self.logger.error(
                "[WeatherAgent] Failed to get weather",
                coordinates=coordinates.to_string(),
                error=str(exc),
                exc_info=True,
            )
            raise

        weather_dict = weather.model_dump()

        state["weather"] = weather_dict

        self.logger.info(
            "[WeatherAgent] Weather retrieved",
            location=weather.location,
            condition=weather.condition,
            temp_range=weather.temperature_range,
        )

        # Yield Event without content (state is already updated)
        # Event.content expects google.genai.types.Content, not arbitrary dict
        yield Event(
            author=self.name,
            content=None,  # Content is optional; state already contains weather data
            actions=EventActions(escalate=False),
        )


weather_agent = WeatherAgent()

