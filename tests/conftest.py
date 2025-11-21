"""Pytest configuration and shared fixtures."""

import asyncio
import os
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from dotenv import load_dotenv

# Load test environment variables
test_env = Path(__file__).parent / ".env.test"
if test_env.exists():
    load_dotenv(test_env)


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_settings():
    """Mock application settings for testing."""
    from config import Settings

    return Settings(
        google_maps_api_key="test_google_maps_key",
        gemini_api_key="test_gemini_key",
        weather_api_key="test_weather_key",
        anitabi_api_url="https://test.anitabi.com/api",
        weather_api_url="https://test.weather.com/api",
        app_env="test",
        log_level="DEBUG",
        debug=True,
        max_retries=1,
        timeout_seconds=5,
        cache_ttl_seconds=60,
        use_cache=False,
        output_dir=Path("/tmp/test_outputs"),
        template_dir=Path("/tmp/test_templates"),
    )


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch, mock_settings):
    """Automatically setup test environment for all tests."""
    # Patch get_settings to return mock settings
    with patch("config.get_settings", return_value=mock_settings):
        yield


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
    from domain.entities import Coordinates

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


@pytest.fixture
async def mock_aiohttp_session():
    """Mock aiohttp session for async HTTP tests."""
    session = MagicMock()
    session.__aenter__ = MagicMock(return_value=session)
    session.__aexit__ = MagicMock()

    response = MagicMock()
    response.status = 200
    response.json = MagicMock(return_value={"success": True})
    response.__aenter__ = MagicMock(return_value=response)
    response.__aexit__ = MagicMock()

    session.get = MagicMock(return_value=response)
    session.post = MagicMock(return_value=response)

    return session