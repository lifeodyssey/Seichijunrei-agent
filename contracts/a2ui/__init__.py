"""A2UI Contracts Package.

This package defines the A2UI (Agent-to-User Interface) protocol contracts
for the Seichijunrei bot.

Version: 0.1.0
"""

from .actions import ActionName, ActionPayload
from .components import Component, ComponentType
from .messages import A2UIMessage, BeginRenderingMessage, SurfaceUpdateMessage
from .session import InMemorySessionStore, SessionInfo, SessionStore
from .types import SurfaceId, ViewName

__all__ = [
    # Actions
    "ActionName",
    "ActionPayload",
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
]
