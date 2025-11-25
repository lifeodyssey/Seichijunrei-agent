"""
OrchestratorAgent - Main coordinator for complete pilgrimage planning workflow.

Coordinates 6 sub-agents to generate a complete pilgrimage plan:
1. SearchAgent - Search nearby anime locations
2. WeatherAgent - Query weather (parallel)
3. FilterAgent - User preference filtering
4. POIAgent - Get pilgrimage points details
5. RouteAgent - Optimize route order
6. TransportAgent - Optimize transport modes
"""

import asyncio
from typing import Dict, Any, Optional

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from agents.search_agent import SearchAgent
from agents.weather_agent import WeatherAgent
from agents.filter_agent import FilterAgent
from agents.poi_agent import POIAgent
from agents.route_agent import RouteAgent
from agents.transport_agent import TransportAgent
from domain.entities import (
    Station, Point, Route, Bangumi, Weather, PilgrimageSession,
    Coordinates, APIError
)
from utils.logger import get_logger


class OrchestratorAgent(AbstractBaseAgent):
    """
    Main coordinator agent for pilgrimage planning workflow.

    This agent:
    - Accepts user input (station name)
    - Coordinates execution of 6 sub-agents in correct order
    - Manages session state throughout the workflow
    - Handles errors and provides unified error reporting
    - Returns complete pilgrimage plan
    """

    def __init__(
        self,
        search_agent: Optional[SearchAgent] = None,
        weather_agent: Optional[WeatherAgent] = None,
        filter_agent: Optional[FilterAgent] = None,
        poi_agent: Optional[POIAgent] = None,
        route_agent: Optional[RouteAgent] = None,
        transport_agent: Optional[TransportAgent] = None
    ):
        """
        Initialize the OrchestratorAgent.

        Args:
            search_agent: Agent for searching nearby anime locations
            weather_agent: Agent for weather queries
            filter_agent: Agent for filtering by user preferences
            poi_agent: Agent for getting POI details
            route_agent: Agent for route optimization
            transport_agent: Agent for transport mode optimization
        """
        super().__init__(
            name="orchestrator_agent",
            description="Orchestrates complete pilgrimage planning workflow"
        )
        self.search_agent = search_agent or SearchAgent()
        self.weather_agent = weather_agent or WeatherAgent()
        self.filter_agent = filter_agent or FilterAgent()
        self.poi_agent = poi_agent or POIAgent()
        self.route_agent = route_agent or RouteAgent()
        self.transport_agent = transport_agent or TransportAgent()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the complete orchestration workflow.

        Args:
            input_data: AgentInput containing:
                - station_name: Name of the station to start from

        Returns:
            Dictionary containing:
                - session: Complete PilgrimageSession
                - success: Boolean indicating success
                - steps_completed: Number of workflow steps completed
        """
        station_name = input_data.data.get("station_name")
        session_id = input_data.session_id

        self.logger.info(
            "Starting orchestration workflow",
            station_name=station_name,
            session_id=session_id
        )

        # Initialize session
        session = PilgrimageSession(session_id=session_id)

        try:
            # Step 1: SearchAgent - Find nearby bangumi
            self.logger.info("Step 1: Executing SearchAgent", session_id=session_id)
            search_result = await self._execute_search_agent(station_name, session_id)

            session.station = Station(**search_result["station"])
            session.nearby_bangumi = [Bangumi(**b) for b in search_result["bangumi_list"]]
            session.search_radius_km = search_result.get("search_radius_km", 5.0)

            # Step 2: WeatherAgent (parallel - start in background)
            self.logger.info("Step 2: Starting WeatherAgent (parallel)", session_id=session_id)
            weather_task = asyncio.create_task(
                self._execute_weather_agent(session.station.coordinates, session_id)
            )

            # Step 3: FilterAgent - Apply user preferences
            self.logger.info("Step 3: Executing FilterAgent", session_id=session_id)
            filter_result = await self._execute_filter_agent(session.nearby_bangumi, session_id)

            session.selected_bangumi_ids = filter_result["selected_bangumi_ids"]

            # Step 4: POIAgent - Get pilgrimage points
            self.logger.info("Step 4: Executing POIAgent", session_id=session_id)
            poi_result = await self._execute_poi_agent(
                session.selected_bangumi_ids,
                session.station.coordinates,
                session.search_radius_km,
                session_id
            )

            session.points = [Point(**p) for p in poi_result["points"]]

            # Check if we have any points
            if len(session.points) == 0:
                raise RuntimeError(
                    "No pilgrimage points found for selected bangumi in the area"
                )

            # Step 5: RouteAgent - Optimize route order
            self.logger.info("Step 5: Executing RouteAgent", session_id=session_id)
            route_result = await self._execute_route_agent(
                session.station,
                session.points,
                session_id
            )

            session.route = Route(**route_result["route"])

            # Step 6: TransportAgent - Optimize transport modes
            self.logger.info("Step 6: Executing TransportAgent", session_id=session_id)
            transport_result = await self._execute_transport_agent(
                session.route,
                session_id
            )

            session.route = Route(**transport_result["route"])

            # Wait for WeatherAgent to complete
            self.logger.info("Waiting for WeatherAgent to complete", session_id=session_id)
            try:
                weather_result = await weather_task
                session.weather = Weather(**weather_result["weather"])
            except Exception as e:
                self.logger.warning(
                    "WeatherAgent failed, continuing without weather data",
                    session_id=session_id,
                    error=str(e)
                )
                # Weather is optional, don't fail the entire workflow
                session.weather = None

            # Update session timestamp
            session.update()

            self.logger.info(
                "Orchestration workflow completed successfully",
                session_id=session_id,
                points_count=len(session.points),
                total_distance_km=session.route.total_distance_km,
                total_duration_min=session.route.total_duration_minutes
            )

            return {
                "session": session.model_dump(),
                "success": True,
                "steps_completed": 6
            }

        except RuntimeError as e:
            # User-facing errors (e.g., no points found)
            self.logger.error(
                "Orchestration workflow failed",
                session_id=session_id,
                error=str(e)
            )
            raise

        except Exception as e:
            self.logger.error(
                "Unexpected error during orchestration",
                session_id=session_id,
                error=str(e),
                exc_info=True
            )
            raise

    async def _execute_search_agent(
        self,
        station_name: str,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute SearchAgent to find nearby bangumi."""
        input_data = AgentInput(
            session_id=session_id,
            data={
                "station_name": station_name,
                "radius_km": 5.0
            }
        )

        result = await self.search_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"SearchAgent failed: {result.error}")

        return result.data

    async def _execute_weather_agent(
        self,
        coordinates: Coordinates,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute WeatherAgent to get weather information."""
        input_data = AgentInput(
            session_id=session_id,
            data={
                "coordinates": coordinates.model_dump(),
                "query_type": "current"
            }
        )

        result = await self.weather_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"WeatherAgent failed: {result.error}")

        return result.data

    async def _execute_filter_agent(
        self,
        bangumi_list: list,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute FilterAgent to apply user preferences."""
        input_data = AgentInput(
            session_id=session_id,
            data={
                "bangumi_list": [b.model_dump() for b in bangumi_list],
                "preferences": {
                    "max_count": 2  # Auto-select top 2 bangumi for now
                }
            }
        )

        result = await self.filter_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"FilterAgent failed: {result.error}")

        return result.data

    async def _execute_poi_agent(
        self,
        selected_bangumi_ids: list,
        coordinates: Coordinates,
        radius_km: float,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute POIAgent to get pilgrimage points."""
        input_data = AgentInput(
            session_id=session_id,
            data={
                "bangumi_ids": selected_bangumi_ids,
                "coordinates": coordinates.model_dump(),
                "radius_km": radius_km,
                "search_nearby": True
            }
        )

        result = await self.poi_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"POIAgent failed: {result.error}")

        return result.data

    async def _execute_route_agent(
        self,
        station: Station,
        points: list,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute RouteAgent to optimize route order."""
        input_data = AgentInput(
            session_id=session_id,
            data={
                "origin": station.model_dump(),
                "points": [p.model_dump() for p in points]
            }
        )

        result = await self.route_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"RouteAgent failed: {result.error}")

        return result.data

    async def _execute_transport_agent(
        self,
        route: Route,
        session_id: str
    ) -> Dict[str, Any]:
        """Execute TransportAgent to optimize transport modes."""
        input_data = AgentInput(
            session_id=session_id,
            data={"route": route.model_dump()}
        )

        result = await self.transport_agent.execute(input_data)

        if not result.success:
            raise RuntimeError(f"TransportAgent failed: {result.error}")

        return result.data

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for OrchestratorAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if station_name is provided
        if "station_name" not in input_data.data:
            self.logger.error("No station_name provided in input")
            return False

        station_name = input_data.data.get("station_name")

        # Validate station_name is a non-empty string
        if not isinstance(station_name, str):
            self.logger.error(
                "station_name must be a string",
                provided_type=type(station_name).__name__
            )
            return False

        if len(station_name.strip()) == 0:
            self.logger.error("station_name cannot be empty")
            return False

        return True
