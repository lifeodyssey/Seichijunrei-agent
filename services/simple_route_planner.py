from typing import Any


class SimpleRoutePlanner:
    """
    Simplified route planner used by the Capstone implementation.

    Strategy:
    - Sort points by (episode, time_seconds) as a proxy for narrative order.
    - Take the first N points (default 10) to keep the route manageable.
    - Generate a human-readable route description and coarse estimates for
      duration and distance.

    This is intentionally heuristic and deterministic – the goal is to
    showcase custom tool integration rather than perfect routing.
    """

    def __init__(self, max_points: int = 10) -> None:
        self.max_points = max_points

    def generate_plan(
        self,
        origin: str,
        anime: str,
        points: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Generate a simple seichijunrei route plan.

        Args:
            origin: User's starting location (free-form string).
            anime: Anime title for which the route is planned.
            points: List of point dicts that include at least
                - name / cn_name
                - episode
                - time_seconds

        Returns:
            A dict compatible with the RoutePlan schema used by the
            RoutePlanningAgent.
        """
        if not points:
            return {
                "recommended_order": [],
                "route_description": f"Could not find available 聖地巡礼 points for '{anime}'. Please try again later.",
                "estimated_duration": "unknown",
                "estimated_distance": "unknown",
                "transport_tips": "no transport suggestions available",
                "special_notes": [
                    "The data source may be temporarily unavailable, or this anime has not yet been indexed with 聖地巡礼 points."
                ],
            }

        # 1. Sort by narrative order (episode then timestamp)
        sorted_points = sorted(
            points,
            key=lambda p: (
                p.get("episode", 99),
                p.get("time_seconds", 0),
            ),
        )

        # 2. Take the first N points to keep the route concise
        selected = sorted_points[: self.max_points]

        # 3. Build recommended order (prefer name, fallback to cn_name)
        recommended_order = [
            p.get("name") or p.get("cn_name") or "unknown point" for p in selected
        ]

        # 4. Build a simple multiline textual description
        description_lines = [
            f"Starting from {origin}, visit the iconic 聖地巡礼 points of '{anime}'.",
            "",
            "Recommended route:",
        ]

        for idx, point in enumerate(selected, start=1):
            name = point.get("cn_name") or point.get("name") or "unknown point"
            episode = point.get("episode", "?")
            description_lines.append(f"{idx}. {name} (Episode {episode})")

        route_description = "\n".join(description_lines)

        # 5. Rough estimates for duration and distance
        point_count = len(selected)
        est_duration_hours = point_count * 0.5  # ~30 minutes per point
        est_distance_km = point_count * 1.5  # ~1.5km between points

        # 6. Transport tips
        transport_tips = self._generate_transport_tips(origin)

        # 7. Generic notes
        special_notes = [
            "Recommend checking opening hours for each point in advance.",
            "Bring a map app for real-time navigation.",
            "Be mindful not to disturb local residents or other visitors when taking photos or staying at points.",
        ]

        return {
            "recommended_order": recommended_order,
            "route_description": route_description,
            "estimated_duration": f"approximately {est_duration_hours:.1f} hours",
            "estimated_distance": f"approximately {est_distance_km:.1f} kilometers",
            "transport_tips": transport_tips,
            "special_notes": special_notes,
        }

    def _generate_transport_tips(self, origin: str) -> str:
        """Generate simple transport recommendations for the route."""
        tips = [
            f"Starting from {origin}, recommendations:",
            "- Use local public transportation (trains/buses) to reach distant points.",
            "- When points are close to each other, consider walking.",
            "- Recommend purchasing a day pass to save on transportation costs.",
        ]
        return "\n".join(tips)
