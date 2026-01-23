"""Use case: generate a route plan for selected points."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..ports.route_planner import RoutePlanner


@dataclass(frozen=True, slots=True)
class PlanRoute:
    planner: RoutePlanner

    def __call__(
        self, *, origin: str, anime: str, points: list[dict[str, Any]]
    ) -> dict:
        return self.planner.generate_plan(origin=origin, anime=anime, points=points)
