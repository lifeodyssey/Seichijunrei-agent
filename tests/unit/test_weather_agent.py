"""
Unit tests for WeatherAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState, AgentValidationError
from agents.weather_agent import WeatherAgent
from domain.entities import Coordinates, APIError
from clients.weather import WeatherClient


@pytest.fixture
def mock_weather_client():
    """Create a mock WeatherClient."""
    client = Mock(spec=WeatherClient)
    client.get_current_weather = AsyncMock()
    client.get_forecast = AsyncMock()
    return client


@pytest.fixture
def weather_agent(mock_weather_client):
    """Create a WeatherAgent instance with mocked dependencies."""
    return WeatherAgent(weather_client=mock_weather_client)


@pytest.fixture
def sample_coordinates():
    """Create sample coordinates for testing."""
    return Coordinates(latitude=35.681236, longitude=139.767125)


@pytest.fixture
def sample_weather_data():
    """Create sample weather data for testing."""
    return {
        "temperature": 22.5,
        "feels_like": 21.0,
        "humidity": 65,
        "description": "Partly cloudy",
        "wind_speed": 5.2,
        "pressure": 1013,
        "visibility": 10000,
        "uv_index": 3,
        "clouds": 40,
        "rain_chance": 20
    }


@pytest.fixture
def sample_forecast_data():
    """Create sample forecast data for testing."""
    return {
        "daily": [
            {
                "date": "2025-11-21",
                "temperature_max": 25.0,
                "temperature_min": 18.0,
                "description": "Sunny",
                "rain_chance": 10,
                "humidity": 60
            },
            {
                "date": "2025-11-22",
                "temperature_max": 23.0,
                "temperature_min": 17.0,
                "description": "Partly cloudy",
                "rain_chance": 30,
                "humidity": 70
            },
            {
                "date": "2025-11-23",
                "temperature_max": 20.0,
                "temperature_min": 15.0,
                "description": "Light rain",
                "rain_chance": 80,
                "humidity": 85
            }
        ]
    }


class TestWeatherAgent:
    """Test suite for WeatherAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self, mock_weather_client):
        """Test WeatherAgent initialization."""
        agent = WeatherAgent(weather_client=mock_weather_client)

        assert agent.name == "weather_agent"
        assert agent.description == "Queries weather conditions for locations"
        assert agent.state == AgentState.IDLE
        assert agent.weather_client == mock_weather_client

    @pytest.mark.asyncio
    async def test_get_current_weather_success(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test successful current weather retrieval."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "current"
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert "weather_data" in result.data
        assert result.data["weather_data"] == sample_weather_data
        assert result.data["query_type"] == "current"
        assert result.data["location"]["latitude"] == 35.681236

        # Verify API was called correctly
        mock_weather_client.get_current_weather.assert_called_once_with(
            coordinates=sample_coordinates
        )

    @pytest.mark.asyncio
    async def test_get_forecast_success(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_forecast_data
    ):
        """Test successful forecast retrieval."""
        # Arrange
        mock_weather_client.get_forecast.return_value = sample_forecast_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "forecast",
                "days": 3
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert "weather_data" in result.data
        assert result.data["weather_data"] == sample_forecast_data
        assert result.data["query_type"] == "forecast"
        assert result.data["days_requested"] == 3
        assert len(result.data["weather_data"]["daily"]) == 3

        # Verify API was called correctly
        mock_weather_client.get_forecast.assert_called_once_with(
            coordinates=sample_coordinates,
            days=3
        )

    @pytest.mark.asyncio
    async def test_default_to_current_weather(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test default behavior when query_type is not specified."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump()
                # No query_type specified
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["query_type"] == "current"
        mock_weather_client.get_current_weather.assert_called_once()

    @pytest.mark.asyncio
    async def test_forecast_with_default_days(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_forecast_data
    ):
        """Test forecast with default days when not specified."""
        # Arrange
        mock_weather_client.get_forecast.return_value = sample_forecast_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "forecast"
                # No days specified
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is True
        mock_weather_client.get_forecast.assert_called_once_with(
            coordinates=sample_coordinates,
            days=5  # Default value
        )
        assert result.data["days_requested"] == 5

    @pytest.mark.asyncio
    async def test_weather_api_error(
        self, weather_agent, mock_weather_client, sample_coordinates
    ):
        """Test handling of weather API errors."""
        # Arrange
        mock_weather_client.get_current_weather.side_effect = APIError("Weather API unavailable")

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "current"
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error == "Weather API unavailable"
        assert result.data == {}

    @pytest.mark.asyncio
    async def test_input_validation_missing_coordinates(self, weather_agent):
        """Test input validation when coordinates are missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "query_type": "current"
                # Missing coordinates
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_coordinates(self, weather_agent):
        """Test input validation with invalid coordinates."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": "not a valid coordinates dict"
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_query_type(
        self, weather_agent, sample_coordinates
    ):
        """Test input validation with invalid query type."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "invalid_type"  # Invalid query type
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_days(
        self, weather_agent, sample_coordinates
    ):
        """Test input validation with invalid days parameter."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "forecast",
                "days": -1  # Invalid negative days
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_days_too_large(
        self, weather_agent, sample_coordinates
    ):
        """Test input validation with days exceeding maximum."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "forecast",
                "days": 15  # Too many days (max is usually 7-10)
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_weather_metadata_includes_timing(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test that result metadata includes execution timing."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump()
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert result.metadata["execution_time"] >= 0
        assert "timestamp" in result.metadata
        assert "agent" in result.metadata
        assert result.metadata["agent"] == "weather_agent"

    @pytest.mark.asyncio
    async def test_concurrent_weather_queries(
        self, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test multiple concurrent weather queries."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        # Create multiple agents for concurrent execution
        agents = [WeatherAgent(weather_client=mock_weather_client) for _ in range(3)]

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "query_type": "current"
            }
        )

        # Act - Execute queries concurrently
        results = await asyncio.gather(*[
            agent.execute(input_data) for agent in agents
        ])

        # Assert
        assert len(results) == 3
        for result in results:
            assert result.success is True
            assert result.data["weather_data"] == sample_weather_data

        # Verify API was called 3 times
        assert mock_weather_client.get_current_weather.call_count == 3

    @pytest.mark.asyncio
    async def test_agent_cleanup(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test agent cleanup after execution."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump()
            }
        )

        # Act
        await weather_agent.execute(input_data)
        await weather_agent.cleanup()

        # Assert
        assert weather_agent.state == AgentState.IDLE
        assert weather_agent._start_time is None

    @pytest.mark.asyncio
    async def test_agent_info(self, weather_agent):
        """Test agent info retrieval."""
        # Act
        info = weather_agent.get_info()

        # Assert
        assert info["name"] == "weather_agent"
        assert info["description"] == "Queries weather conditions for locations"
        assert info["state"] == "idle"
        assert info["start_time"] is None

    @pytest.mark.asyncio
    async def test_coordinates_with_location_name(
        self, weather_agent, mock_weather_client, sample_coordinates, sample_weather_data
    ):
        """Test weather query with location name included."""
        # Arrange
        mock_weather_client.get_current_weather.return_value = sample_weather_data

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "coordinates": sample_coordinates.model_dump(),
                "location_name": "Tokyo Station",
                "query_type": "current"
            }
        )

        # Act
        result = await weather_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["location_name"] == "Tokyo Station"