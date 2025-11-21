# 🔧 Agent C - Tools & Testing Expert Task List

**Role**: Tools Implementation & Quality Assurance Expert
**Focus**: Google Maps Integration, PDF Generation, Testing, DevOps
**Total Story Points**: 38
**Total Tasks**: 12

---

## 📋 Task Overview

| Task ID | Title | Priority | Points | Duration | Status |
|---------|-------|----------|---------|----------|--------|
| TASK-025 | Google Maps Client Core | P0 | 5 | 2h | 🔴 Not Started |
| TASK-026 | Geocoding & Route Service | P0 | 5 | 2h | 🔴 Not Started |
| TASK-027 | Navigation URL Builder | P1 | 2 | 1h | 🔴 Not Started |
| TASK-028 | Google Maps Caching | P2 | 2 | 1h | 🔴 Not Started |
| TASK-029 | PDF Generator Core | P1 | 5 | 2h | 🔴 Not Started |
| TASK-030 | PDF Template Design | P1 | 3 | 1.5h | 🔴 Not Started |
| TASK-031 | PDF Image Optimization | P2 | 2 | 1h | 🔴 Not Started |
| TASK-032 | Playwright Setup | P1 | 3 | 1h | 🔴 Not Started |
| TASK-033 | E2E Test Suite | P1 | 4 | 2h | 🔴 Not Started |
| TASK-034 | CI/CD Pipeline | P2 | 3 | 1.5h | 🔴 Not Started |
| TASK-035 | Deployment Config | P2 | 2 | 1h | 🔴 Not Started |
| TASK-036 | Documentation & Demo | P3 | 2 | 1h | 🔴 Not Started |

---

## 📝 Detailed Task Specifications

### TASK-025: Google Maps Client Core
**Priority**: P0 (Blocker for Agent A)
**Duration**: 2 hours
**Dependencies**: A-002 (Domain Models)

**Scope**:
Implement Google Maps API client with geocoding and directions services.

**Implementation**:
```python
# services/gmaps_client.py

import googlemaps
import asyncio
from typing import List, Dict, Optional, Tuple
from domain.entities import Coordinates, Point, Route, RouteSegment, TransportInfo
from config.settings import settings
from utils.logger import get_logger

logger = get_logger(__name__)

class GoogleMapsClient:
    """
    Client for Google Maps API interactions.
    Handles geocoding, directions, and route optimization.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.google_maps_api_key
        self.client = googlemaps.Client(key=self.api_key)
        self._geocoding_cache: Dict[str, Coordinates] = {}
        self._directions_cache: Dict[str, dict] = {}

    async def geocode_station(self, station_name: str) -> Coordinates:
        """
        Convert station name to GPS coordinates.

        Args:
            station_name: Name of the station (e.g., "新宿駅", "新宿站", "Shinjuku Station")

        Returns:
            Coordinates object

        Raises:
            ValueError: If station cannot be geocoded
        """
        # Check cache first
        cache_key = station_name.lower().strip()
        if cache_key in self._geocoding_cache:
            logger.debug(f"Geocoding cache hit: {station_name}")
            return self._geocoding_cache[cache_key]

        try:
            # Run geocoding in executor (since googlemaps is synchronous)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self.client.geocode,
                station_name
            )

            if not result:
                raise ValueError(f"Station '{station_name}' not found")

            # Extract coordinates from first result
            location = result[0]['geometry']['location']
            coordinates = Coordinates(
                latitude=location['lat'],
                longitude=location['lng']
            )

            # Cache the result
            self._geocoding_cache[cache_key] = coordinates

            logger.info(f"Geocoded '{station_name}' to {coordinates}")
            return coordinates

        except googlemaps.exceptions.ApiError as e:
            logger.error(f"Google Maps API error: {e}")
            raise ConnectionError(f"地图服务暂时不可用: {e}")
        except Exception as e:
            logger.error(f"Geocoding failed: {e}")
            raise ValueError(f"无法识别车站 '{station_name}'")

    def _cache_key_for_route(
        self,
        origin: Coordinates,
        waypoints: List[Coordinates]
    ) -> str:
        """Generate cache key for route."""
        points = [origin] + waypoints
        coords_str = "|".join([f"{p.latitude},{p.longitude}" for p in points])
        return f"route:{coords_str}"
```

**Route Optimization Implementation**:
```python
    async def optimize_route(
        self,
        origin: Coordinates,
        points: List[Point],
        mode: str = "transit"
    ) -> Dict:
        """
        Generate optimized route using Google Maps Directions API.

        Args:
            origin: Starting coordinates
            points: List of points to visit (max 23 for optimization)
            mode: Travel mode (transit, walking, driving)

        Returns:
            Optimized route dictionary
        """
        if len(points) > settings.max_waypoints:
            logger.warning(f"Too many waypoints ({len(points)}), using chunking")
            return await self._optimize_route_chunked(origin, points, mode)

        # Check cache
        waypoint_coords = [p.coordinates for p in points]
        cache_key = self._cache_key_for_route(origin, waypoint_coords)

        if cache_key in self._directions_cache:
            logger.debug("Route cache hit")
            return self._directions_cache[cache_key]

        try:
            # Prepare waypoints for API
            waypoints = [
                f"optimize:true|{p.coordinates.to_string()}"
                for p in points
            ]

            # Use the last point as destination
            destination = points[-1].coordinates.to_string() if points else origin.to_string()

            # Run directions API in executor
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self.client.directions,
                origin.to_string(),
                destination,
                waypoints=waypoints,
                mode=mode,
                language="ja",  # Japanese for local place names
                units="metric"
            )

            if not result:
                raise ValueError("No route found")

            # Cache result
            self._directions_cache[cache_key] = result[0]

            logger.info(f"Route optimized: {len(points)} waypoints")
            return result[0]

        except Exception as e:
            logger.error(f"Route optimization failed: {e}")
            raise ConnectionError(f"路线规划服务不可用: {e}")

    async def _optimize_route_chunked(
        self,
        origin: Coordinates,
        points: List[Point],
        mode: str
    ) -> Dict:
        """
        Handle route optimization for >23 waypoints using chunking.
        Uses greedy nearest neighbor algorithm.
        """
        logger.info(f"Chunking route with {len(points)} points")

        # Greedy nearest neighbor
        remaining = points.copy()
        ordered_points = []
        current = origin

        while remaining:
            # Find nearest point
            nearest = min(
                remaining,
                key=lambda p: current.distance_to(p.coordinates)
            )
            ordered_points.append(nearest)
            remaining.remove(nearest)
            current = nearest.coordinates

        # Now chunk into groups of max_waypoints
        chunks = []
        chunk_size = settings.max_waypoints

        for i in range(0, len(ordered_points), chunk_size):
            chunk = ordered_points[i:i + chunk_size]
            chunks.append(chunk)

        # Optimize each chunk
        all_legs = []
        total_distance = 0
        total_duration = 0

        for i, chunk in enumerate(chunks):
            chunk_origin = origin if i == 0 else chunks[i-1][-1].coordinates
            chunk_result = await self.optimize_route(chunk_origin, chunk, mode)

            all_legs.extend(chunk_result.get('legs', []))

            # Sum up distance and duration
            for leg in chunk_result.get('legs', []):
                total_distance += leg['distance']['value']
                total_duration += leg['duration']['value']

        # Construct combined result
        return {
            'legs': all_legs,
            'waypoint_order': list(range(len(ordered_points))),
            'overview_polyline': {'points': ''},  # Would need to combine
            'total_distance': total_distance,
            'total_duration': total_duration
        }
```

**Testing**:
```python
# tests/unit/test_gmaps_client.py

@pytest.mark.asyncio
async def test_geocode_station():
    client = GoogleMapsClient(api_key="test_key")

    # Mock the googlemaps client
    with patch.object(client.client, 'geocode') as mock_geocode:
        mock_geocode.return_value = [{
            'geometry': {
                'location': {'lat': 35.6762, 'lng': 139.6503}
            }
        }]

        coords = await client.geocode_station("東京駅")
        assert coords.latitude == 35.6762
        assert coords.longitude == 139.6503

@pytest.mark.asyncio
async def test_geocode_caching():
    client = GoogleMapsClient(api_key="test_key")

    with patch.object(client.client, 'geocode') as mock_geocode:
        mock_geocode.return_value = [{
            'geometry': {
                'location': {'lat': 35.6762, 'lng': 139.6503}
            }
        }]

        # First call
        await client.geocode_station("東京駅")
        # Second call (should use cache)
        await client.geocode_station("東京駅")

        # Geocode should only be called once
        assert mock_geocode.call_count == 1

@pytest.mark.asyncio
async def test_optimize_route_chunking():
    client = GoogleMapsClient(api_key="test_key")

    # Create 30 points (exceeds limit of 23)
    points = [
        Point(
            id=f"p{i}",
            name=f"Point {i}",
            coordinates=Coordinates(35.6 + i*0.01, 139.6 + i*0.01),
            ...
        )
        for i in range(30)
    ]

    with patch.object(client, '_optimize_route_chunked') as mock_chunk:
        mock_chunk.return_value = {'legs': [], 'waypoint_order': []}

        await client.optimize_route(
            Coordinates(35.6762, 139.6503),
            points
        )

        # Should trigger chunking
        mock_chunk.assert_called_once()
```

**Acceptance Criteria**:
- ✅ Geocoding with caching
- ✅ Route optimization with waypoint limit
- ✅ Chunking for >23 waypoints
- ✅ Error handling for API failures
- ✅ Comprehensive test coverage

---

### TASK-026: Geocoding & Route Service
**Priority**: P0 (Blocker for Agent A)
**Duration**: 2 hours
**Dependencies**: TASK-025

**Scope**:
Implement high-level routing services and route entity construction.

**Implementation**:
```python
# services/routing_service.py

from typing import List, Optional
from domain.entities import (
    Station, Point, Route, RouteSegment,
    TransportInfo, Coordinates
)
from services.gmaps_client import GoogleMapsClient
from utils.logger import get_logger

logger = get_logger(__name__)

class RoutingService:
    """
    High-level routing service that builds Route entities.
    """

    def __init__(self, gmaps_client: GoogleMapsClient):
        self.gmaps = gmaps_client

    async def create_optimized_route(
        self,
        station: Station,
        points: List[Point],
        mode: str = "transit"
    ) -> Route:
        """
        Create an optimized route from station to all points.

        Returns:
            Complete Route entity with segments and transport info
        """
        if not points:
            raise ValueError("No points to route")

        logger.info(f"Creating route from {station.name} to {len(points)} points")

        # Get optimized route from Google Maps
        api_result = await self.gmaps.optimize_route(
            station.coordinates,
            points,
            mode
        )

        # Parse waypoint order
        waypoint_order = api_result.get('waypoint_order', list(range(len(points))))
        ordered_points = [points[i] for i in waypoint_order]

        # Build route segments
        segments = []
        cumulative_distance = 0
        cumulative_duration = 0

        legs = api_result.get('legs', [])

        for i, (point, leg) in enumerate(zip(ordered_points, legs), 1):
            # Parse transport info from leg
            transport = self._parse_transport_info(leg, mode)

            cumulative_distance += transport.distance_meters / 1000
            cumulative_duration += transport.duration_minutes

            segment = RouteSegment(
                order=i,
                point=point,
                transport=transport,
                cumulative_distance_km=round(cumulative_distance, 2),
                cumulative_duration_minutes=cumulative_duration
            )
            segments.append(segment)

        # Build Google Maps URL
        google_maps_url = self.build_navigation_url(
            station.coordinates,
            ordered_points
        )

        # Create Route entity
        route = Route(
            origin=station,
            segments=segments,
            total_distance_km=round(cumulative_distance, 2),
            total_duration_minutes=cumulative_duration,
            google_maps_url=google_maps_url
        )

        logger.info(
            f"Route created: {len(segments)} points, "
            f"{route.total_distance_km}km, "
            f"{route.total_duration_formatted}"
        )

        return route

    def _parse_transport_info(self, leg: dict, mode: str) -> TransportInfo:
        """
        Parse transport information from Google Maps leg data.
        """
        distance = leg.get('distance', {})
        duration = leg.get('duration', {})

        # Extract transit details if available
        transit_details = None
        instructions = []

        for step in leg.get('steps', []):
            if step.get('travel_mode') == 'TRANSIT':
                transit = step.get('transit_details', {})
                if transit:
                    line = transit.get('line', {})
                    transit_details = {
                        'line_name': line.get('short_name', line.get('name', '')),
                        'departure_stop': transit.get('departure_stop', {}).get('name'),
                        'arrival_stop': transit.get('arrival_stop', {}).get('name'),
                        'num_stops': transit.get('num_stops', 0)
                    }

            # Collect instructions
            html_instructions = step.get('html_instructions', '')
            if html_instructions:
                # Strip HTML tags
                import re
                clean_instruction = re.sub('<.*?>', '', html_instructions)
                instructions.append(clean_instruction)

        return TransportInfo(
            mode=mode,
            distance_meters=distance.get('value', 0),
            duration_minutes=duration.get('value', 0) // 60,
            instructions=' → '.join(instructions) if instructions else None,
            transit_details=transit_details
        )

    def build_navigation_url(
        self,
        origin: Coordinates,
        waypoints: List[Point]
    ) -> str:
        """
        Build Google Maps navigation URL.
        """
        base_url = "https://www.google.com/maps/dir/"

        # Add origin
        url_parts = [f"{origin.latitude},{origin.longitude}"]

        # Add waypoints
        for point in waypoints:
            url_parts.append(
                f"{point.coordinates.latitude},{point.coordinates.longitude}"
            )

        # Join with /
        full_url = base_url + "/".join(url_parts)

        # Add parameters
        params = "?travelmode=transit"

        return full_url + params
```

**Common Station Data**:
```python
# data/stations.py

TOKYO_STATIONS = {
    "新宿駅": {"lat": 35.6896, "lon": 139.7006, "en": "Shinjuku Station"},
    "新宿站": {"lat": 35.6896, "lon": 139.7006, "en": "Shinjuku Station"},
    "渋谷駅": {"lat": 35.6580, "lon": 139.7016, "en": "Shibuya Station"},
    "渋谷站": {"lat": 35.6580, "lon": 139.7016, "en": "Shibuya Station"},
    "東京駅": {"lat": 35.6812, "lon": 139.7671, "en": "Tokyo Station"},
    "東京站": {"lat": 35.6812, "lon": 139.7671, "en": "Tokyo Station"},
    "秋葉原駅": {"lat": 35.6984, "lon": 139.7731, "en": "Akihabara Station"},
    "秋叶原站": {"lat": 35.6984, "lon": 139.7731, "en": "Akihabara Station"},
    "池袋駅": {"lat": 35.7295, "lon": 139.7109, "en": "Ikebukuro Station"},
    "池袋站": {"lat": 35.7295, "lon": 139.7109, "en": "Ikebukuro Station"},
    # Add more stations
}

def get_station_coordinates(name: str) -> Optional[Tuple[float, float]]:
    """Quick lookup for common stations."""
    station = TOKYO_STATIONS.get(name)
    if station:
        return (station["lat"], station["lon"])
    return None
```

**Acceptance Criteria**:
- ✅ Route entity construction
- ✅ Transport info parsing
- ✅ Navigation URL generation
- ✅ Common station caching
- ✅ Integration tests passing

---

### TASK-027: Navigation URL Builder
**Priority**: P1 (Critical)
**Duration**: 1 hour
**Dependencies**: TASK-026

**Implementation**:
```python
# utils/url_builder.py

from typing import List
from urllib.parse import quote, urlencode
from domain.entities import Coordinates, Point

class NavigationURLBuilder:
    """
    Build navigation URLs for various map services.
    """

    @staticmethod
    def google_maps_url(
        origin: Coordinates,
        destinations: List[Point],
        mode: str = "transit"
    ) -> str:
        """
        Build Google Maps navigation URL.

        Example output:
        https://www.google.com/maps/dir/35.6896,139.7006/35.6851,139.7100/...
        """
        base = "https://www.google.com/maps/dir"

        # Build path
        path_parts = [f"{origin.latitude},{origin.longitude}"]

        for point in destinations:
            coords = point.coordinates
            path_parts.append(f"{coords.latitude},{coords.longitude}")

        # Join path
        url = f"{base}/{'/'.join(path_parts)}"

        # Add parameters
        params = {
            "travelmode": mode,
            "hl": "ja"  # Japanese language
        }

        return f"{url}?{urlencode(params)}"

    @staticmethod
    def apple_maps_url(
        origin: Coordinates,
        destination: Coordinates,
        name: str = ""
    ) -> str:
        """
        Build Apple Maps URL (iOS).
        """
        params = {
            "saddr": f"{origin.latitude},{origin.longitude}",
            "daddr": f"{destination.latitude},{destination.longitude}",
            "dirflg": "r"  # Transit mode
        }

        if name:
            params["dname"] = name

        return f"https://maps.apple.com/?{urlencode(params)}"

    @staticmethod
    def google_maps_embed_url(
        center: Coordinates,
        zoom: int = 13,
        api_key: str = ""
    ) -> str:
        """
        Build Google Maps embed URL for iframe.
        """
        params = {
            "center": f"{center.latitude},{center.longitude}",
            "zoom": str(zoom),
            "key": api_key
        }

        return f"https://www.google.com/maps/embed/v1/view?{urlencode(params)}"
```

---

### TASK-029: PDF Generator Core
**Priority**: P1 (Critical)
**Duration**: 2 hours
**Dependencies**: A-007 (Route data), B-018 (Map screenshot)

**Implementation**:
```python
# tools/pdf_generator.py

import asyncio
from pathlib import Path
from typing import Dict, List, Optional
from jinja2 import Environment, FileSystemLoader
from playwright.async_api import async_playwright
from domain.entities import Route, Weather, Bangumi
from config.settings import settings
from utils.logger import get_logger

logger = get_logger(__name__)

class PDFGeneratorTool:
    """
    Generate PDF pilgrimage guide using HTML template and Playwright.
    """

    def __init__(self, template_dir: str = None):
        self.template_dir = template_dir or settings.template_dir
        self.env = Environment(
            loader=FileSystemLoader(self.template_dir),
            autoescape=True
        )
        self.env.filters['format_time'] = self._format_time

    @staticmethod
    def _format_time(seconds: int) -> str:
        """Format seconds to MM:SS."""
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}:{secs:02d}"

    async def generate(
        self,
        route: Route,
        weather: Optional[Weather] = None,
        bangumi_list: List[Bangumi] = None,
        map_screenshot_path: str = None,
        output_path: str = None
    ) -> str:
        """
        Generate PDF guide from route data.

        Args:
            route: Complete route with segments
            weather: Weather information (optional)
            bangumi_list: List of selected bangumi
            map_screenshot_path: Path to map screenshot
            output_path: Output PDF path

        Returns:
            Path to generated PDF
        """
        output_path = output_path or f"{settings.output_dir}/pilgrimage_guide.pdf"
        logger.info(f"Generating PDF with {len(route.segments)} points")

        # Prepare template data
        template_data = {
            "route": route,
            "weather": weather or self._default_weather(),
            "bangumi_list": bangumi_list or [],
            "map_image_path": map_screenshot_path or "",
            "generation_date": route.created_at.strftime("%Y-%m-%d")
        }

        # Render HTML
        html_content = self._render_template(template_data)

        # Save temporary HTML
        temp_html = f"{settings.output_dir}/temp_guide.html"
        with open(temp_html, 'w', encoding='utf-8') as f:
            f.write(html_content)

        # Generate PDF with Playwright
        await self._html_to_pdf(temp_html, output_path)

        logger.info(f"PDF generated: {output_path}")
        return output_path

    def _render_template(self, data: Dict) -> str:
        """Render HTML template with data."""
        template = self.env.get_template("pilgrimage_guide.html")
        return template.render(**data)

    async def _html_to_pdf(self, html_path: str, pdf_path: str):
        """Convert HTML to PDF using Playwright."""
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            # Load HTML file
            file_url = f"file://{Path(html_path).absolute()}"
            await page.goto(file_url, wait_until="networkidle")

            # Generate PDF
            await page.pdf(
                path=pdf_path,
                format="A4",
                print_background=True,
                margin={
                    "top": "20mm",
                    "right": "15mm",
                    "bottom": "20mm",
                    "left": "15mm"
                }
            )

            await browser.close()

    def _default_weather(self) -> Weather:
        """Default weather when not provided."""
        from domain.entities import Weather
        return Weather(
            date="今日",
            location="東京",
            condition="晴れ",
            temperature_high=20,
            temperature_low=15,
            precipitation_chance=10,
            wind_speed_kmh=10,
            recommendation="天気は良好です。快適な巡礼日和となるでしょう。"
        )
```

**Template Structure** (pilgrimage_guide.html):
```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>圣地巡礼手册 - {{ route.origin.name }}</title>
    <style>
        @page {
            size: A4;
            margin: 20mm;
        }

        body {
            font-family: 'Noto Sans CJK JP', sans-serif;
            line-height: 1.6;
            color: #333;
        }

        .page-break {
            page-break-after: always;
        }

        .cover-page {
            text-align: center;
            padding: 50px 0;
        }

        .cover-page h1 {
            font-size: 36pt;
            margin-bottom: 20px;
            color: #667eea;
        }

        .route-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }

        .point-card {
            border: 1px solid #dee2e6;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            page-break-inside: avoid;
        }

        .point-card h3 {
            color: #667eea;
            margin-bottom: 10px;
        }

        .screenshot {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
            margin: 10px 0;
        }

        .map-image {
            width: 100%;
            max-height: 400px;
            object-fit: contain;
            border: 1px solid #dee2e6;
            border-radius: 8px;
        }
    </style>
</head>
<body>
    <!-- Cover Page -->
    <div class="cover-page page-break">
        <h1>🗾 {{ route.origin.name }} 圣地巡礼手册</h1>
        <p>📅 {{ weather.date }}</p>
        <p>📍 起点: {{ route.origin.name }}</p>
        <p>🎬 {{ bangumi_list|length }} 部番剧 · {{ route.segments|length }} 个圣地</p>

        {% if bangumi_list %}
        <div style="margin-top: 40px;">
            {% for bangumi in bangumi_list[:4] %}
            <div style="display: inline-block; margin: 10px;">
                <img src="{{ bangumi.cover_url }}" style="width: 150px; height: 220px; object-fit: cover; border-radius: 8px;">
                <p>{{ bangumi.cn_title }}</p>
            </div>
            {% endfor %}
        </div>
        {% endif %}
    </div>

    <!-- Route Overview -->
    <div class="page-break">
        <h2>📍 路线总览</h2>

        {% if map_image_path %}
        <img src="{{ map_image_path }}" class="map-image" alt="Route Map">
        {% endif %}

        <div class="route-info">
            <h3>基本信息</h3>
            <ul>
                <li>总距离: {{ route.total_distance_km }} km</li>
                <li>预计时间: {{ route.total_duration_formatted }}</li>
                <li>圣地数量: {{ route.segments|length }}</li>
                <li>天气: {{ weather.condition }} ({{ weather.temperature_range }})</li>
            </ul>
        </div>
    </div>

    <!-- Point Details -->
    {% for segment in route.segments %}
    <div class="point-card">
        <h3>第{{ segment.order }}站: {{ segment.point.cn_name }}</h3>
        <p><strong>番剧:</strong> {{ segment.point.bangumi_title }}</p>
        <p><strong>集数:</strong> 第{{ segment.point.episode }}集 {{ segment.point.time_formatted }}</p>

        {% if segment.point.screenshot_url %}
        <img src="{{ segment.point.screenshot_url }}" class="screenshot" alt="Scene">
        {% endif %}

        {% if segment.point.address %}
        <p><strong>地址:</strong> {{ segment.point.address }}</p>
        {% endif %}

        {% if segment.transport %}
        <div style="background: #e3f2fd; padding: 10px; border-left: 4px solid #2196f3; margin-top: 10px;">
            <strong>交通:</strong> {{ segment.transport.mode }}
            ({{ segment.transport.distance_km }}km, {{ segment.transport.duration_formatted }})
            {% if segment.transport.instructions %}
            <br>{{ segment.transport.instructions }}
            {% endif %}
        </div>
        {% endif %}
    </div>

    {% if loop.index % 3 == 0 and not loop.last %}
    <div class="page-break"></div>
    {% endif %}
    {% endfor %}
</body>
</html>
```

**Acceptance Criteria**:
- ✅ HTML template with Jinja2
- ✅ Playwright PDF generation
- ✅ Image embedding support
- ✅ Proper page breaks
- ✅ CJK font support

---

### TASK-033: E2E Test Suite
**Priority**: P1 (Critical)
**Duration**: 2 hours
**Dependencies**: All components complete

**Implementation**:
```python
# tests/e2e/test_full_flow.py

import pytest
import asyncio
from unittest.mock import Mock, patch
from domain.entities import *
from agents.orchestrator import OrchestratorAgent

@pytest.mark.asyncio
async def test_complete_pilgrimage_flow():
    """
    Test the entire flow from station input to PDF output.
    """
    # Setup mocks
    with patch('services.anitabi_client.AnitabiClient') as MockAnitabi, \
         patch('services.gmaps_client.GoogleMapsClient') as MockGMaps:

        # Configure mocks
        anitabi = MockAnitabi.return_value
        gmaps = MockGMaps.return_value

        # Mock geocoding
        gmaps.geocode_station.return_value = Coordinates(35.6896, 139.7006)

        # Mock bangumi search
        anitabi.search_bangumi_near.return_value = [
            Bangumi(
                id="115908",
                title="君の名は。",
                cn_title="你的名字",
                cover_url="https://example.com/cover.jpg",
                points_count=15,
                distance_km=1.2
            )
        ]

        # Mock points
        anitabi.get_points_in_radius.return_value = [
            Point(
                id="p1",
                name="新宿御苑",
                cn_name="新宿御苑",
                coordinates=Coordinates(35.6851, 139.7100),
                bangumi_id="115908",
                bangumi_title="你的名字",
                episode=12,
                time_seconds=345,
                screenshot_url="https://example.com/shot.jpg"
            )
        ]

        # Mock route optimization
        gmaps.optimize_route.return_value = {
            "legs": [{
                "distance": {"value": 1200},
                "duration": {"value": 900}
            }],
            "waypoint_order": [0]
        }

        # Run orchestrator
        orchestrator = OrchestratorAgent()
        result = await orchestrator.execute_pilgrimage_plan("新宿駅")

        # Assertions
        assert result is not None
        assert "map_path" in result
        assert "pdf_path" in result
        assert result["status"] == "success"

@pytest.mark.asyncio
async def test_error_handling():
    """Test error handling throughout the flow."""
    # Test invalid station
    orchestrator = OrchestratorAgent()

    with patch('services.gmaps_client.GoogleMapsClient.geocode_station') as mock:
        mock.side_effect = ValueError("Station not found")

        with pytest.raises(ValueError) as exc:
            await orchestrator.execute_pilgrimage_plan("InvalidStation")

        assert "无法识别车站" in str(exc.value)

@pytest.mark.asyncio
async def test_performance_benchmark():
    """Test that the entire flow completes within 30 seconds."""
    import time

    orchestrator = OrchestratorAgent()

    # Mock all external calls for speed
    with patch.multiple(
        'services.anitabi_client.AnitabiClient',
        search_bangumi_near=Mock(return_value=[]),
        get_points_in_radius=Mock(return_value=[])
    ):
        start_time = time.time()
        await orchestrator.execute_pilgrimage_plan("東京駅")
        duration = time.time() - start_time

        assert duration < 30, f"Flow took {duration:.2f}s (limit: 30s)"
```

---

## 📊 Daily Execution Plan

### Day 1 Morning (08:00-12:00)
```
08:00-10:00: TASK-025 (Google Maps Core)
10:00-12:00: TASK-026 (Routing Service)
[SYNC with Agent A & B at 12:00]
```

### Day 1 Afternoon (13:00-17:00)
```
13:00-14:00: TASK-027 (URL Builder)
14:00-15:00: TASK-028 (Caching)
15:00-17:00: Integration testing
[SYNC at 17:00]
```

### Day 2 Morning (08:00-12:00)
```
08:00-10:00: TASK-029 (PDF Core)
10:00-11:30: TASK-030 (Templates)
11:30-12:00: Testing
[SYNC at 12:00]
```

### Day 2 Afternoon (13:00-17:00)
```
13:00-14:00: TASK-031 (Image Optimization)
14:00-15:00: TASK-032 (Playwright Setup)
15:00-17:00: PDF generation testing
[SYNC at 17:00]
```

### Day 3 Morning (08:00-12:00)
```
08:00-10:00: TASK-033 (E2E Tests)
10:00-11:30: TASK-034 (CI/CD)
11:30-12:00: Pipeline testing
[Final SYNC at 12:00]
```

### Day 3 Afternoon (13:00-15:00)
```
13:00-14:00: TASK-035 (Deployment)
14:00-15:00: TASK-036 (Documentation)
[DEMO at 15:00]
```

---

## 🔄 Handoff Points

### To Agent A
- After TASK-025/026: Google Maps client ready
- After TASK-029: PDF generator ready
- After TASK-033: E2E tests complete

### To Agent B
- After TASK-025: Coordinate system defined
- After TASK-029: Map screenshot requirements
- After TASK-033: Performance benchmarks

### From Agent A
- Before TASK-025: Domain models needed
- Before TASK-029: Route structure defined
- Before TASK-033: All agents complete

### From Agent B
- Before TASK-029: Map HTML generated
- Before TASK-033: API mocks ready
- Before TASK-035: Docker config needed

---

## ✅ Personal Checklist

### Day 1
- [ ] Google Maps client operational
- [ ] Routing service complete
- [ ] URL builders working
- [ ] Caching implemented
- [ ] Integration confirmed

### Day 2
- [ ] PDF generator functional
- [ ] Templates designed
- [ ] Images optimized
- [ ] Playwright configured
- [ ] PDFs generating correctly

### Day 3
- [ ] E2E tests passing
- [ ] CI/CD pipeline ready
- [ ] Deployment configured
- [ ] Documentation complete
- [ ] Demo prepared

---

## 📝 Testing Strategy & Quality Gates

### Unit Test Coverage Targets
- Domain entities: 100%
- Service layer: >90%
- Agents: >85%
- Tools: >80%
- Overall: >85%

### Integration Test Scenarios
1. Station → Coordinates (Google Maps)
2. Coordinates → Bangumi (Anitabi)
3. Bangumi → Points (Anitabi)
4. Points → Route (Google Maps)
5. Route → Map (Folium)
6. Route → PDF (Playwright)

### E2E Test Cases
1. Happy path: Valid station, 1 bangumi, 5 points
2. Edge case: 30+ points (chunking)
3. Error case: Invalid station name
4. Performance: <30 second completion

### Performance Benchmarks
- Geocoding: <1 second
- Bangumi search: <5 seconds
- Route optimization: <3 seconds
- Map generation: <2 seconds
- PDF generation: <5 seconds
- **Total E2E**: <30 seconds

---

## 🚀 Deployment Configuration

### Docker Setup
```dockerfile
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers
RUN playwright install chromium

# Copy application
COPY . /app
WORKDIR /app

CMD ["python", "main.py"]
```

### Environment Variables
```bash
# .env.production
GOOGLE_MAPS_API_KEY=prod_key_here
GEMINI_API_KEY=prod_key_here
LOG_LEVEL=INFO
OUTPUT_DIR=/data/outputs
TEMPLATE_DIR=/app/templates
```

---

**Agent**: C (Tools & Testing Expert)
**Last Updated**: 2025-11-20 09:00
**Next Checkpoint**: 2025-11-20 12:00 (Sync Point 1)