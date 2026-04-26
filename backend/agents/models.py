"""Shared agent types — single source of truth for tool and retrieval models.

No LLM logic here. These models cross boundaries (agent -> handlers -> retriever).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ToolName(str, Enum):
    """Tool identifiers used by the pilgrimage agent and handlers."""

    RESOLVE_ANIME = "resolve_anime"
    SEARCH_BANGUMI = "search_bangumi"
    SEARCH_NEARBY = "search_nearby"
    PLAN_ROUTE = "plan_route"
    PLAN_SELECTED = "plan_selected"
    ANSWER_QUESTION = "answer_question"
    GREET_USER = "greet_user"
    CLARIFY = "clarify"


class PlanStep(BaseModel):
    """A tool invocation with parameters, used by handler functions."""

    tool: ToolName
    params: dict[str, object] = Field(default_factory=dict)
    parallel: bool = False


class RetrievalRequest(BaseModel):
    """Normalized retrieval request passed to Retriever and SQLAgent.

    Replaces IntentOutput throughout the retrieval stack.
    """

    tool: Literal["search_bangumi", "search_nearby"]
    bangumi_id: str | None = None
    episode: int | None = None
    location: str | None = None
    origin: str | None = None
    radius: int | None = None
    force_refresh: bool = False


class ResolvedLocation(BaseModel):
    """Result of fuzzy location name resolution."""

    matched_key: str | None = Field(
        description="Exact key from KNOWN_LOCATIONS, or null if no match"
    )


class LocationCluster(BaseModel):
    """A physical location grouping multiple anime screenshot points."""

    center_lat: float
    center_lng: float
    points: list[dict[str, object]] = Field(default_factory=list)
    photo_count: int = 0
    cluster_id: str = ""


class TimedStop(BaseModel):
    """A stop on the route with arrival/departure times and dwell duration."""

    cluster_id: str
    name: str
    arrive: str  # "HH:MM"
    depart: str  # "HH:MM"
    dwell_minutes: int
    lat: float
    lng: float
    photo_count: int
    points: list[dict[str, object]] = Field(default_factory=list)


class TransitLeg(BaseModel):
    """A walking segment between two stops."""

    from_id: str
    to_id: str
    mode: Literal["walk"]
    duration_minutes: int
    distance_m: float


class TimedItinerary(BaseModel):
    """Complete timed route with stops, transit legs, and export data."""

    stops: list[TimedStop] = Field(default_factory=list)
    legs: list[TransitLeg] = Field(default_factory=list)
    total_minutes: int = 0
    total_distance_m: float = 0.0
    spot_count: int = 0
    pacing: Literal["chill", "normal", "packed"] = "normal"
    start_time: str = "09:00"
    export_google_maps_url: list[str] = Field(default_factory=list)
    export_ics: str = ""
