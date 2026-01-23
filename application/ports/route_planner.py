"""Ports for route planning."""

from __future__ import annotations

from typing import Any, Protocol


class RoutePlanner(Protocol):
    def generate_plan(
        self, *, origin: str, anime: str, points: list[dict[str, Any]]
    ) -> dict:
        """Generate a route plan compatible with the RoutePlan schema."""
