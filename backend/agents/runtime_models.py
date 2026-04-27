"""Typed runtime output models for journey-stage responses.

These models define the contract between the runtime and the frontend.
Each model corresponds to a stage in the frontend journey.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from backend.agents.models import TimedItinerary


class ClarifyCandidateModel(BaseModel):
    """A single clarify candidate with optional enrichment."""

    title: str
    cover_url: str = ""
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
    ui: dict[str, str] = Field(default_factory=dict)


def _coerce_str(v: object) -> str:
    """Coerce None to empty string for nullable DB columns."""
    return str(v) if v is not None else ""


class PilgrimagePointModel(BaseModel):
    """A single pilgrimage point row returned to the frontend."""

    model_config = {"coerce_numbers_to_str": False}

    id: str
    name: str
    name_cn: str = ""
    episode: int = -1
    time_seconds: int = -1
    screenshot_url: str = ""
    bangumi_id: str = ""
    latitude: float
    longitude: float
    title: str = ""
    title_cn: str = ""
    distance_m: float = -1.0
    origin: str = ""
    # Backend convenience: used to populate nearby_groups cover and route cover_url.
    cover_url: str = ""

    @field_validator(
        "name_cn",
        "screenshot_url",
        "bangumi_id",
        "title",
        "title_cn",
        "origin",
        "cover_url",
        mode="before",
    )
    @classmethod
    def coerce_none_to_empty(cls, v: object) -> str:
        return _coerce_str(v)


class NearbyGroupModel(BaseModel):
    """A nearby anime group card."""

    bangumi_id: str
    title: str
    cover_url: str = ""
    points_count: int = 0
    closest_distance_m: float = 0


class ResultsMetadataModel(BaseModel):
    """Typed metadata returned alongside search results."""

    anime_title: str = ""
    anime_title_cn: str = ""
    cover_url: str = ""
    radius_m: int = -1
    data_origin: str = ""
    source: str = ""
    cache: str = ""

    model_config = {"extra": "allow"}


class ResultsSummaryModel(BaseModel):
    """Typed summary for search/route results."""

    count: int = 0
    source: str = "db"
    cache: str = "miss"


class ResultsMetaModel(BaseModel):
    """Search results meta container (rows + summary fields)."""

    rows: list[PilgrimagePointModel] = Field(default_factory=list)
    row_count: int = 0
    strategy: str = ""
    status: str = "ok"
    metadata: ResultsMetadataModel = Field(default_factory=ResultsMetadataModel)
    summary: ResultsSummaryModel = Field(default_factory=ResultsSummaryModel)
    nearby_groups: list[NearbyGroupModel] = Field(default_factory=list)


class SearchDataModel(BaseModel):
    """Data payload for search stage."""

    results: ResultsMetaModel


class SearchResponseModel(BaseModel):
    """Full response for search stage."""

    intent: Literal["search_bangumi", "search_nearby"]
    message: str
    data: SearchDataModel
    ui: dict[str, str] = Field(default_factory=dict)


class RouteModel(BaseModel):
    """Route container for route stage."""

    ordered_points: list[PilgrimagePointModel] = Field(default_factory=list)
    point_count: int = 0
    cover_url: str = ""
    anime_title: str = ""
    anime_title_cn: str = ""
    status: str = "ok"
    summary: ResultsSummaryModel = Field(default_factory=ResultsSummaryModel)
    timed_itinerary: TimedItinerary = Field(default_factory=TimedItinerary)


class RouteDataModel(BaseModel):
    """Data payload for route stage."""

    route: RouteModel


class RouteResponseModel(BaseModel):
    """Full response for route stage."""

    intent: Literal["plan_route", "plan_selected"]
    message: str
    data: RouteDataModel
    ui: dict[str, str] = Field(default_factory=dict)


class QADataModel(BaseModel):
    """Data payload for QA/greet stage."""

    status: Literal["info", "needs_clarification"] = "info"
    message: str = ""


class QAResponseModel(BaseModel):
    """Full response for QA stage."""

    intent: Literal["general_qa"]
    message: str
    data: QADataModel = Field(default_factory=QADataModel)
    ui: dict[str, str] = Field(default_factory=dict)


class GreetingResponseModel(BaseModel):
    """Full response for greeting stage."""

    intent: Literal["greet_user"]
    message: str
    data: QADataModel = Field(default_factory=QADataModel)
    ui: dict[str, str] = Field(default_factory=dict)


RuntimeStageOutput = (
    ClarifyResponseModel
    | SearchResponseModel
    | RouteResponseModel
    | QAResponseModel
    | GreetingResponseModel
)
