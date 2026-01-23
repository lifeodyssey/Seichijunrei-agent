"""Unit tests for A2UI event emitter."""

import pytest

from contracts.a2ui import SurfaceId
from contracts.a2ui.components import button, text
from interfaces.a2ui_web.emitter import (
    A2UIEventEmitter,
    LoggingEventSink,
    QueueEventSink,
    create_emitter,
)


class TestQueueEventSink:
    """Tests for QueueEventSink."""

    @pytest.mark.asyncio
    async def test_emit_adds_to_queue(self):
        """Test that emit adds message to queue."""
        sink = QueueEventSink()
        message = {"type": "test", "data": "value"}
        await sink.emit(message)

        events = sink.drain()
        assert len(events) == 1
        assert events[0] == message

    @pytest.mark.asyncio
    async def test_emit_batch_adds_all(self):
        """Test that emit_batch adds all messages."""
        sink = QueueEventSink()
        messages = [{"type": "test1"}, {"type": "test2"}, {"type": "test3"}]
        await sink.emit_batch(messages)

        events = sink.drain()
        assert len(events) == 3

    def test_drain_clears_queue(self):
        """Test that drain clears the queue."""
        sink = QueueEventSink()
        sink._queue = [{"type": "test"}]

        events = sink.drain()
        assert len(events) == 1
        assert len(sink._queue) == 0


class TestLoggingEventSink:
    """Tests for LoggingEventSink."""

    @pytest.mark.asyncio
    async def test_emit_does_not_raise(self):
        """Test that emit doesn't raise."""
        sink = LoggingEventSink()
        await sink.emit({"type": "test"})  # Should not raise

    @pytest.mark.asyncio
    async def test_emit_batch_does_not_raise(self):
        """Test that emit_batch doesn't raise."""
        sink = LoggingEventSink()
        await sink.emit_batch([{"type": "test1"}, {"type": "test2"}])


class TestA2UIEventEmitter:
    """Tests for A2UIEventEmitter."""

    @pytest.fixture
    def sink(self):
        """Create a queue sink for testing."""
        return QueueEventSink()

    @pytest.fixture
    def emitter(self, sink):
        """Create an emitter with queue sink."""
        return A2UIEventEmitter(sink)

    @pytest.mark.asyncio
    async def test_update_surface_emits_two_messages(self, emitter, sink):
        """Test that update_surface emits surface_update and begin_rendering."""
        components = [
            text("msg-1", "Hello"),
            button("btn-1", "Click", "action_1"),
        ]
        await emitter.update_surface("main", components, root_id="root")

        events = sink.drain()
        assert len(events) == 2
        # First should be surfaceUpdate message
        assert "surfaceUpdate" in events[0]
        assert events[0]["surfaceUpdate"]["surfaceId"] == "main"
        assert len(events[0]["surfaceUpdate"]["components"]) == 2
        # Second should be beginRendering message
        assert "beginRendering" in events[1]
        assert events[1]["beginRendering"]["surfaceId"] == "main"
        assert events[1]["beginRendering"]["root"] == "root"

    @pytest.mark.asyncio
    async def test_update_surface_with_surface_id_enum(self, emitter, sink):
        """Test update_surface works with SurfaceId enum."""
        await emitter.update_surface(
            SurfaceId.MAIN,
            [text("msg-1", "Test")],
            root_id="root",
        )

        events = sink.drain()
        assert events[0]["surfaceUpdate"]["surfaceId"] == "main"

    @pytest.mark.asyncio
    async def test_emit_raw(self, emitter, sink):
        """Test emit_raw passes message through."""
        custom_message = {"type": "custom", "data": "value"}
        await emitter.emit_raw(custom_message)

        events = sink.drain()
        assert len(events) == 1
        assert events[0] == custom_message


class TestCreateEmitter:
    """Tests for create_emitter factory."""

    def test_creates_with_default_sink(self):
        """Test creating emitter with default sink."""
        emitter = create_emitter()
        assert emitter is not None
        assert isinstance(emitter._sink, LoggingEventSink)

    def test_creates_with_custom_sink(self):
        """Test creating emitter with custom sink."""
        sink = QueueEventSink()
        emitter = create_emitter(sink)
        assert emitter._sink is sink
