"""Unit tests for A2A session store."""

from datetime import UTC, datetime, timedelta

import pytest

from contracts.a2ui.session import (
    InMemorySessionStore,
    SessionInfo,
    SessionState,
    SessionError,
    SessionNotFoundError,
    SessionExpiredError,
)


class TestSessionInfo:
    """Tests for SessionInfo dataclass."""

    def test_session_info_creation(self):
        """Test creating a SessionInfo."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        assert session.context_id == "ctx-123"
        assert session.state == {}
        assert session.metadata == {}

    def test_session_is_expired(self):
        """Test session expiration check."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
            updated_at=datetime.now(UTC) - timedelta(seconds=120),
        )
        # Should be expired with 60s TTL
        assert session.is_expired(60) is True
        # Should not be expired with 300s TTL
        assert session.is_expired(300) is False

    def test_session_touch_updates_time(self):
        """Test that touch() updates updated_at."""
        old_time = datetime.now(UTC) - timedelta(hours=1)
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
            updated_at=old_time,
        )
        session.touch()
        assert session.updated_at > old_time


class TestInMemorySessionStore:
    """Tests for InMemorySessionStore."""

    @pytest.fixture
    def store(self):
        """Create a fresh session store."""
        return InMemorySessionStore()

    @pytest.mark.asyncio
    async def test_get_or_create_creates_new_session(self, store):
        """Test creating a new session."""
        session = await store.get_or_create(
            context_id="ctx-new",
            user_id="user-1",
            app_name="test_app",
        )
        assert session.context_id == "ctx-new"
        assert session.user_id == "user-1"
        assert session.app_name == "test_app"

    @pytest.mark.asyncio
    async def test_get_or_create_returns_existing(self, store):
        """Test that get_or_create returns existing session."""
        session1 = await store.get_or_create(
            context_id="ctx-existing",
            user_id="user-1",
            app_name="test_app",
        )
        session1.state["key"] = "value"

        session2 = await store.get_or_create(
            context_id="ctx-existing",
            user_id="user-1",
            app_name="test_app",
        )
        assert session2.state["key"] == "value"

    @pytest.mark.asyncio
    async def test_get_returns_none_for_missing(self, store):
        """Test that get returns None for missing session."""
        session = await store.get("nonexistent")
        assert session is None

    @pytest.mark.asyncio
    async def test_update_state(self, store):
        """Test updating session state."""
        await store.get_or_create(
            context_id="ctx-update",
            user_id="user-1",
            app_name="test_app",
        )
        await store.update_state("ctx-update", {"new_key": "new_value"})

        session = await store.get("ctx-update")
        assert session is not None
        assert session.state["new_key"] == "new_value"

    @pytest.mark.asyncio
    async def test_delete_session(self, store):
        """Test deleting a session."""
        await store.get_or_create(
            context_id="ctx-delete",
            user_id="user-1",
            app_name="test_app",
        )

        deleted = await store.delete("ctx-delete")
        assert deleted is True

        session = await store.get("ctx-delete")
        assert session is None

    @pytest.mark.asyncio
    async def test_delete_returns_false_for_missing(self, store):
        """Test deleting a nonexistent session."""
        deleted = await store.delete("nonexistent")
        assert deleted is False

    @pytest.mark.asyncio
    async def test_list_sessions(self, store):
        """Test listing all sessions."""
        await store.get_or_create(context_id="ctx-1", user_id="user-1", app_name="app")
        await store.get_or_create(context_id="ctx-2", user_id="user-2", app_name="app")
        await store.get_or_create(context_id="ctx-3", user_id="user-1", app_name="app")

        all_sessions = await store.list_sessions()
        assert len(all_sessions) == 3

    @pytest.mark.asyncio
    async def test_list_sessions_filtered_by_user(self, store):
        """Test listing sessions filtered by user."""
        await store.get_or_create(context_id="ctx-1", user_id="user-1", app_name="app")
        await store.get_or_create(context_id="ctx-2", user_id="user-2", app_name="app")
        await store.get_or_create(context_id="ctx-3", user_id="user-1", app_name="app")

        user1_sessions = await store.list_sessions(user_id="user-1")
        assert len(user1_sessions) == 2
        assert all(s.user_id == "user-1" for s in user1_sessions)

    @pytest.mark.asyncio
    async def test_list_sessions_with_limit(self, store):
        """Test listing sessions with limit."""
        for i in range(10):
            await store.get_or_create(
                context_id=f"ctx-{i}", user_id="user-1", app_name="app"
            )

        limited = await store.list_sessions(limit=5)
        assert len(limited) == 5

    @pytest.mark.asyncio
    async def test_cleanup_expired(self, store):
        """Test cleaning up expired sessions."""
        # Create a session that will be expired
        session = await store.get_or_create(
            context_id="ctx-old", user_id="user-1", app_name="app"
        )
        # Manually set old timestamp
        session.updated_at = datetime.now(UTC) - timedelta(seconds=120)

        # Create a fresh session
        await store.get_or_create(
            context_id="ctx-fresh", user_id="user-1", app_name="app"
        )

        # Cleanup with 60s TTL
        removed = await store.cleanup_expired(ttl_seconds=60)
        assert removed == 1

        # Old session should be gone
        assert await store.get("ctx-old") is None
        # Fresh session should remain
        assert await store.get("ctx-fresh") is not None

    def test_clear_all(self, store):
        """Test clearing all sessions."""
        # Add sessions synchronously by accessing internal dict
        store._sessions["ctx-1"] = SessionInfo(
            context_id="ctx-1",
            session_id="sess-1",
            user_id="user-1",
            app_name="app",
        )
        store._sessions["ctx-2"] = SessionInfo(
            context_id="ctx-2",
            session_id="sess-2",
            user_id="user-2",
            app_name="app",
        )

        store.clear_all()
        assert len(store._sessions) == 0


class TestSessionLifecycleState:
    """Tests for session lifecycle state management."""

    def test_session_default_state_is_active(self):
        """Test that new sessions start in ACTIVE state."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        assert session.lifecycle_state == SessionState.ACTIVE

    def test_session_set_processing(self):
        """Test setting session to processing state."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        session.set_processing()
        assert session.lifecycle_state == SessionState.PROCESSING

    def test_session_set_error(self):
        """Test setting session to error state."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        session.set_error("Test error message")
        assert session.lifecycle_state == SessionState.ERROR
        assert session.error_count == 1
        assert session.last_error == "Test error message"

    def test_session_error_count_increments(self):
        """Test that error count increments on multiple errors."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        session.set_error("Error 1")
        session.set_error("Error 2")
        assert session.error_count == 2
        assert session.last_error == "Error 2"

    def test_session_clear_error(self):
        """Test clearing error state."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        session.set_error("Test error")
        session.clear_error()
        assert session.lifecycle_state == SessionState.ACTIVE
        assert session.last_error is None
        # Error count should remain for tracking
        assert session.error_count == 1

    def test_session_validate_state(self):
        """Test session state validation."""
        session = SessionInfo(
            context_id="ctx-123",
            session_id="sess-123",
            user_id="user-1",
            app_name="test_app",
        )
        assert session.validate_state() is True

        # Invalid state type
        session.state = "not a dict"  # type: ignore
        assert session.validate_state() is False


class TestInMemorySessionStoreLifecycle:
    """Tests for InMemorySessionStore lifecycle methods."""

    @pytest.fixture
    def store(self):
        """Create a fresh session store."""
        return InMemorySessionStore()

    @pytest.mark.asyncio
    async def test_set_processing(self, store):
        """Test setting session to processing state via store."""
        await store.get_or_create(
            context_id="ctx-1", user_id="user-1", app_name="app"
        )
        result = await store.set_processing("ctx-1")
        assert result is True

        session = await store.get("ctx-1")
        assert session.lifecycle_state == SessionState.PROCESSING

    @pytest.mark.asyncio
    async def test_set_processing_missing_session(self, store):
        """Test set_processing returns False for missing session."""
        result = await store.set_processing("nonexistent")
        assert result is False

    @pytest.mark.asyncio
    async def test_set_active(self, store):
        """Test setting session to active state via store."""
        await store.get_or_create(
            context_id="ctx-1", user_id="user-1", app_name="app"
        )
        await store.set_processing("ctx-1")
        result = await store.set_active("ctx-1")
        assert result is True

        session = await store.get("ctx-1")
        assert session.lifecycle_state == SessionState.ACTIVE

    @pytest.mark.asyncio
    async def test_record_error(self, store):
        """Test recording error via store."""
        await store.get_or_create(
            context_id="ctx-1", user_id="user-1", app_name="app"
        )
        result = await store.record_error("ctx-1", "Test error")
        assert result is True

        session = await store.get("ctx-1")
        assert session.lifecycle_state == SessionState.ERROR
        assert session.last_error == "Test error"

    @pytest.mark.asyncio
    async def test_get_session_stats(self, store):
        """Test getting session statistics."""
        await store.get_or_create(
            context_id="ctx-1", user_id="user-1", app_name="app"
        )
        await store.get_or_create(
            context_id="ctx-2", user_id="user-1", app_name="app"
        )
        await store.set_processing("ctx-1")
        await store.record_error("ctx-2", "Error")

        stats = await store.get_session_stats()
        assert stats["total_sessions"] == 2
        assert stats["sessions_with_errors"] == 1
        assert "processing" in stats["by_state"]
        assert "error" in stats["by_state"]
