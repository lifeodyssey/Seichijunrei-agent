"""A2UI Event Emitter.

Emits A2UI protocol events during agent execution.
Can be used server-side (recommended) or agent-side.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from contracts.a2ui import (
    A2UIMessage,
    Component,
    SurfaceId,
    ViewName,
)
from contracts.a2ui.messages import begin_rendering, surface_update
from utils.logger import get_logger

logger = get_logger(__name__)


class A2UIEventSink(ABC):
    """Abstract sink for A2UI events.

    Implementations can send events via WebSocket, SSE, or queue them.
    """

    @abstractmethod
    async def emit(self, message: A2UIMessage) -> None:
        """Emit a single A2UI message."""
        ...

    @abstractmethod
    async def emit_batch(self, messages: list[A2UIMessage]) -> None:
        """Emit multiple A2UI messages."""
        ...


class LoggingEventSink(A2UIEventSink):
    """Event sink that logs events (for debugging)."""

    async def emit(self, message: A2UIMessage) -> None:
        logger.debug("A2UI event", message_type=message.get("type"))

    async def emit_batch(self, messages: list[A2UIMessage]) -> None:
        logger.debug("A2UI event batch", count=len(messages))


class QueueEventSink(A2UIEventSink):
    """Event sink that queues events for later retrieval."""

    def __init__(self) -> None:
        self._queue: list[A2UIMessage] = []

    async def emit(self, message: A2UIMessage) -> None:
        self._queue.append(message)

    async def emit_batch(self, messages: list[A2UIMessage]) -> None:
        self._queue.extend(messages)

    def drain(self) -> list[A2UIMessage]:
        """Get and clear all queued events."""
        events = self._queue.copy()
        self._queue.clear()
        return events


class A2UIEventEmitter:
    """Emitter for A2UI protocol events.

    Usage:
        emitter = A2UIEventEmitter(sink)
        await emitter.update_surface("main", components, root_id="welcome")
        await emitter.show_view(ViewName.CANDIDATES, state)
    """

    def __init__(self, sink: A2UIEventSink) -> None:
        self._sink = sink

    async def update_surface(
        self,
        surface_id: str | SurfaceId,
        components: list[Component],
        *,
        root_id: str,
    ) -> None:
        """Update a surface with new components and begin rendering.

        Args:
            surface_id: Target surface identifier
            components: List of components to render
            root_id: Root component ID for rendering
        """
        surface = surface_id.value if isinstance(surface_id, SurfaceId) else surface_id
        messages = [
            surface_update(surface, components),
            begin_rendering(surface, root_id),
        ]
        await self._sink.emit_batch(messages)
        logger.debug(
            "Surface updated",
            surface_id=surface,
            component_count=len(components),
            root_id=root_id,
        )

    async def show_view(
        self,
        view_name: ViewName,
        state: dict[str, Any],
    ) -> None:
        """Show a predefined view based on current state.

        This is a convenience method that uses the presenter to build
        the appropriate components for a view.

        Args:
            view_name: Name of the view to show
            state: Current session state
        """
        from interfaces.a2ui_web.presenter import build_a2ui_response

        _, messages = build_a2ui_response(state)
        for msg in messages:
            await self._sink.emit(msg)

        logger.debug(
            "View shown",
            view_name=view_name.value,
            message_count=len(messages),
        )

    async def emit_raw(self, message: A2UIMessage) -> None:
        """Emit a raw A2UI message.

        Use this for custom messages not covered by helper methods.
        """
        await self._sink.emit(message)


def create_emitter(sink: A2UIEventSink | None = None) -> A2UIEventEmitter:
    """Create an A2UI event emitter.

    Args:
        sink: Event sink (defaults to logging sink)

    Returns:
        Configured emitter
    """
    if sink is None:
        sink = LoggingEventSink()
    return A2UIEventEmitter(sink)
