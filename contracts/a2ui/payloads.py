"""A2UI Payload Schemas.

Defines the payload structures for A2UI messages and actions.

A2UI Payloads Contract (v0.1.0)
"""

from typing import Any, TypedDict

# --- Action Payloads ---


class BaseActionPayload(TypedDict, total=False):
    """Base payload for all actions."""

    action_name: str


class SelectCandidatePayload(BaseActionPayload):
    """Payload for select_candidate_{n} action."""

    index: int  # 1-based candidate index


class RemovePointPayload(BaseActionPayload):
    """Payload for remove_point_{n} action."""

    index: int  # 0-based point index


class SendTextPayload(BaseActionPayload):
    """Payload for send_text:{text} action."""

    text: str


class OpenUrlPayload(BaseActionPayload):
    """Payload for open_url:{url} action."""

    url: str


class ResetPayload(BaseActionPayload):
    """Payload for reset action."""

    pass


class BackPayload(BaseActionPayload):
    """Payload for back action."""

    pass


# Union of all action payloads
ActionPayloadUnion = (
    SelectCandidatePayload
    | RemovePointPayload
    | SendTextPayload
    | OpenUrlPayload
    | ResetPayload
    | BackPayload
)


# --- Message Payloads ---


class SurfaceUpdatePayload(TypedDict):
    """Payload for surfaceUpdate message."""

    surfaceId: str
    components: list[dict[str, Any]]


class BeginRenderingPayload(TypedDict):
    """Payload for beginRendering message."""

    surfaceId: str
    root: str


# --- Component Payloads ---


class LiteralStringValue(TypedDict):
    """Wrapper for literal string values."""

    literalString: str


class ChildrenListValue(TypedDict):
    """Wrapper for children list values."""

    explicitList: list[str]


class TextComponentPayload(TypedDict, total=False):
    """Payload for Text component."""

    text: LiteralStringValue
    usageHint: str  # h1, h2, h3, h4, body, caption


class DividerComponentPayload(TypedDict):
    """Payload for Divider component."""

    axis: str  # horizontal, vertical


class ImageComponentPayload(TypedDict):
    """Payload for Image component."""

    url: LiteralStringValue


class RowComponentPayload(TypedDict, total=False):
    """Payload for Row component."""

    children: ChildrenListValue
    distribution: str  # start, center, end, space-between, space-around
    alignment: str  # start, center, end, stretch


class ColumnComponentPayload(TypedDict, total=False):
    """Payload for Column component."""

    children: ChildrenListValue
    distribution: str
    alignment: str


class CardComponentPayload(TypedDict):
    """Payload for Card component."""

    content: str  # ID of content component
    # Note: Some implementations use 'child' instead of 'content'


class ButtonActionPayload(TypedDict):
    """Action payload within Button component."""

    name: str


class ButtonComponentPayload(TypedDict, total=False):
    """Payload for Button component."""

    child: str  # ID of label component
    action: ButtonActionPayload
    primary: bool


# --- State Payloads ---


class BangumiCandidatePayload(TypedDict, total=False):
    """Payload for a single bangumi candidate."""

    id: int
    title: str
    title_cn: str
    air_date: str
    summary: str
    image: str


class BangumiCandidatesPayload(TypedDict):
    """Payload for bangumi_candidates state."""

    query: str
    candidates: list[BangumiCandidatePayload]


class PointPayload(TypedDict, total=False):
    """Payload for a single pilgrimage point."""

    name: str
    cn_name: str
    address: str
    lat: float
    lng: float
    episode: int
    time_seconds: int
    screenshot_url: str
    image: str
    photo: str


class RoutePlanPayload(TypedDict, total=False):
    """Payload for route_plan state."""

    recommended_order: list[str]
    estimated_duration: str
    estimated_distance: str
    transport_tips: str
    route_description: str
    special_notes: list[str]


class PointsSelectionPayload(TypedDict, total=False):
    """Payload for points_selection_result state."""

    selected_points: list[PointPayload]
    selection_rationale: str
    total_available: int
    rejected_count: int


class SelectedBangumiPayload(TypedDict, total=False):
    """Payload for selected_bangumi state."""

    bangumi_id: int
    bangumi_title: str
    bangumi_title_cn: str


class ExtractionResultPayload(TypedDict, total=False):
    """Payload for extraction_result state."""

    location: str
    user_language: str
    bangumi_query: str


# --- Session State Payload ---


class SessionStatePayload(TypedDict, total=False):
    """Complete session state payload."""

    bangumi_candidates: BangumiCandidatesPayload
    selected_bangumi: SelectedBangumiPayload
    extraction_result: ExtractionResultPayload
    points_selection_result: PointsSelectionPayload
    route_plan: RoutePlanPayload
