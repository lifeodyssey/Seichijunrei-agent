"""Typed runtime output models for journey-stage responses.

These models define the contract between the runtime and the frontend.
Each model corresponds to a stage in the frontend journey.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from backend.agents.models import TimedItinerary


class ClarifyCandidateModel(BaseModel):
    """A single clarify candidate with optional enrichment."""

    title: str
    cover_url: str | None = None
    spot_count: int = 0
    city: str = ""


class ClarifyDataModel(BaseModel):
    """Data payload for clarify stage."""

    status: Literal["needs_clarification"]
    question: str
    options: list[str] = Field(default_factory=list)
    candidates: list[ClarifyCandidateModel] = Field(default_factory=list)


class ClarifyResponseModel(BaseModel):
    """Full response for clarify stage."""

    intent: Literal["clarify"]
    message: str
    data: ClarifyDataModel
    ui: dict[str, str] | None = None


class PilgrimagePointModel(BaseModel):
    """A single pilgrimage point row returned to the frontend."""

    id: str
    name: str
    name_cn: str | None = None
    episode: int | None = None
    time_seconds: int | None = None
    screenshot_url: str | None = None
    bangumi_id: str | None = None
    latitude: float
    longitude: float
    title: str | None = None
    title_cn: str | None = None
    distance_m: float | None = None
    origin: str | None = None
    # Backend convenience: used to populate nearby_groups cover and route cover_url.
    cover_url: str | None = None


class NearbyGroupModel(BaseModel):
    """A nearby anime group card."""

    bangumi_id: str
    title: str
    cover_url: str | None = None
    points_count: int = 0
    closest_distance_m: float = 0


class ResultsMetaModel(BaseModel):
    """Search results meta container (rows + summary fields)."""

    rows: list[PilgrimagePointModel] = Field(default_factory=list)
    row_count: int = 0
    strategy: str | None = None
    status: Literal["ok", "empty"] | None = None
    metadata: dict[str, object] | None = None
    summary: dict[str, object] | None = None
    nearby_groups: list[NearbyGroupModel] = Field(default_factory=list)


class SearchDataModel(BaseModel):
    """Data payload for search stage."""

    results: ResultsMetaModel


class SearchResponseModel(BaseModel):
    """Full response for search stage."""

    intent: Literal["search_bangumi", "search_nearby"]
    message: str
    data: SearchDataModel
    ui: dict[str, str] | None = None


class RouteModel(BaseModel):
    """Route container for route stage."""

    ordered_points: list[PilgrimagePointModel] = Field(default_factory=list)
    point_count: int = 0
    cover_url: str | None = None
    anime_title: str | None = None
    anime_title_cn: str | None = None
    status: Literal["ok", "empty"] | None = None
    summary: dict[str, object] | None = None
    timed_itinerary: TimedItinerary


class RouteDataModel(BaseModel):
    """Data payload for route stage."""

    route: RouteModel


class RouteResponseModel(BaseModel):
    """Full response for route stage."""

    intent: Literal["plan_route", "plan_selected"]
    message: str
    data: RouteDataModel
    ui: dict[str, str] | None = None


class QADataModel(BaseModel):
    """Data payload for QA/greet stage."""

    status: Literal["info", "needs_clarification"] = "info"
    message: str = ""


class QAResponseModel(BaseModel):
    """Full response for QA stage."""

    intent: Literal["general_qa", "answer_question"]
    message: str
    data: QADataModel = Field(default_factory=QADataModel)
    ui: dict[str, str] | None = None


class GreetingResponseModel(BaseModel):
    """Full response for greeting stage."""

    intent: Literal["greet_user"]
    message: str
    data: QADataModel = Field(default_factory=QADataModel)
    ui: dict[str, str] | None = None


RuntimeStageOutput = (
    ClarifyResponseModel
    | SearchResponseModel
    | RouteResponseModel
    | QAResponseModel
    | GreetingResponseModel
)
