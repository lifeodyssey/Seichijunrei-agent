"""
End-to-end integration tests for Seichijunrei Bot.

These tests verify the complete workflow from user input to output generation.
They may require real API credentials and are marked with @pytest.mark.integration.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch
from datetime import datetime

from agents import OrchestratorAgent
from agents.base import AgentInput, AgentOutput
from tools import MapGeneratorTool, PDFGeneratorTool
from domain.entities import (
    Station, Bangumi, Point, Route, RouteSegment, TransportInfo,
    Coordinates, PilgrimageSession, Weather
)


@pytest.fixture
def mock_session():
    """Create a complete mock PilgrimageSession for testing."""
    station = Station(
        name="Shinjuku Station",
        coordinates=Coordinates(latitude=35.6896, longitude=139.7006),
        city="Tokyo",
        prefecture="Tokyo"
    )

    bangumi = Bangumi(
        id="115908",
        title="Kimi no Na wa",
        cn_title="你的名字",
        cover_url="https://example.com/cover.jpg",
        points_count=2,
        primary_color="#FF6B6B"
    )

    point1 = Point(
        id="point-1",
        name="Shinjuku Gyoen",
        cn_name="新宿御苑",
        coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
        episode=12,
        time_seconds=345,
        screenshot_url="https://example.com/screenshot1.jpg"
    )

    point2 = Point(
        id="point-2",
        name="Yoyogi Park",
        cn_name="代代木公园",
        coordinates=Coordinates(latitude=35.6700, longitude=139.7200),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
        episode=5,
        time_seconds=180,
        screenshot_url="https://example.com/screenshot2.jpg"
    )

    transport1 = TransportInfo(
        mode="walking",
        distance_meters=1200,
        duration_minutes=15,
        instructions="Walk south"
    )

    transport2 = TransportInfo(
        mode="walking",
        distance_meters=800,
        duration_minutes=10,
        instructions="Walk west"
    )

    segments = [
        RouteSegment(
            order=1,
            point=point1,
            transport=transport1,
            cumulative_distance_km=1.2,
            cumulative_duration_minutes=15
        ),
        RouteSegment(
            order=2,
            point=point2,
            transport=transport2,
            cumulative_distance_km=2.0,
            cumulative_duration_minutes=25
        )
    ]

    route = Route(
        origin=station,
        segments=segments,
        total_distance_km=2.0,
        total_duration_minutes=25,
        google_maps_url="https://www.google.com/maps/dir/..."
    )

    weather = Weather(
        date="2025-01-15",
        location="Tokyo",
        condition="晴天",
        temperature_high=18,
        temperature_low=8,
        precipitation_chance=10,
        wind_speed_kmh=12,
        recommendation="适合出行"
    )

    return PilgrimageSession(
        session_id="e2e-test-session",
        station=station,
        selected_bangumi_ids=["115908"],
        nearby_bangumi=[bangumi],
        points=[point1, point2],
        route=route,
        weather=weather
    )


class TestEndToEndWorkflow:
    """End-to-end workflow tests."""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_health_check_passes(self):
        """Test that health check endpoint works."""
        from health import health_check, readiness_check

        # Health check
        health = await health_check()
        assert health["status"] == "healthy"
        assert health["components"]["agents"] == 7
        assert health["components"]["tools"] == 2

        # Readiness check
        readiness = await readiness_check()
        assert readiness["status"] == "ready"
        assert "agents" in readiness["services"]
        assert "tools" in readiness["services"]

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_orchestrator_agent_initializes(self):
        """Test that OrchestratorAgent can be initialized."""
        orchestrator = OrchestratorAgent()

        assert orchestrator.name == "orchestrator_agent"
        assert orchestrator.search_agent is not None
        assert orchestrator.weather_agent is not None
        assert orchestrator.filter_agent is not None
        assert orchestrator.poi_agent is not None
        assert orchestrator.route_agent is not None
        assert orchestrator.transport_agent is not None

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_map_generator_produces_valid_html(self, mock_session, tmp_path):
        """Test that MapGeneratorTool produces valid HTML."""
        map_tool = MapGeneratorTool(output_dir=str(tmp_path))

        output_path = await map_tool.generate(mock_session)

        # Verify file created
        assert output_path is not None
        from pathlib import Path
        assert Path(output_path).exists()

        # Verify content
        content = Path(output_path).read_text()
        assert "folium" in content.lower() or "leaflet" in content.lower()
        assert "新宿御苑" in content  # CN name
        assert "Shinjuku Gyoen" in content  # JP name

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_pdf_generator_renders_html(self, mock_session, tmp_path):
        """Test that PDFGeneratorTool renders HTML correctly."""
        pdf_tool = PDFGeneratorTool(output_dir=str(tmp_path))

        html = await pdf_tool._render_html(mock_session)

        # Verify HTML content
        assert "圣地巡礼指南" in html  # Title
        assert "Shinjuku Station" in html  # Station name
        assert "新宿御苑" in html  # Point CN name
        assert "你的名字" in html  # Bangumi CN title
        assert "天气信息" in html or "晴天" in html  # Weather info

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_complete_workflow_with_mocks(self):
        """Test complete workflow with mocked API clients."""
        # Create mock sub-agents
        mock_search = AsyncMock()
        mock_search.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": {
                    "name": "Shinjuku Station",
                    "coordinates": {"latitude": 35.6896, "longitude": 139.7006}
                },
                "bangumi_list": [{
                    "id": "115908",
                    "title": "Kimi no Na wa",
                    "cn_title": "你的名字",
                    "cover_url": "https://example.com/cover.jpg",
                    "points_count": 2
                }],
                "search_radius_km": 5.0
            }
        )

        mock_weather = AsyncMock()
        mock_weather.execute.return_value = AgentOutput(
            success=True,
            data={
                "weather": {
                    "date": "2025-01-15",
                    "location": "Tokyo",
                    "condition": "晴天",
                    "temperature_high": 18,
                    "temperature_low": 8,
                    "precipitation_chance": 10,
                    "wind_speed_kmh": 12,
                    "recommendation": "适合出行"
                }
            }
        )

        mock_filter = AsyncMock()
        mock_filter.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]}
        )

        mock_poi = AsyncMock()
        mock_poi.execute.return_value = AgentOutput(
            success=True,
            data={
                "points": [{
                    "id": "point-1",
                    "name": "Shinjuku Gyoen",
                    "cn_name": "新宿御苑",
                    "coordinates": {"latitude": 35.6851, "longitude": 139.7100},
                    "bangumi_id": "115908",
                    "bangumi_title": "Kimi no Na wa",
                    "episode": 12,
                    "time_seconds": 345,
                    "screenshot_url": "https://example.com/screenshot.jpg"
                }]
            }
        )

        mock_route = AsyncMock()
        mock_route.execute.return_value = AgentOutput(
            success=True,
            data={
                "route": {
                    "origin": {
                        "name": "Shinjuku Station",
                        "coordinates": {"latitude": 35.6896, "longitude": 139.7006}
                    },
                    "segments": [{
                        "order": 1,
                        "point": {
                            "id": "point-1",
                            "name": "Shinjuku Gyoen",
                            "cn_name": "新宿御苑",
                            "coordinates": {"latitude": 35.6851, "longitude": 139.7100},
                            "bangumi_id": "115908",
                            "bangumi_title": "Kimi no Na wa",
                            "episode": 12,
                            "time_seconds": 345,
                            "screenshot_url": "https://example.com/screenshot.jpg"
                        },
                        "transport": {
                            "mode": "walking",
                            "distance_meters": 1200,
                            "duration_minutes": 15,
                            "instructions": "Walk south"
                        },
                        "cumulative_distance_km": 1.2,
                        "cumulative_duration_minutes": 15
                    }],
                    "total_distance_km": 1.2,
                    "total_duration_minutes": 15
                }
            }
        )

        mock_transport = AsyncMock()
        mock_transport.execute.return_value = AgentOutput(
            success=True,
            data={
                "route": {
                    "origin": {
                        "name": "Shinjuku Station",
                        "coordinates": {"latitude": 35.6896, "longitude": 139.7006}
                    },
                    "segments": [{
                        "order": 1,
                        "point": {
                            "id": "point-1",
                            "name": "Shinjuku Gyoen",
                            "cn_name": "新宿御苑",
                            "coordinates": {"latitude": 35.6851, "longitude": 139.7100},
                            "bangumi_id": "115908",
                            "bangumi_title": "Kimi no Na wa",
                            "episode": 12,
                            "time_seconds": 345,
                            "screenshot_url": "https://example.com/screenshot.jpg"
                        },
                        "transport": {
                            "mode": "walking",
                            "distance_meters": 1200,
                            "duration_minutes": 15,
                            "instructions": "Walk south"
                        },
                        "cumulative_distance_km": 1.2,
                        "cumulative_duration_minutes": 15
                    }],
                    "total_distance_km": 1.2,
                    "total_duration_minutes": 15
                }
            }
        )

        # Create orchestrator with mocked agents
        orchestrator = OrchestratorAgent(
            search_agent=mock_search,
            weather_agent=mock_weather,
            filter_agent=mock_filter,
            poi_agent=mock_poi,
            route_agent=mock_route,
            transport_agent=mock_transport
        )

        # Execute workflow
        input_data = AgentInput(
            session_id="e2e-test",
            data={"station_name": "新宿駅"}
        )

        result = await orchestrator.execute(input_data)

        # Verify result
        assert result.success is True
        assert result.data["steps_completed"] == 6
        assert "session" in result.data

        session_data = result.data["session"]
        assert session_data["station"]["name"] == "Shinjuku Station"
        assert len(session_data["route"]["segments"]) == 1


class TestAgentEntryPoint:
    """Tests for the ADK agent entry point."""

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_plan_pilgrimage_function(self):
        """Test the plan_pilgrimage function from agent.py."""
        # This test would require mocking the OrchestratorAgent
        # Skip if google-adk is not installed
        pytest.importorskip("google.adk")

        from agent import plan_pilgrimage

        # Mock the orchestrator
        with patch('agent._orchestrator') as mock_orchestrator:
            mock_orchestrator.execute.return_value = AgentOutput(
                success=True,
                data={
                    "session": {"session_id": "test", "station": {"name": "Test"}},
                    "steps_completed": 6
                }
            )

            result = await plan_pilgrimage("新宿駅", session_id="test-123")

            assert result["success"] is True
            assert result["steps_completed"] == 6
