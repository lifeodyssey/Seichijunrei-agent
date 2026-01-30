"""A2UI Message Type Definitions.

Defines the message types used in the A2UI protocol.

A2UI Message Types Contract (v0.1.0)
"""

from enum import Enum
from typing import Any, TypedDict


class MessageType(str, Enum):
    """A2UI message types."""

    SURFACE_UPDATE = "surfaceUpdate"
    """Update a surface with new components."""

    BEGIN_RENDERING = "beginRendering"
    """Signal that a surface is ready to render."""


# --- Message Structures ---


class SurfaceUpdateContent(TypedDict):
    """Content of a surfaceUpdate message."""

    surfaceId: str
    components: list[dict[str, Any]]


class BeginRenderingContent(TypedDict):
    """Content of a beginRendering message."""

    surfaceId: str
    root: str


class SurfaceUpdateMessage(TypedDict):
    """A surfaceUpdate message."""

    surfaceUpdate: SurfaceUpdateContent


class BeginRenderingMessage(TypedDict):
    """A beginRendering message."""

    beginRendering: BeginRenderingContent


# Union of all message types
A2UIMessage = SurfaceUpdateMessage | BeginRenderingMessage


# --- Type Guards ---


def is_surface_update(msg: dict[str, Any]) -> bool:
    """Check if message is a surfaceUpdate."""
    return "surfaceUpdate" in msg


def is_begin_rendering(msg: dict[str, Any]) -> bool:
    """Check if message is a beginRendering."""
    return "beginRendering" in msg


def get_message_type(msg: dict[str, Any]) -> MessageType | None:
    """Get the type of an A2UI message."""
    if is_surface_update(msg):
        return MessageType.SURFACE_UPDATE
    if is_begin_rendering(msg):
        return MessageType.BEGIN_RENDERING
    return None


# --- Message Builders ---


def create_surface_update(
    surface_id: str,
    components: list[dict[str, Any]],
) -> SurfaceUpdateMessage:
    """Create a surfaceUpdate message."""
    return {
        "surfaceUpdate": {
            "surfaceId": surface_id,
            "components": components,
        }
    }


def create_begin_rendering(
    surface_id: str,
    root_id: str,
) -> BeginRenderingMessage:
    """Create a beginRendering message."""
    return {
        "beginRendering": {
            "surfaceId": surface_id,
            "root": root_id,
        }
    }


def create_message_pair(
    surface_id: str,
    components: list[dict[str, Any]],
    root_id: str,
) -> list[A2UIMessage]:
    """Create the standard surfaceUpdate + beginRendering pair."""
    return [
        create_surface_update(surface_id, components),
        create_begin_rendering(surface_id, root_id),
    ]


# --- Message Extractors ---


def get_surface_id(msg: A2UIMessage) -> str | None:
    """Extract surface ID from any A2UI message."""
    if is_surface_update(msg):
        return msg["surfaceUpdate"]["surfaceId"]  # type: ignore
    if is_begin_rendering(msg):
        return msg["beginRendering"]["surfaceId"]  # type: ignore
    return None


def get_components(msg: A2UIMessage) -> list[dict[str, Any]] | None:
    """Extract components from a surfaceUpdate message."""
    if is_surface_update(msg):
        return msg["surfaceUpdate"]["components"]  # type: ignore
    return None


def get_root_id(msg: A2UIMessage) -> str | None:
    """Extract root ID from a beginRendering message."""
    if is_begin_rendering(msg):
        return msg["beginRendering"]["root"]  # type: ignore
    return None
