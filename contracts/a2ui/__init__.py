"""A2UI Contracts Package.

This package defines the A2UI (Agent-to-User Interface) protocol contracts
for the Seichijunrei bot.

Version: 0.1.0
"""

from .action_ids import (
    BACK,
    OPEN_URL_PREFIX,
    REMOVE_POINT_PREFIX,
    RESET,
    SELECT_CANDIDATE_PREFIX,
    SEND_TEXT_PREFIX,
    extract_candidate_index,
    extract_point_index,
    extract_text,
    extract_url,
    is_open_url,
    is_remove_point,
    is_select_candidate,
    is_send_text,
    open_url,
    remove_point,
    select_candidate,
    send_text,
)
from .actions import (
    ActionName,
    ActionPayload,
    make_open_url_action,
    make_remove_point_action,
    make_select_candidate_action,
    make_send_text_action,
    parse_action,
)
from .components import Component, ComponentType
from .message_types import (
    MessageType,
    create_begin_rendering,
    create_message_pair,
    create_surface_update,
    get_components,
    get_message_type,
    get_root_id,
    get_surface_id,
    is_begin_rendering,
    is_surface_update,
)
from .messages import A2UIMessage, BeginRenderingMessage, SurfaceUpdateMessage
from .payloads import (
    BangumiCandidatePayload,
    BangumiCandidatesPayload,
    ExtractionResultPayload,
    PointPayload,
    PointsSelectionPayload,
    RoutePlanPayload,
    SelectedBangumiPayload,
    SessionStatePayload,
)
from .session import (
    InMemorySessionStore,
    SessionError,
    SessionExpiredError,
    SessionInfo,
    SessionNotFoundError,
    SessionState,
    SessionStateError,
    SessionStore,
)
from .types import SurfaceId, ViewName

__all__ = [
    # Actions
    "ActionName",
    "ActionPayload",
    "parse_action",
    "make_select_candidate_action",
    "make_remove_point_action",
    "make_send_text_action",
    "make_open_url_action",
    # Action IDs
    "RESET",
    "BACK",
    "SELECT_CANDIDATE_PREFIX",
    "REMOVE_POINT_PREFIX",
    "OPEN_URL_PREFIX",
    "SEND_TEXT_PREFIX",
    "select_candidate",
    "remove_point",
    "open_url",
    "send_text",
    "is_select_candidate",
    "is_remove_point",
    "is_open_url",
    "is_send_text",
    "extract_candidate_index",
    "extract_point_index",
    "extract_url",
    "extract_text",
    # Components
    "Component",
    "ComponentType",
    # Message Types
    "MessageType",
    "create_surface_update",
    "create_begin_rendering",
    "create_message_pair",
    "is_surface_update",
    "is_begin_rendering",
    "get_message_type",
    "get_surface_id",
    "get_components",
    "get_root_id",
    # Messages
    "A2UIMessage",
    "BeginRenderingMessage",
    "SurfaceUpdateMessage",
    # Payloads
    "BangumiCandidatePayload",
    "BangumiCandidatesPayload",
    "ExtractionResultPayload",
    "PointPayload",
    "PointsSelectionPayload",
    "RoutePlanPayload",
    "SelectedBangumiPayload",
    "SessionStatePayload",
    # Types
    "SurfaceId",
    "ViewName",
    # Session
    "SessionStore",
    "SessionInfo",
    "InMemorySessionStore",
    "SessionState",
    "SessionError",
    "SessionNotFoundError",
    "SessionExpiredError",
    "SessionStateError",
]
