"""Unit tests for session management service following TDD principles."""

import asyncio

import pytest

from domain.entities import (
    Bangumi,
    Coordinates,
    PilgrimageSession,
    Station,
    Weather,
)

# Import statements that will exist after implementation
# These will fail initially (RED phase of TDD)
from services.session import (
    InMemorySessionService,
    SessionExpiredError,
    SessionLimitExceededError,
    SessionNotFoundError,
    SessionService,
)


class TestSessionService:
    """Test abstract SessionService interface."""

    def test_session_service_interface(self):
        """Test that SessionService defines required methods."""
        # SessionService should be an abstract base class
        assert hasattr(SessionService, "create_session")
        assert hasattr(SessionService, "get_session")
        assert hasattr(SessionService, "update_session")
        assert hasattr(SessionService, "delete_session")
        assert hasattr(SessionService, "cleanup_expired")
        assert hasattr(SessionService, "get_active_count")


class TestInMemorySessionService:
    """Test InMemorySessionService implementation."""

    @pytest.fixture
    def session_service(self):
        """Create a session service instance for testing."""
        return InMemorySessionService(
            max_sessions=100,
            session_ttl_seconds=3600,  # 1 hour
        )

    @pytest.fixture
    def sample_session_data(self):
        """Create sample session data for testing."""
        station = Station(
            name="Tokyo Station",
            coordinates=Coordinates(latitude=35.6812, longitude=139.7671),
            city="Tokyo",
            prefecture="Tokyo",
        )

        bangumi = Bangumi(
            id="BG001",
            title="Your Name",
            cn_title="你的名字",
            cover_url="https://example.com/cover.jpg",
            points_count=10,
        )

        return {
            "station": station,
            "bangumi": bangumi,
        }

    @pytest.mark.asyncio
    async def test_create_session(self, session_service):
        """Test creating a new session."""
        session_id = await session_service.create_session()

        assert session_id is not None
        assert isinstance(session_id, str)
        assert len(session_id) > 0

        # Verify session was created
        session = await session_service.get_session(session_id)
        assert session is not None
        assert session.session_id == session_id

    @pytest.mark.asyncio
    async def test_create_multiple_sessions(self, session_service):
        """Test creating multiple unique sessions."""
        session_ids = set()

        for _ in range(10):
            session_id = await session_service.create_session()
            session_ids.add(session_id)

        # All session IDs should be unique
        assert len(session_ids) == 10

    @pytest.mark.asyncio
    async def test_get_session(self, session_service, sample_session_data):
        """Test retrieving an existing session."""
        # Create session
        session_id = await session_service.create_session()

        # Get session
        session = await session_service.get_session(session_id)

        assert session is not None
        assert session.session_id == session_id
        assert isinstance(session, PilgrimageSession)

    @pytest.mark.asyncio
    async def test_get_nonexistent_session(self, session_service):
        """Test retrieving a non-existent session."""
        with pytest.raises(SessionNotFoundError):
            await session_service.get_session("non-existent-id")

    @pytest.mark.asyncio
    async def test_update_session(self, session_service, sample_session_data):
        """Test updating an existing session."""
        # Create session
        session_id = await session_service.create_session()

        # Get initial session
        session = await session_service.get_session(session_id)
        original_updated_at = session.updated_at

        # Update session with new data
        session.station = sample_session_data["station"]
        session.selected_bangumi_ids = ["BG001", "BG002"]
        session.search_radius_km = 10.0

        # Small delay to ensure timestamp changes
        await asyncio.sleep(0.01)

        # Update in service
        await session_service.update_session(session)

        # Retrieve updated session
        updated_session = await session_service.get_session(session_id)

        assert updated_session.station == sample_session_data["station"]
        assert "BG001" in updated_session.selected_bangumi_ids
        assert updated_session.search_radius_km == 10.0
        assert updated_session.updated_at > original_updated_at

    @pytest.mark.asyncio
    async def test_update_nonexistent_session(self, session_service):
        """Test updating a non-existent session."""
        fake_session = PilgrimageSession(session_id="fake-id")

        with pytest.raises(SessionNotFoundError):
            await session_service.update_session(fake_session)

    @pytest.mark.asyncio
    async def test_delete_session(self, session_service):
        """Test deleting a session."""
        # Create session
        session_id = await session_service.create_session()

        # Verify it exists
        session = await session_service.get_session(session_id)
        assert session is not None

        # Delete session
        deleted = await session_service.delete_session(session_id)
        assert deleted is True

        # Verify it's gone
        with pytest.raises(SessionNotFoundError):
            await session_service.get_session(session_id)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session(self, session_service):
        """Test deleting a non-existent session."""
        deleted = await session_service.delete_session("non-existent-id")
        assert deleted is False

    @pytest.mark.asyncio
    async def test_get_active_count(self, session_service):
        """Test getting active session count."""
        # Initially no sessions
        assert await session_service.get_active_count() == 0

        # Create some sessions
        session_ids = []
        for _ in range(5):
            session_id = await session_service.create_session()
            session_ids.append(session_id)

        assert await session_service.get_active_count() == 5

        # Delete a session
        await session_service.delete_session(session_ids[0])
        assert await session_service.get_active_count() == 4

    @pytest.mark.asyncio
    async def test_session_ttl_expiration(self):
        """Test session TTL expiration."""
        # Create service with very short TTL
        service = InMemorySessionService(
            max_sessions=10,
            session_ttl_seconds=1,  # 1 second TTL
        )

        # Create session
        session_id = await service.create_session()

        # Session should exist immediately
        session = await service.get_session(session_id)
        assert session is not None

        # Wait for TTL to expire
        await asyncio.sleep(1.5)

        # Session should be expired
        with pytest.raises(SessionExpiredError):
            await service.get_session(session_id)

    @pytest.mark.asyncio
    async def test_cleanup_expired_sessions(self):
        """Test cleaning up expired sessions."""
        # Create service with short TTL
        service = InMemorySessionService(
            max_sessions=10,
            session_ttl_seconds=1,
        )

        # Create multiple sessions
        session_ids = []
        for _ in range(5):
            session_id = await service.create_session()
            session_ids.append(session_id)

        assert await service.get_active_count() == 5

        # Wait for expiration
        await asyncio.sleep(1.5)

        # Cleanup expired sessions
        cleaned = await service.cleanup_expired()
        assert cleaned == 5

        # All sessions should be gone
        assert await service.get_active_count() == 0

    @pytest.mark.asyncio
    async def test_max_sessions_limit(self):
        """Test maximum sessions limit."""
        # Create service with small limit
        service = InMemorySessionService(
            max_sessions=3,
            session_ttl_seconds=3600,
        )

        # Create sessions up to limit
        for _ in range(3):
            await service.create_session()

        assert await service.get_active_count() == 3

        # Try to create one more - should fail
        with pytest.raises(SessionLimitExceededError):
            await service.create_session()

    @pytest.mark.asyncio
    async def test_concurrent_session_access(self, session_service):
        """Test concurrent access to sessions (thread safety)."""
        session_id = await session_service.create_session()

        async def update_session(value: int):
            """Update session with a value."""
            session = await session_service.get_session(session_id)
            session.search_radius_km = float(value + 1)  # Use an existing field
            await session_service.update_session(session)
            return value

        # Run concurrent updates
        tasks = [update_session(i) for i in range(10)]
        results = await asyncio.gather(*tasks)

        # All updates should complete without errors
        assert len(results) == 10
        assert all(isinstance(r, int) for r in results)

    @pytest.mark.asyncio
    async def test_session_isolation(self, session_service):
        """Test that sessions are isolated from each other."""
        # Create two sessions
        session_id_1 = await session_service.create_session()
        session_id_2 = await session_service.create_session()

        # Update first session
        session_1 = await session_service.get_session(session_id_1)
        session_1.search_radius_km = 10.0
        await session_service.update_session(session_1)

        # Update second session
        session_2 = await session_service.get_session(session_id_2)
        session_2.search_radius_km = 5.0
        await session_service.update_session(session_2)

        # Verify isolation
        final_session_1 = await session_service.get_session(session_id_1)
        final_session_2 = await session_service.get_session(session_id_2)

        assert final_session_1.search_radius_km == 10.0
        assert final_session_2.search_radius_km == 5.0

    @pytest.mark.asyncio
    async def test_session_with_complex_data(
        self, session_service, sample_session_data
    ):
        """Test session with complex nested data."""
        session_id = await session_service.create_session()
        session = await session_service.get_session(session_id)

        # Add complex data
        session.station = sample_session_data["station"]
        session.nearby_bangumi = [sample_session_data["bangumi"]]

        # Create weather data
        weather = Weather(
            date="2025-11-20",
            location="Tokyo",
            condition="Sunny",
            temperature_high=22,
            temperature_low=15,
            precipitation_chance=10,
            wind_speed_kmh=5,
            recommendation="Perfect day for pilgrimage",
        )
        session.weather = weather

        # Update session
        await session_service.update_session(session)

        # Retrieve and verify
        retrieved = await session_service.get_session(session_id)
        assert retrieved.station.name == "Tokyo Station"
        assert len(retrieved.nearby_bangumi) == 1
        assert retrieved.weather.condition == "Sunny"

    @pytest.mark.asyncio
    async def test_get_all_sessions(self, session_service):
        """Test getting all active sessions."""
        # Create multiple sessions
        session_ids = []
        for i in range(5):
            session_id = await session_service.create_session()
            session_ids.append(session_id)

        # Get all sessions
        all_sessions = await session_service.get_all_sessions()

        assert len(all_sessions) == 5
        retrieved_ids = [s.session_id for s in all_sessions]
        assert set(retrieved_ids) == set(session_ids)

    @pytest.mark.asyncio
    async def test_session_service_statistics(self, session_service):
        """Test getting session service statistics."""
        # Create some sessions
        for _ in range(3):
            await session_service.create_session()

        # Get statistics
        stats = await session_service.get_statistics()

        assert stats["active_sessions"] == 3
        assert stats["max_sessions"] == 100
        assert stats["session_ttl_seconds"] == 3600
        assert "created_total" in stats
        assert "expired_total" in stats


class TestSessionExceptions:
    """Test session-related exceptions."""

    def test_session_not_found_error(self):
        """Test SessionNotFoundError exception."""
        error = SessionNotFoundError("Session xyz not found")
        assert str(error) == "Session xyz not found"
        assert isinstance(error, Exception)

    def test_session_expired_error(self):
        """Test SessionExpiredError exception."""
        error = SessionExpiredError("Session has expired")
        assert str(error) == "Session has expired"
        assert isinstance(error, Exception)

    def test_session_limit_exceeded_error(self):
        """Test SessionLimitExceededError exception."""
        error = SessionLimitExceededError("Maximum session limit reached")
        assert str(error) == "Maximum session limit reached"
        assert isinstance(error, Exception)
