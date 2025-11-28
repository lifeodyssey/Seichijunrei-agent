"""Unit tests for ADK WeatherAgent (BaseAgent).

Tests verify that WeatherAgent correctly:
- Reads user_coordinates from session.state
- Calls WeatherClient to get weather
- Writes weather to session.state
- Yields proper Event
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from adk_agents.seichijunrei_bot._agents.weather_agent import WeatherAgent
from domain.entities import Coordinates, Weather, APIError
from google.adk.events import Event, EventActions


@pytest.fixture
def mock_weather_client():
    """Mock WeatherClient for testing."""
    client = Mock()
    client.get_current_weather = AsyncMock()
    return client


@pytest.fixture
def valid_session_state():
    """Valid session state with user_coordinates."""
    return {
        "user_coordinates": {
            "latitude": 35.6812,
            "longitude": 139.7671,
        },
        "session_id": "test-session-123",
    }


@pytest.fixture
def sample_weather():
    """Sample Weather entity for testing."""
    return Weather(
        date=datetime.now().strftime("%Y-%m-%d"),
        location="Tokyo",
        condition="Sunny",
        temperature_high=25,
        temperature_low=18,
        precipitation_chance=10,
        wind_speed_kmh=15,
        recommendation="Perfect weather for pilgrimage!"
    )


@pytest.mark.asyncio
class TestWeatherAgent:
    """Test suite for WeatherAgent."""

    async def test_weather_agent_success_path(
        self,
        mock_weather_client,
        valid_session_state,
        sample_weather
    ):
        """Test WeatherAgent successfully fetches and writes weather."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)
        mock_weather_client.get_current_weather.return_value = sample_weather

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = valid_session_state.copy()

        # Act
        events = []
        async for event in agent._run_async_impl(mock_ctx):
            events.append(event)

        # Assert
        # 1. WeatherClient was called with correct coordinates
        mock_weather_client.get_current_weather.assert_called_once()
        call_args = mock_weather_client.get_current_weather.call_args
        coordinates = call_args.kwargs["coordinates"]
        assert coordinates.latitude == 35.6812
        assert coordinates.longitude == 139.7671

        # 2. Weather was written to session.state
        assert "weather" in mock_ctx.session.state
        weather_dict = mock_ctx.session.state["weather"]
        assert weather_dict["location"] == "Tokyo"
        assert weather_dict["condition"] == "Sunny"
        assert weather_dict["temperature_high"] == 25

        # 3. Event was yielded correctly
        assert len(events) == 1
        event = events[0]
        assert event.author == "WeatherAgent"
        # Event.content is None (state already updated with weather data)
        assert event.content is None
        assert event.actions.escalate is False

    async def test_weather_agent_missing_user_coordinates(
        self,
        mock_weather_client
    ):
        """Test WeatherAgent raises ValueError when user_coordinates is missing."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = {
            "session_id": "test-session-123",
            # user_coordinates is missing
        }

        # Act & Assert
        with pytest.raises(ValueError, match="WeatherAgent requires user_coordinates dict"):
            async for _ in agent._run_async_impl(mock_ctx):
                pass

        # WeatherClient should not be called
        mock_weather_client.get_current_weather.assert_not_called()

    async def test_weather_agent_user_coordinates_not_dict(
        self,
        mock_weather_client
    ):
        """Test WeatherAgent raises ValueError when user_coordinates is not a dict."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = {
            "user_coordinates": "not a dict",  # Invalid type
            "session_id": "test-session-123",
        }

        # Act & Assert
        with pytest.raises(ValueError, match="WeatherAgent requires user_coordinates dict"):
            async for _ in agent._run_async_impl(mock_ctx):
                pass

    async def test_weather_agent_invalid_coordinates_format(
        self,
        mock_weather_client
    ):
        """Test WeatherAgent raises ValueError when coordinates format is invalid."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = {
            "user_coordinates": {
                "lat": 35.6812,  # Wrong key (should be 'latitude')
                "lng": 139.7671,  # Wrong key (should be 'longitude')
            },
            "session_id": "test-session-123",
        }

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid user_coordinates in session.state"):
            async for _ in agent._run_async_impl(mock_ctx):
                pass

    async def test_weather_agent_api_error(
        self,
        mock_weather_client,
        valid_session_state
    ):
        """Test WeatherAgent propagates APIError from WeatherClient."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)
        mock_weather_client.get_current_weather.side_effect = APIError(
            "Weather API unavailable"
        )

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = valid_session_state.copy()

        # Act & Assert
        with pytest.raises(APIError, match="Weather API unavailable"):
            async for _ in agent._run_async_impl(mock_ctx):
                pass

        # Weather should not be written to state
        assert "weather" not in mock_ctx.session.state

    async def test_weather_agent_state_not_modified_on_error(
        self,
        mock_weather_client,
        valid_session_state
    ):
        """Test session.state remains clean when WeatherAgent encounters error."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)
        mock_weather_client.get_current_weather.side_effect = APIError(
            "Network timeout"
        )

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        initial_state = valid_session_state.copy()
        mock_ctx.session.state = initial_state

        # Act
        try:
            async for _ in agent._run_async_impl(mock_ctx):
                pass
        except APIError:
            pass  # Expected

        # Assert - state should only contain original keys
        assert set(mock_ctx.session.state.keys()) == set(initial_state.keys())
        assert "weather" not in mock_ctx.session.state

    async def test_weather_agent_logging_on_success(
        self,
        mock_weather_client,
        valid_session_state,
        sample_weather
    ):
        """Test WeatherAgent logs info messages on success."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)
        mock_weather_client.get_current_weather.return_value = sample_weather

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = valid_session_state.copy()

        # Act
        with patch.object(agent.logger, 'info') as mock_logger_info:
            async for _ in agent._run_async_impl(mock_ctx):
                pass

            # Assert - logger.info called at least twice (start + end)
            assert mock_logger_info.call_count >= 2

            # Check first call contains query message
            first_call_args = mock_logger_info.call_args_list[0]
            assert "[WeatherAgent]" in str(first_call_args) or "Querying" in str(first_call_args)

    async def test_weather_agent_logging_on_error(
        self,
        mock_weather_client,
        valid_session_state
    ):
        """Test WeatherAgent logs error on API failure."""
        # Arrange
        agent = WeatherAgent(weather_client=mock_weather_client)
        mock_weather_client.get_current_weather.side_effect = APIError(
            "API Error"
        )

        mock_ctx = Mock()
        mock_ctx.session = Mock()
        mock_ctx.session.state = valid_session_state.copy()

        # Act & Assert
        with patch.object(agent.logger, 'error') as mock_logger_error:
            try:
                async for _ in agent._run_async_impl(mock_ctx):
                    pass
            except APIError:
                pass  # Expected

            # Logger.error should be called
            mock_logger_error.assert_called_once()
            error_call = mock_logger_error.call_args
            assert "[WeatherAgent]" in str(error_call) or "Failed" in str(error_call)
