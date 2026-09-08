"""Pytest configuration and shared fixtures."""

import asyncio
import os
from pathlib import Path
from unittest.mock import MagicMock

import logfire
import pytest
from dotenv import load_dotenv

from animichi.config.settings import get_settings
from animichi.utils.logger import configure_structlog

# Configure logfire once so wrapper spans/metrics are quiet no-ops in tests
# (pytest runs with filterwarnings=error; unconfigured logfire would warn).
logfire.configure(send_to_logfire=False, console=False)

# Configure structlog once, exactly as the container's app factory does, so the
# suite pays the same (cheap) `exc_info=` rendering cost the runtime pays
# instead of the default rich console renderer's (issue #1502).
configure_structlog()

# Load test environment variables
test_env = Path(__file__).parent / ".env.test"
if test_env.exists():
    load_dotenv(test_env)

# DB-free collection instantiates Settings; dummy DSN so import works
# without ambient env. zen/go is stubbed in unit/integration conftests so
# eval can still fill ZEN_GO_API_KEY from .env (real_env_updates).
os.environ.setdefault("MIMO_API_KEY", "test-key")
os.environ.setdefault(
    "AGENT_SVC_DATABASE_URL", "postgresql://test:test@localhost:5432/test"
)


@pytest.fixture(autouse=True)
def _reset_get_settings_cache():
    """`get_settings()` is `lru_cache`d process-wide, but nothing in this
    suite pins its identity across tests — a test that builds `Settings`
    under unusual env (a missing model credential, a fake DSN) must not
    leave that instance cached for every test that runs after it (issue
    #508 review: this was an unguarded landmine, not introduced by #508)."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_http_client():
    """Mock HTTP client for API tests."""
    client = MagicMock()
    client.get = MagicMock()
    client.post = MagicMock()
    client.put = MagicMock()
    client.delete = MagicMock()
    return client


@pytest.fixture
def sample_coordinates():
    """Sample coordinates for testing."""
    from animichi.domain.entities import Coordinates

    return {
        "tokyo_station": Coordinates(latitude=35.6812, longitude=139.7671),
        "shibuya": Coordinates(latitude=35.6595, longitude=139.7004),
        "akihabara": Coordinates(latitude=35.7020, longitude=139.7753),
    }


@pytest.fixture
def sample_station_data():
    """Sample station data for testing."""
    return {
        "id": "ST001",
        "name": "Tokyo Station",
        "latitude": 35.6812,
        "longitude": 139.7671,
        "line": "JR Yamanote Line",
        "prefecture": "Tokyo",
    }


@pytest.fixture
def sample_bangumi_data():
    """Sample bangumi (anime) data for testing."""
    return {
        "id": "BG001",
        "title": "Your Name",
        "japanese_title": "君の名は。",
        "year": 2016,
        "season": "Movie",
        "tags": ["romance", "supernatural", "drama"],
    }


@pytest.fixture
def sample_pilgrimage_point_data():
    """Sample pilgrimage point data for testing."""
    return {
        "id": "PP001",
        "name": "Suga Shrine Stairs",
        "description": "Famous stairs from Your Name movie",
        "latitude": 35.6867,
        "longitude": 139.7189,
        "bangumi_id": "BG001",
        "scene_description": "The stairs where Taki and Mitsuha meet",
        "images": [
            "https://example.com/image1.jpg",
            "https://example.com/image2.jpg",
        ],
        "visiting_info": {
            "access": "5 min walk from Yotsuya Station",
            "best_time": "Early morning or sunset",
            "tips": "Respect local residents when taking photos",
        },
    }


@pytest.fixture
def cleanup_test_files():
    """Cleanup temporary test files after test."""
    created_files = []

    def register(filepath: Path):
        created_files.append(filepath)
        return filepath

    yield register

    # Cleanup
    for filepath in created_files:
        if filepath.exists():
            if filepath.is_file():
                filepath.unlink()
            elif filepath.is_dir():
                import shutil

                shutil.rmtree(filepath)
