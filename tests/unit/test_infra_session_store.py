"""Unit tests for infrastructure session stores."""

import pytest

from infrastructure.session import (
    InMemorySessionStore,
    SessionStore,
    create_session_store,
)


class TestInMemorySessionStore:
    """Tests for InMemorySessionStore."""

    @pytest.fixture
    def store(self) -> InMemorySessionStore:
        """Create a fresh session store."""
        return InMemorySessionStore()

    @pytest.mark.asyncio
    async def test_get_returns_none_for_missing(self, store: InMemorySessionStore):
        """Test that get returns None for missing session."""
        result = await store.get("nonexistent")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_and_get(self, store: InMemorySessionStore):
        """Test setting and getting session state."""
        state = {"key": "value", "count": 42}
        await store.set("session-1", state)

        result = await store.get("session-1")
        assert result == state

    @pytest.mark.asyncio
    async def test_set_overwrites_existing(self, store: InMemorySessionStore):
        """Test that set overwrites existing state."""
        await store.set("session-1", {"old": "data"})
        await store.set("session-1", {"new": "data"})

        result = await store.get("session-1")
        assert result == {"new": "data"}

    @pytest.mark.asyncio
    async def test_delete_removes_session(self, store: InMemorySessionStore):
        """Test deleting a session."""
        await store.set("session-1", {"key": "value"})
        await store.delete("session-1")

        result = await store.get("session-1")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_is_safe(self, store: InMemorySessionStore):
        """Test deleting a nonexistent session doesn't raise."""
        await store.delete("nonexistent")  # Should not raise

    @pytest.mark.asyncio
    async def test_exists(self, store: InMemorySessionStore):
        """Test checking if session exists."""
        assert await store.exists("session-1") is False

        await store.set("session-1", {"key": "value"})
        assert await store.exists("session-1") is True

    @pytest.mark.asyncio
    async def test_list_sessions(self, store: InMemorySessionStore):
        """Test listing all sessions."""
        await store.set("session-1", {})
        await store.set("session-2", {})
        await store.set("session-3", {})

        sessions = await store.list_sessions()
        assert len(sessions) == 3
        assert "session-1" in sessions
        assert "session-2" in sessions
        assert "session-3" in sessions

    @pytest.mark.asyncio
    async def test_list_sessions_with_limit(self, store: InMemorySessionStore):
        """Test listing sessions with limit."""
        for i in range(10):
            await store.set(f"session-{i}", {})

        sessions = await store.list_sessions(limit=5)
        assert len(sessions) == 5

    def test_clear_all(self, store: InMemorySessionStore):
        """Test clearing all sessions."""
        store._sessions["session-1"] = {"key": "value"}
        store._sessions["session-2"] = {"key": "value"}

        store.clear_all()
        assert len(store._sessions) == 0


class TestSessionStoreProtocol:
    """Tests for SessionStore protocol compliance."""

    def test_inmemory_implements_protocol(self):
        """Test that InMemorySessionStore implements SessionStore protocol."""
        store = InMemorySessionStore()
        assert isinstance(store, SessionStore)


class TestSessionStoreFactory:
    """Tests for session store factory."""

    def test_create_memory_store(self):
        """Test creating in-memory store."""
        store = create_session_store("memory")
        assert isinstance(store, InMemorySessionStore)

    def test_create_memory_store_default(self):
        """Test that memory is the default store type."""
        store = create_session_store()
        assert isinstance(store, InMemorySessionStore)

    def test_create_unknown_store_raises(self):
        """Test that unknown store type raises ValueError."""
        with pytest.raises(ValueError, match="Unknown session store type"):
            create_session_store("unknown")  # type: ignore
