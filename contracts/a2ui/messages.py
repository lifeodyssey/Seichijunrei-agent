"""A2UI Message Definitions.

Messages are the top-level communication protocol between agent and UI.

A2UI Message Protocol (v0.1.0)
"""

from typing import TypedDict

from .components import Component


class SurfaceUpdateMessage(TypedDict):
    """Update a surface with new components.

    This message replaces all components on the specified surface.
    """

    surfaceUpdate: "SurfaceUpdatePayload"


class SurfaceUpdatePayload(TypedDict):
    """Payload for surfaceUpdate message."""

    surfaceId: str  # Surface to update
    components: list[Component]  # All components for the surface


class BeginRenderingMessage(TypedDict):
    """Signal that a surface is ready to render.

    This message must be sent after surfaceUpdate to trigger rendering.
    The root component ID determines the entry point for the component tree.
    """

    beginRendering: "BeginRenderingPayload"


class BeginRenderingPayload(TypedDict):
    """Payload for beginRendering message."""

    surfaceId: str  # Surface to render
    root: str  # Root component ID


# Union type for all A2UI messages
A2UIMessage = SurfaceUpdateMessage | BeginRenderingMessage


# --- Builder Functions ---


def surface_update(
    surface_id: str, components: list[Component]
) -> SurfaceUpdateMessage:
    """Build a surfaceUpdate message.

    Args:
        surface_id: Target surface ID
        components: List of components to display

    Returns:
        A surfaceUpdate message
    """
    return {
        "surfaceUpdate": {
            "surfaceId": surface_id,
            "components": components,
        }
    }


def begin_rendering(surface_id: str, root_id: str) -> BeginRenderingMessage:
    """Build a beginRendering message.

    Args:
        surface_id: Target surface ID
        root_id: ID of the root component in the component tree

    Returns:
        A beginRendering message
    """
    return {
        "beginRendering": {
            "surfaceId": surface_id,
            "root": root_id,
        }
    }


def build_surface_messages(
    surface_id: str, components: list[Component], *, root_id: str
) -> list[A2UIMessage]:
    """Build the standard message sequence for a surface update.

    The A2UI protocol requires:
    1. surfaceUpdate - to define the components
    2. beginRendering - to trigger rendering

    Args:
        surface_id: Target surface ID
        components: List of components to display
        root_id: ID of the root component

    Returns:
        List of [surfaceUpdate, beginRendering] messages
    """
    return [
        surface_update(surface_id, components),
        begin_rendering(surface_id, root_id),
    ]
