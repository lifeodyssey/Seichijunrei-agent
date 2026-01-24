"""Infrastructure adapter for the route planner port."""

from __future__ import annotations

from typing import Any

from application.errors import ExternalServiceError, InvalidInputError
from application.ports import RoutePlanner
from services.simple_route_planner import SimpleRoutePlanner


class SimpleRoutePlannerGateway(RoutePlanner):
    def __init__(self, *, planner: SimpleRoutePlanner | None = None) -> None:
        self._planner = planner

    def _get_planner(self) -> SimpleRoutePlanner:
        if self._planner is None:
            self._planner = SimpleRoutePlanner()
        return self._planner

    def generate_plan(
        self, *, origin: str, anime: str, points: list[dict[str, Any]]
    ) -> dict:
        """Generate a route plan, mapping any errors to application errors."""
        try:
            return self._get_planner().generate_plan(
                origin=origin, anime=anime, points=points
            )
        except ValueError as exc:
            raise InvalidInputError(str(exc)) from exc
        except Exception as exc:
            raise ExternalServiceError("route_planner", str(exc)) from exc
