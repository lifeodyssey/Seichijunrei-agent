"""
FilterAgent - Filters locations based on user preferences.
Applies various filters such as admission fee, opening hours, distance, and bangumi.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, time

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from domain.entities import Point, Coordinates
from utils.logger import get_logger


class FilterAgent(AbstractBaseAgent):
    """
    Agent responsible for filtering pilgrimage points based on user preferences.

    This agent:
    - Accepts a list of points and filtering preferences
    - Applies multiple filters (admission fee, hours, distance, etc.)
    - Ranks results by preference match score
    - Returns filtered and optionally ranked points
    """

    def __init__(self):
        """Initialize the FilterAgent."""
        super().__init__(
            name="filter_agent",
            description="Filters locations based on user preferences"
        )
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the filtering logic.

        Args:
            input_data: AgentInput containing:
                - points: List of point dictionaries to filter
                - preferences: Dictionary of filter preferences:
                    - max_admission_fee: Maximum admission fee in JPY
                    - filter_by_hours: Whether to filter by opening hours
                    - current_time: Current time for hours check (HH:MM format)
                    - max_distance_km: Maximum distance from reference point
                    - reference_coordinates: Reference point for distance filtering
                    - bangumi_ids: List of specific bangumi IDs to include
                    - rank_by_score: Whether to rank results by score

        Returns:
            Dictionary containing:
                - filtered_points: List of points after filtering
                - total_before_filter: Original number of points
                - total_after_filter: Number after filtering
                - filters_applied: List of filters that were applied
        """
        # Extract input data
        points_data = input_data.data.get("points", [])
        preferences = input_data.data.get("preferences", {})

        # Convert point dicts to Point objects
        points = [Point(**p) for p in points_data]
        original_count = len(points)

        self.logger.info(
            "Starting filtering",
            original_count=original_count,
            session_id=input_data.session_id
        )

        # Track which filters are applied
        filters_applied = []

        # Apply filters
        if "max_admission_fee" in preferences:
            points = self._filter_by_admission_fee(
                points, preferences["max_admission_fee"]
            )
            filters_applied.append("admission_fee")

        if preferences.get("filter_by_hours") and "current_time" in preferences:
            points = self._filter_by_opening_hours(
                points, preferences["current_time"]
            )
            filters_applied.append("opening_hours")

        if "max_distance_km" in preferences and "reference_coordinates" in preferences:
            ref_coords = Coordinates(**preferences["reference_coordinates"])
            points = self._filter_by_distance(
                points, ref_coords, preferences["max_distance_km"]
            )
            filters_applied.append("distance")

        if "bangumi_ids" in preferences and preferences["bangumi_ids"]:
            points = self._filter_by_bangumi(
                points, preferences["bangumi_ids"]
            )
            filters_applied.append("bangumi")

        # Rank by score if requested
        if preferences.get("rank_by_score"):
            points = self._rank_by_score(points, preferences)

        # Convert back to dictionaries
        filtered_points = [p.model_dump() for p in points]

        self.logger.info(
            "Filtering completed",
            original_count=original_count,
            filtered_count=len(filtered_points),
            filters_applied=filters_applied,
            session_id=input_data.session_id
        )

        return {
            "filtered_points": filtered_points,
            "total_before_filter": original_count,
            "total_after_filter": len(filtered_points),
            "filters_applied": filters_applied
        }

    def _filter_by_admission_fee(
        self, points: List[Point], max_fee: float
    ) -> List[Point]:
        """Filter points by maximum admission fee."""
        filtered = []
        for point in points:
            if point.admission_fee is None or point.admission_fee == "Free":
                # Free admission
                filtered.append(point)
            else:
                # Try to parse fee amount
                try:
                    fee_str = point.admission_fee.replace("JPY", "").strip()
                    fee_amount = float(fee_str)
                    if fee_amount <= max_fee:
                        filtered.append(point)
                except (ValueError, AttributeError):
                    # Can't parse fee, include by default
                    filtered.append(point)

        self.logger.debug(
            "Admission fee filter applied",
            original=len(points),
            filtered=len(filtered),
            max_fee=max_fee
        )
        return filtered

    def _filter_by_opening_hours(
        self, points: List[Point], current_time_str: str
    ) -> List[Point]:
        """Filter points by current opening hours."""
        filtered = []

        # Parse current time
        try:
            hour, minute = map(int, current_time_str.split(":"))
            current_time = time(hour, minute)
        except ValueError:
            # Invalid time format, return all points
            return points

        for point in points:
            if point.opening_hours is None:
                # No hours info, include by default
                filtered.append(point)
            else:
                if self._is_open_at_time(point.opening_hours, current_time):
                    filtered.append(point)

        self.logger.debug(
            "Opening hours filter applied",
            original=len(points),
            filtered=len(filtered),
            current_time=current_time_str
        )
        return filtered

    def _is_open_at_time(self, hours_str: str, check_time: time) -> bool:
        """Check if a location is open at a specific time."""
        try:
            # Parse hours like "09:00-23:00"
            parts = hours_str.split("-")
            if len(parts) != 2:
                return True  # Can't parse, assume open

            open_str, close_str = parts
            open_hour, open_min = map(int, open_str.strip().split(":"))
            close_hour, close_min = map(int, close_str.strip().split(":"))

            open_time = time(open_hour, open_min)
            close_time = time(close_hour, close_min)

            # Handle normal hours
            if open_time <= close_time:
                return open_time <= check_time <= close_time
            else:
                # Handle overnight hours (e.g., "22:00-02:00")
                return check_time >= open_time or check_time <= close_time

        except (ValueError, AttributeError):
            # Can't parse, assume open
            return True

    def _filter_by_distance(
        self, points: List[Point], reference: Coordinates, max_distance_km: float
    ) -> List[Point]:
        """Filter points by distance from reference point."""
        filtered = []

        for point in points:
            distance = point.coordinates.distance_to(reference)
            if distance <= max_distance_km:
                filtered.append(point)

        self.logger.debug(
            "Distance filter applied",
            original=len(points),
            filtered=len(filtered),
            max_distance_km=max_distance_km
        )
        return filtered

    def _filter_by_bangumi(
        self, points: List[Point], bangumi_ids: List[str]
    ) -> List[Point]:
        """Filter points by specific bangumi IDs."""
        filtered = [p for p in points if p.bangumi_id in bangumi_ids]

        self.logger.debug(
            "Bangumi filter applied",
            original=len(points),
            filtered=len(filtered),
            bangumi_ids=bangumi_ids
        )
        return filtered

    def _rank_by_score(
        self, points: List[Point], preferences: Dict[str, Any]
    ) -> List[Point]:
        """Rank points by preference match score."""
        # Simple scoring: free admission gets higher score
        def score_point(point: Point) -> float:
            score = 0.0

            # Free admission bonus
            if point.admission_fee is None or point.admission_fee == "Free":
                score += 10.0

            # Has opening hours info bonus
            if point.opening_hours is not None:
                score += 2.0

            return score

        # Sort by score (descending)
        sorted_points = sorted(points, key=score_point, reverse=True)

        self.logger.debug(
            "Points ranked by score",
            count=len(sorted_points)
        )
        return sorted_points

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for FilterAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if points list is provided
        if "points" not in input_data.data:
            self.logger.error("No points provided in input")
            return False

        points = input_data.data.get("points")

        # Validate points is a list
        if not isinstance(points, list):
            self.logger.error(
                "Points must be a list",
                provided_type=type(points).__name__
            )
            return False

        # Validate each point can be converted to Point object
        for i, point_data in enumerate(points):
            if not isinstance(point_data, dict):
                self.logger.error(
                    "Each point must be a dictionary",
                    index=i,
                    provided_type=type(point_data).__name__
                )
                return False

            try:
                Point(**point_data)
            except Exception as e:
                self.logger.error(
                    "Invalid point data",
                    index=i,
                    error=str(e)
                )
                return False

        # Validate preferences if provided
        if "preferences" in input_data.data:
            prefs = input_data.data["preferences"]
            if not isinstance(prefs, dict):
                self.logger.error("Preferences must be a dictionary")
                return False

        return True