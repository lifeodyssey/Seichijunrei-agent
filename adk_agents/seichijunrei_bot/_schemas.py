"""Pydantic schemas for structured LlmAgent outputs in the pilgrimage workflow.

These schemas enforce strict JSON structure and enable automatic type validation
when used with LlmAgent's output_schema parameter. This ensures downstream
BaseAgents can safely access nested fields from session state.
"""

from pydantic import BaseModel, Field


class ExtractionResult(BaseModel):
    """Extracted bangumi name and location from user query."""

    bangumi_name: str = Field(
        description=(
            "Anime (bangumi) title extracted from the user query. "
            "Remove decorative brackets such as 《》 or 「」 and keep only the core title."
        )
    )
    location: str = Field(
        description=(
            "User's current location or the station/area name they want to depart from."
        )
    )


class BangumiResult(BaseModel):
    """Matched bangumi from Bangumi API search results."""

    bangumi_id: int = Field(description="Selected work's Bangumi subject ID.")
    bangumi_title: str = Field(description="Original Japanese title of the work.")
    bangumi_title_cn: str | None = Field(
        default=None,
        description="Chinese title of the work, if available.",
    )
    bangumi_confidence: float = Field(
        description="Match confidence between 0 and 1 (0 = no match, 1 = perfect match).",
        ge=0.0,
        le=1.0,
    )


class CoordinatesData(BaseModel):
    """Geographic coordinates."""

    latitude: float = Field(description="Latitude in decimal degrees.")
    longitude: float = Field(description="Longitude in decimal degrees.")


class StationInfo(BaseModel):
    """Station information with coordinates."""

    name: str = Field(description="Station name.")
    coordinates: CoordinatesData = Field(description="Station coordinates.")
    city: str | None = Field(default=None, description="City name.")
    prefecture: str | None = Field(default=None, description="Prefecture name.")


class LocationResult(BaseModel):
    """Resolved location with station info and user coordinates."""

    station: StationInfo | None = Field(
        default=None,
        description="Resolved station information, or null if lookup failed.",
    )
    user_coordinates: CoordinatesData = Field(
        description="User coordinates (usually the same as the station coordinates)."
    )
    search_radius_km: float = Field(
        default=5.0,
        description="Search radius in kilometers.",
    )


class BangumiCandidate(BaseModel):
    """Single Bangumi candidate work returned from search."""

    bangumi_id: int = Field(description="Bangumi subject ID for this work.")
    title: str = Field(description="Original Japanese title.")
    title_cn: str | None = Field(
        default=None,
        description="Chinese title, if available.",
    )
    air_date: str | None = Field(
        default=None,
        description='First air date in "YYYY-MM" format, if available.',
    )
    summary: str = Field(
        description="Short 1-2 sentence summary to help the user choose."
    )


class BangumiCandidatesResult(BaseModel):
    """Structured result for Bangumi search candidates shown to the user."""

    candidates: list[BangumiCandidate] = Field(
        default_factory=list,
        description="Top 3-5 Bangumi candidates selected for display.",
    )
    query: str = Field(
        description="Original search keyword inferred from the user query."
    )
    total: int = Field(
        description="Total number of results returned by the Bangumi API.",
    )


class UserSelectionResult(BaseModel):
    """User's final Bangumi selection from the candidates list."""

    bangumi_id: int = Field(description="Selected Bangumi subject ID.")
    bangumi_title: str = Field(description="Selected work's Japanese title.")
    bangumi_title_cn: str | None = Field(
        default=None,
        description="Selected work's Chinese title, if available.",
    )
    selection_confidence: float = Field(
        description="LLM-estimated confidence for this selection between 0 and 1.",
        ge=0.0,
        le=1.0,
    )


class SelectedPoint(BaseModel):
    """A single selected pilgrimage point from all_points.

    This model defines the structure of points selected by PointsSelectionAgent.
    Using an explicit Pydantic model instead of dict avoids the Gemini API's
    additionalProperties limitation.

    All fields are Optional because different data sources may have incomplete
    point information. The LLM should preserve all available fields from the
    original all_points data.
    """

    id: str | None = Field(
        default=None,
        description="Point ID from Anitabi API.",
    )
    name: str | None = Field(
        default=None,
        description="Point name (usually in Japanese).",
    )
    cn_name: str | None = Field(
        default=None,
        description="Chinese name if available.",
    )
    lat: float | None = Field(
        default=None,
        description="Latitude in decimal degrees.",
    )
    lng: float | None = Field(
        default=None,
        description="Longitude in decimal degrees.",
    )
    episode: int | None = Field(
        default=None,
        description="Episode number where this location appears.",
    )
    time_seconds: int | None = Field(
        default=None,
        description="Timestamp in seconds within the episode.",
    )
    screenshot_url: str | None = Field(
        default=None,
        description="URL to screenshot from the anime.",
    )
    address: str | None = Field(
        default=None,
        description="Street address or location description.",
    )


class PointsSelectionResult(BaseModel):
    """LLM-driven intelligent selection over all available pilgrimage points.

    Uses SelectedPoint model instead of dict to avoid Gemini API's
    additionalProperties limitation.
    """

    selected_points: list[SelectedPoint] = Field(
        default_factory=list,
        description="Selected pilgrimage points (8-12 items) taken from all_points.",
    )
    selection_rationale: str = Field(
        description="2-3 sentence explanation of why these points were chosen."
    )
    estimated_coverage: str = Field(
        description='Estimated episode coverage range, e.g. "episodes 1-6".'
    )
    total_available: int = Field(
        description="Total number of available points before selection.",
    )
    rejected_count: int = Field(
        description="Number of points not selected (total_available - len(selected_points)).",
    )


class RoutePlan(BaseModel):
    """Final user-facing route planning result."""

    recommended_order: list[str] = Field(
        description="Recommended ordered list of point names for the pilgrimage route."
    )
    route_description: str = Field(
        description="Full natural language description of the route."
    )
    estimated_duration: str = Field(
        description='Estimated total duration, e.g. "approximately 4-5 hours".'
    )
    estimated_distance: str = Field(
        description='Estimated total distance, e.g. "approximately 6 kilometers".'
    )
    transport_tips: str = Field(
        description="High-level transport guidance for the route."
    )
    special_notes: list[str] = Field(
        default_factory=list,
        description="Any special notes such as opening hours, ticket tips, etc.",
    )
