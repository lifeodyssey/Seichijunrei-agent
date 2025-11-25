"""
Unit tests for PDFGeneratorTool following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch, MagicMock

from tools.pdf_generator import PDFGeneratorTool
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Bangumi,
    Coordinates, PilgrimageSession, Weather
)


@pytest.fixture
def sample_session_with_weather():
    """Create a complete PilgrimageSession with weather for testing."""
    station = Station(
        name="Shinjuku Station",
        coordinates=Coordinates(latitude=35.6896, longitude=139.7006),
        city="Tokyo",
        prefecture="Tokyo"
    )

    bangumi1 = Bangumi(
        id="115908",
        title="Kimi no Na wa",
        cn_title="你的名字",
        cover_url="https://example.com/cover1.jpg",
        points_count=2,
        primary_color="#FF6B6B"
    )

    bangumi2 = Bangumi(
        id="126461",
        title="Tenki no Ko",
        cn_title="天气之子",
        cover_url="https://example.com/cover2.jpg",
        points_count=1,
        primary_color="#4ECDC4"
    )

    point1 = Point(
        id="point-1",
        name="Shinjuku Gyoen",
        cn_name="新宿御苑",
        coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
        episode=12,
        time_seconds=345,
        screenshot_url="https://example.com/screenshot1.jpg"
    )

    point2 = Point(
        id="point-2",
        name="Yoyogi Park",
        cn_name="代代木公园",
        coordinates=Coordinates(latitude=35.6700, longitude=139.7200),
        bangumi_id="126461",
        bangumi_title="Tenki no Ko",
        episode=5,
        time_seconds=180,
        screenshot_url="https://example.com/screenshot2.jpg"
    )

    point3 = Point(
        id="point-3",
        name="Tokyo Tower",
        cn_name="东京塔",
        coordinates=Coordinates(latitude=35.6586, longitude=139.7454),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
        episode=8,
        time_seconds=520,
        screenshot_url="https://example.com/screenshot3.jpg"
    )

    transport1 = TransportInfo(
        mode="walking",
        distance_meters=1200,
        duration_minutes=15,
        instructions="Walk south"
    )

    transport2 = TransportInfo(
        mode="transit",
        distance_meters=2500,
        duration_minutes=12,
        instructions="Take subway",
        transit_details={"lines": [{"name": "Yamanote Line"}]}
    )

    transport3 = TransportInfo(
        mode="walking",
        distance_meters=800,
        duration_minutes=10,
        instructions="Walk west"
    )

    segments = [
        RouteSegment(
            order=1,
            point=point1,
            transport=transport1,
            cumulative_distance_km=1.2,
            cumulative_duration_minutes=15
        ),
        RouteSegment(
            order=2,
            point=point2,
            transport=transport2,
            cumulative_distance_km=3.7,
            cumulative_duration_minutes=27
        ),
        RouteSegment(
            order=3,
            point=point3,
            transport=transport3,
            cumulative_distance_km=4.5,
            cumulative_duration_minutes=37
        )
    ]

    route = Route(
        origin=station,
        segments=segments,
        total_distance_km=4.5,
        total_duration_minutes=37,
        google_maps_url="https://www.google.com/maps/dir/..."
    )

    weather = Weather(
        date="2025-01-15",
        location="Tokyo",
        condition="晴天",
        temperature_high=18,
        temperature_low=8,
        precipitation_chance=10,
        wind_speed_kmh=12,
        recommendation="适合出行"
    )

    session = PilgrimageSession(
        session_id="test-pdf-session",
        station=station,
        selected_bangumi_ids=["115908", "126461"],
        nearby_bangumi=[bangumi1, bangumi2],
        points=[point1, point2, point3],
        route=route,
        weather=weather
    )

    return session


@pytest.fixture
def pdf_generator(tmp_path):
    """Create a PDFGeneratorTool instance with temporary output directory."""
    output_dir = tmp_path / "pdfs"
    return PDFGeneratorTool(output_dir=str(output_dir))


class TestPDFGeneratorTool:
    """Test suite for PDFGeneratorTool."""

    @pytest.mark.asyncio
    async def test_tool_initialization(self, tmp_path):
        """Test PDFGeneratorTool initialization."""
        # Arrange
        output_dir = tmp_path / "pdfs"

        # Act
        tool = PDFGeneratorTool(output_dir=str(output_dir))

        # Assert
        assert tool.output_dir == output_dir
        assert output_dir.exists()

    @pytest.mark.asyncio
    async def test_tool_initialization_default_directory(self):
        """Test PDFGeneratorTool uses default 'output/pdfs' if not specified."""
        # Act
        tool = PDFGeneratorTool()

        # Assert
        assert "pdfs" in str(tool.output_dir)

    @pytest.mark.asyncio
    async def test_generate_pdf_from_session(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test PDF generation from complete PilgrimageSession."""
        # Act
        with patch('tools.pdf_generator.async_playwright') as mock_playwright:
            # Mock Playwright browser
            mock_browser = AsyncMock()
            mock_page = AsyncMock()
            mock_context = AsyncMock()

            mock_playwright.return_value.__aenter__.return_value.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_browser.new_context = AsyncMock(return_value=mock_context)
            mock_context.new_page = AsyncMock(return_value=mock_page)
            mock_page.set_content = AsyncMock()
            mock_page.pdf = AsyncMock()
            mock_browser.close = AsyncMock()

            output_path = await pdf_generator.generate(sample_session_with_weather)

        # Assert
        assert output_path is not None
        assert str(output_path).endswith(".pdf")

    @pytest.mark.asyncio
    async def test_pdf_file_created(self, pdf_generator, sample_session_with_weather):
        """Test that PDF file is actually created."""
        # Act
        with patch('tools.pdf_generator.async_playwright') as mock_playwright:
            mock_browser = AsyncMock()
            mock_page = AsyncMock()
            mock_context = AsyncMock()

            mock_playwright.return_value.__aenter__.return_value.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_browser.new_context = AsyncMock(return_value=mock_context)
            mock_context.new_page = AsyncMock(return_value=mock_page)

            # Create a mock PDF file
            async def create_pdf_file(*args, **kwargs):
                pdf_path = kwargs.get('path')
                if pdf_path:
                    Path(pdf_path).write_bytes(b'%PDF-1.4 mock')

            mock_page.pdf = AsyncMock(side_effect=create_pdf_file)

            output_path = await pdf_generator.generate(sample_session_with_weather)

        # Assert
        assert Path(output_path).exists()

    @pytest.mark.asyncio
    async def test_rendered_html_contains_cover_page(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that rendered HTML contains cover page content."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "圣地巡礼指南" in html  # Title
        assert "Shinjuku Station" in html  # Station name
        assert "总距离" in html  # Total distance label

    @pytest.mark.asyncio
    async def test_rendered_html_contains_itinerary(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that rendered HTML contains itinerary section."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "行程安排" in html  # Itinerary title
        assert "新宿御苑" in html  # Point 1 CN name
        assert "Shinjuku Gyoen" in html  # Point 1 JP name
        assert "代代木公园" in html  # Point 2 CN name

    @pytest.mark.asyncio
    async def test_rendered_html_contains_bangumi_sections(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that rendered HTML contains bangumi sections."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "动漫作品" in html  # Bangumi section title
        assert "你的名字" in html  # Bangumi 1 CN title
        assert "Kimi no Na wa" in html  # Bangumi 1 JP title
        assert "天气之子" in html  # Bangumi 2 CN title

    @pytest.mark.asyncio
    async def test_rendered_html_has_bilingual_content(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that HTML contains both Chinese and Japanese text."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        # Chinese content
        assert "起点" in html
        assert "景点" in html
        assert "分钟" in html
        # Japanese/English content
        assert "Station" in html
        assert "Gyoen" in html

    @pytest.mark.asyncio
    async def test_weather_information_displayed(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that weather information is included in PDF."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "天气信息" in html or "Weather" in html
        assert "晴天" in html  # Condition
        assert "适合出行" in html  # Recommendation

    @pytest.mark.asyncio
    async def test_transport_info_rendered(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that transport information is displayed."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "walking" in html.lower() or "walking" in html
        assert "transit" in html.lower() or "transit" in html
        assert "Yamanote Line" in html  # Transit line name

    @pytest.mark.asyncio
    async def test_output_filename_uses_session_id(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that output file uses session_id in filename."""
        # Act
        with patch('tools.pdf_generator.async_playwright') as mock_playwright:
            mock_browser = AsyncMock()
            mock_page = AsyncMock()
            mock_context = AsyncMock()

            mock_playwright.return_value.__aenter__.return_value.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_browser.new_context = AsyncMock(return_value=mock_context)
            mock_context.new_page = AsyncMock(return_value=mock_page)

            output_path = await pdf_generator.generate(sample_session_with_weather)

        # Assert
        assert "test-pdf-session" in str(output_path)

    @pytest.mark.asyncio
    async def test_input_validation_missing_route(self, pdf_generator):
        """Test that tool raises error when session has no route."""
        # Arrange
        session = PilgrimageSession(
            session_id="test-no-route",
            station=Station(
                name="Test Station",
                coordinates=Coordinates(latitude=35.0, longitude=139.0)
            )
        )

        # Act & Assert
        with pytest.raises(ValueError, match="route"):
            await pdf_generator.generate(session)

    @pytest.mark.asyncio
    async def test_browser_closed_after_generation(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that Playwright browser is properly closed."""
        # Act
        with patch('tools.pdf_generator.async_playwright') as mock_playwright:
            mock_browser = AsyncMock()
            mock_page = AsyncMock()
            mock_context = AsyncMock()

            mock_playwright.return_value.__aenter__.return_value.chromium.launch = AsyncMock(return_value=mock_browser)
            mock_browser.new_context = AsyncMock(return_value=mock_context)
            mock_context.new_page = AsyncMock(return_value=mock_page)
            mock_browser.close = AsyncMock()

            await pdf_generator.generate(sample_session_with_weather)

            # Assert
            mock_browser.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_css_styles_included_in_html(
        self, pdf_generator, sample_session_with_weather
    ):
        """Test that CSS styles are embedded in HTML."""
        # Act
        html = await pdf_generator._render_html(sample_session_with_weather)

        # Assert
        assert "<style>" in html
        assert "cover-page" in html or ".cover-page" in html
        assert "itinerary-item" in html or ".itinerary-item" in html
