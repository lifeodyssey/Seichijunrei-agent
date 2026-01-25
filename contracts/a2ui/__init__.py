"""A2UI Contracts Package.

This package defines the A2UI (Agent-to-User Interface) protocol contracts
for the Seichijunrei bot.

Version: 0.1.0
"""

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
from .messages import A2UIMessage, BeginRenderingMessage, SurfaceUpdateMessage
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
    # Components
    "Component",
    "ComponentType",
    # Messages
    "A2UIMessage",
    "BeginRenderingMessage",
    "SurfaceUpdateMessage",
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
