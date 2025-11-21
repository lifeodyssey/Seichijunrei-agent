# 🔌 Agent B - API Integration Specialist Task List

**Role**: API Integration Specialist & Data Services Expert
**Focus**: External API Integration, Data Transformation, Performance Optimization
**Total Story Points**: 40
**Total Tasks**: 12

---

## 📋 Task Overview

| Task ID | Title | Priority | Points | Duration | Status |
|---------|-------|----------|---------|----------|--------|
| TASK-013 | Anitabi Client Core | P0 | 5 | 2h | 🔴 Not Started |
| TASK-014 | Anitabi Search Logic | P0 | 5 | 2h | 🔴 Not Started |
| TASK-015 | API Response Parsing | P1 | 3 | 1h | 🔴 Not Started |
| TASK-016 | Distance Calculation | P1 | 2 | 1h | 🔴 Not Started |
| TASK-017 | API Caching Layer | P2 | 3 | 1h | 🔴 Not Started |
| TASK-018 | MapGenerator Tool | P1 | 5 | 2.5h | 🔴 Not Started |
| TASK-019 | Map Interaction Features | P2 | 3 | 1.5h | 🔴 Not Started |
| TASK-020 | Parallel API Optimization | P2 | 3 | 1h | 🔴 Not Started |
| TASK-021 | Performance Testing | P2 | 3 | 1h | 🔴 Not Started |
| TASK-022 | Mock Data System | P3 | 2 | 1h | 🔴 Not Started |
| TASK-023 | API Error Handling | P1 | 3 | 1h | 🔴 Not Started |
| TASK-024 | Rate Limiting | P2 | 3 | 0.5h | 🔴 Not Started |

---

## 📝 Detailed Task Specifications

### TASK-013: Anitabi Client Core
**Priority**: P0 (Blocker for Agent A)
**Duration**: 2 hours
**Dependencies**: A-002 (Domain Models)

**Scope**:
Implement the core Anitabi API client with basic HTTP operations.

**Implementation**:
```python
# services/anitabi_client.py

import aiohttp
import asyncio
from typing import List, Dict, Optional
from domain.entities import Bangumi, Point, Coordinates
from config.settings import settings
from utils.logger import get_logger

logger = get_logger(__name__)

class AnitabiClient:
    """
    Client for Anitabi API interactions.

    Challenge: Anitabi doesn't support geographic search,
    so we need to fetch bangumi and filter by distance.
    """

    def __init__(self):
        self.base_url = settings.anitabi_base_url
        self.session: Optional[aiohttp.ClientSession] = None
        self._bangumi_cache: Dict[str, dict] = {}
        self._points_cache: Dict[str, List[dict]] = {}

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=settings.api_timeout_seconds)
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> dict:
        """
        Base HTTP request method with retry logic.
        """
        url = f"{self.base_url}{endpoint}"
        retries = 3

        for attempt in range(retries):
            try:
                async with self.session.request(method, url, **kwargs) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.debug(f"API call successful: {endpoint}")
                        return data
                    else:
                        logger.warning(f"API returned {response.status}: {endpoint}")

            except asyncio.TimeoutError:
                logger.warning(f"Timeout on attempt {attempt + 1}: {endpoint}")
            except Exception as e:
                logger.error(f"Request failed: {e}")

            if attempt < retries - 1:
                await asyncio.sleep(1)  # Wait before retry

        raise ConnectionError(f"Failed to fetch {endpoint} after {retries} attempts")

    async def get_bangumi_lite(self, bangumi_id: str) -> dict:
        """
        Get bangumi basic info with up to 10 points.
        Endpoint: /bangumi/{id}/lite
        """
        if bangumi_id in self._bangumi_cache:
            logger.debug(f"Cache hit for bangumi {bangumi_id}")
            return self._bangumi_cache[bangumi_id]

        data = await self._request("GET", f"/bangumi/{bangumi_id}/lite")
        self._bangumi_cache[bangumi_id] = data
        return data

    async def get_bangumi_points(
        self,
        bangumi_id: str,
        have_image: bool = True
    ) -> List[dict]:
        """
        Get all points for a bangumi.
        Endpoint: /bangumi/{id}/points/detail
        """
        cache_key = f"{bangumi_id}_{have_image}"
        if cache_key in self._points_cache:
            logger.debug(f"Cache hit for points {bangumi_id}")
            return self._points_cache[cache_key]

        params = {"haveImage": str(have_image).lower()}
        data = await self._request(
            "GET",
            f"/bangumi/{bangumi_id}/points/detail",
            params=params
        )

        points = data.get("points", [])
        self._points_cache[cache_key] = points
        logger.info(f"Fetched {len(points)} points for bangumi {bangumi_id}")
        return points
```

**Popular Bangumi List** (for searching):
```python
# data/popular_bangumi.py

POPULAR_BANGUMI_IDS = [
    "115908",  # 你的名字
    "126461",  # 天气之子
    "253599",  # 铃芽之旅
    "2907",    # 秒速5厘米
    "1044",    # 言叶之庭
    "236",     # 新世纪福音战士
    "12189",   # 冰菓
    "835",     # 凉宫春日的忧郁
    "8074",    # STEINS;GATE
    "265",     # 交响诗篇
    # Add more popular anime IDs
]
```

**Testing**:
```python
# tests/unit/test_anitabi_client.py

@pytest.mark.asyncio
async def test_get_bangumi_lite():
    async with AnitabiClient() as client:
        # Mock response
        with aioresponses() as mocked:
            mocked.get(
                f"{client.base_url}/bangumi/115908/lite",
                payload={
                    "id": "115908",
                    "title": "君の名は。",
                    "cn_name": "你的名字",
                    "geo": [...]
                }
            )

            result = await client.get_bangumi_lite("115908")
            assert result["id"] == "115908"
            assert "geo" in result

@pytest.mark.asyncio
async def test_retry_on_timeout():
    async with AnitabiClient() as client:
        with aioresponses() as mocked:
            # First two attempts timeout
            mocked.get(..., exception=asyncio.TimeoutError())
            mocked.get(..., exception=asyncio.TimeoutError())
            # Third attempt succeeds
            mocked.get(..., payload={"success": True})

            result = await client._request("GET", "/test")
            assert result["success"] is True
```

**Acceptance Criteria**:
- ✅ HTTP client with session management
- ✅ Retry logic (3 attempts)
- ✅ Caching for repeated requests
- ✅ Error handling and logging
- ✅ Tests with mocked responses

---

### TASK-014: Anitabi Search Logic
**Priority**: P0 (Blocker for Agent A)
**Duration**: 2 hours
**Dependencies**: TASK-013

**Scope**:
Implement the geographic search logic for finding nearby bangumi.

**Implementation**:
```python
# services/anitabi_client.py (continued)

async def search_bangumi_near(
    self,
    center: Coordinates,
    radius_km: float = 5.0
) -> List[Bangumi]:
    """
    Search for bangumi with points near the given coordinates.

    Strategy:
    1. Fetch popular bangumi list
    2. Get lite info for each (parallel)
    3. Check if any point is within radius
    4. Return filtered and sorted list
    """
    from data.popular_bangumi import POPULAR_BANGUMI_IDS

    logger.info(f"Searching bangumi near {center} within {radius_km}km")

    # Parallel fetch with semaphore to limit concurrent requests
    semaphore = asyncio.Semaphore(settings.max_concurrent_requests)

    async def check_bangumi(bangumi_id: str) -> Optional[Bangumi]:
        async with semaphore:
            try:
                data = await self.get_bangumi_lite(bangumi_id)

                # Parse first point to check distance
                geo_list = data.get("geo", [])
                if not geo_list:
                    return None

                first_point = geo_list[0]
                lat, lon = map(float, first_point["geo"].split(","))
                point_coords = Coordinates(latitude=lat, longitude=lon)

                distance = center.distance_to(point_coords)

                if distance <= radius_km:
                    return Bangumi(
                        id=data["id"],
                        title=data.get("title", ""),
                        cn_title=data.get("cn_name", data.get("title", "")),
                        cover_url=data.get("image", "https://placeholder.com/cover.jpg"),
                        points_count=len(geo_list),
                        distance_km=round(distance, 2)
                    )

                return None

            except Exception as e:
                logger.warning(f"Failed to check bangumi {bangumi_id}: {e}")
                return None

    # Check all bangumi in parallel
    tasks = [check_bangumi(bid) for bid in POPULAR_BANGUMI_IDS]
    results = await asyncio.gather(*tasks)

    # Filter out None values and sort by distance
    bangumi_list = [b for b in results if b is not None]
    bangumi_list.sort(key=lambda b: b.distance_km or float('inf'))

    logger.info(f"Found {len(bangumi_list)} bangumi within {radius_km}km")
    return bangumi_list

async def get_points_in_radius(
    self,
    bangumi_ids: List[str],
    center: Coordinates,
    radius_km: float
) -> List[Point]:
    """
    Get all points for selected bangumi within radius.
    """
    all_points = []

    for bangumi_id in bangumi_ids:
        points_data = await self.get_bangumi_points(bangumi_id)

        for point_data in points_data:
            lat, lon = map(float, point_data["geo"].split(","))
            point_coords = Coordinates(latitude=lat, longitude=lon)

            if center.distance_to(point_coords) <= radius_km:
                # Parse episode info
                ep_list = point_data.get("ep", [])
                first_ep = ep_list[0] if ep_list else {}

                point = Point(
                    id=point_data["id"],
                    name=point_data.get("name", ""),
                    cn_name=point_data.get("cn_name", point_data.get("name", "")),
                    coordinates=point_coords,
                    bangumi_id=bangumi_id,
                    bangumi_title=point_data.get("bangumi_title", ""),
                    episode=first_ep.get("n", 0),
                    time_seconds=first_ep.get("s", 0),
                    screenshot_url=self._optimize_image_url(
                        first_ep.get("image", "https://placeholder.com/screenshot.jpg")
                    ),
                    address=point_data.get("address")
                )
                all_points.append(point)

    logger.info(f"Found {len(all_points)} points within radius")
    return all_points

def _optimize_image_url(self, url: str, resolution: str = "h360") -> str:
    """
    Optimize Anitabi image URL for faster loading.
    Options: h160 (thumbnail), h360 (medium), h800 (large)
    """
    if "image.anitabi.cn" in url and "?" not in url:
        return f"{url}?plan={resolution}"
    return url
```

**Performance Testing**:
```python
# tests/integration/test_search_performance.py

@pytest.mark.asyncio
async def test_search_performance():
    """Test that searching 50 bangumi completes within 5 seconds"""
    import time

    async with AnitabiClient() as client:
        center = Coordinates(latitude=35.6762, longitude=139.6503)

        start = time.time()
        results = await client.search_bangumi_near(center, radius_km=5.0)
        duration = time.time() - start

        assert duration < 5.0, f"Search took {duration:.2f}s (limit: 5s)"
        assert len(results) > 0
```

**Acceptance Criteria**:
- ✅ Geographic filtering works correctly
- ✅ Parallel fetching with concurrency limit
- ✅ Distance calculation accurate
- ✅ Performance < 5 seconds for 50 bangumi
- ✅ Results sorted by distance

---

### TASK-015: API Response Parsing
**Priority**: P1 (Critical)
**Duration**: 1 hour
**Dependencies**: TASK-014

**Scope**:
Implement robust parsing and validation of API responses.

**Implementation**:
```python
# services/parsers.py

from typing import Dict, List, Optional
from domain.entities import Bangumi, Point, Coordinates
from utils.logger import get_logger

logger = get_logger(__name__)

class AnitabiParser:
    """Parse and validate Anitabi API responses"""

    @staticmethod
    def parse_bangumi(data: dict) -> Optional[Bangumi]:
        """
        Parse bangumi data from API response.
        Handles missing fields gracefully.
        """
        try:
            return Bangumi(
                id=data.get("id", ""),
                title=data.get("title", "Unknown"),
                cn_title=data.get("cn_name", data.get("title", "Unknown")),
                cover_url=data.get("image", "https://placeholder.com/cover.jpg"),
                points_count=len(data.get("geo", [])),
                distance_km=data.get("distance_km")
            )
        except Exception as e:
            logger.error(f"Failed to parse bangumi: {e}, data: {data}")
            return None

    @staticmethod
    def parse_point(data: dict, bangumi_id: str, bangumi_title: str) -> Optional[Point]:
        """
        Parse point data from API response.
        """
        try:
            # Parse coordinates
            geo_str = data.get("geo", "")
            if not geo_str or "," not in geo_str:
                logger.warning(f"Invalid geo data: {geo_str}")
                return None

            lat_str, lon_str = geo_str.split(",", 1)
            coords = Coordinates(
                latitude=float(lat_str.strip()),
                longitude=float(lon_str.strip())
            )

            # Parse episode info
            ep_list = data.get("ep", [])
            if ep_list and isinstance(ep_list, list):
                first_ep = ep_list[0]
                episode = first_ep.get("n", 0)
                time_seconds = first_ep.get("s", 0)
                screenshot = first_ep.get("image", "")
            else:
                episode = 0
                time_seconds = 0
                screenshot = ""

            # Optimize image URL
            if screenshot and "image.anitabi.cn" in screenshot:
                screenshot = f"{screenshot}?plan=h360"
            elif not screenshot:
                screenshot = "https://placeholder.com/screenshot.jpg"

            return Point(
                id=data.get("id", ""),
                name=data.get("name", "Unknown"),
                cn_name=data.get("cn_name", data.get("name", "Unknown")),
                coordinates=coords,
                bangumi_id=bangumi_id,
                bangumi_title=bangumi_title,
                episode=episode,
                time_seconds=time_seconds,
                screenshot_url=screenshot,
                address=data.get("address")
            )

        except Exception as e:
            logger.error(f"Failed to parse point: {e}, data: {data}")
            return None

    @staticmethod
    def parse_points_response(data: dict, bangumi_id: str, bangumi_title: str) -> List[Point]:
        """
        Parse points detail response.
        """
        points = []
        points_data = data.get("points", [])

        for point_data in points_data:
            point = AnitabiParser.parse_point(point_data, bangumi_id, bangumi_title)
            if point:
                points.append(point)

        logger.info(f"Parsed {len(points)}/{len(points_data)} points")
        return points
```

**Validation Tests**:
```python
# tests/unit/test_parsers.py

def test_parse_bangumi_complete():
    data = {
        "id": "115908",
        "title": "君の名は。",
        "cn_name": "你的名字",
        "image": "https://image.anitabi.cn/bangumi/115908.jpg",
        "geo": [1, 2, 3]  # 3 points
    }

    bangumi = AnitabiParser.parse_bangumi(data)
    assert bangumi.id == "115908"
    assert bangumi.cn_title == "你的名字"
    assert bangumi.points_count == 3

def test_parse_bangumi_missing_fields():
    data = {"id": "123"}  # Minimal data

    bangumi = AnitabiParser.parse_bangumi(data)
    assert bangumi.id == "123"
    assert bangumi.title == "Unknown"
    assert bangumi.points_count == 0

def test_parse_point_with_episode():
    data = {
        "id": "p001",
        "name": "新宿御苑",
        "geo": "35.6851,139.7100",
        "ep": [{"n": 12, "s": 345, "image": "https://img.jpg"}]
    }

    point = AnitabiParser.parse_point(data, "115908", "你的名字")
    assert point.name == "新宿御苑"
    assert point.episode == 12
    assert point.time_seconds == 345
    assert "?plan=h360" in point.screenshot_url
```

**Acceptance Criteria**:
- ✅ Parse all required fields
- ✅ Handle missing/invalid data gracefully
- ✅ Image URL optimization
- ✅ Comprehensive error logging
- ✅ >90% test coverage

---

### TASK-016: Distance Calculation
**Priority**: P1 (Critical)
**Duration**: 1 hour
**Dependencies**: A-002 (Domain Models)

**Implementation**:
```python
# utils/geo_utils.py

import math
from typing import List, Tuple
from domain.entities import Coordinates, Point

def haversine_distance(coord1: Coordinates, coord2: Coordinates) -> float:
    """
    Calculate the great-circle distance between two points on Earth.
    Returns distance in kilometers.
    """
    R = 6371  # Earth's radius in kilometers

    lat1, lon1 = math.radians(coord1.latitude), math.radians(coord1.longitude)
    lat2, lon2 = math.radians(coord2.latitude), math.radians(coord2.longitude)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c

def filter_points_by_radius(
    center: Coordinates,
    points: List[Point],
    radius_km: float
) -> List[Point]:
    """
    Filter points within specified radius from center.
    """
    filtered = []

    for point in points:
        distance = haversine_distance(center, point.coordinates)
        if distance <= radius_km:
            filtered.append(point)

    return filtered

def sort_points_by_distance(
    center: Coordinates,
    points: List[Point]
) -> List[Tuple[Point, float]]:
    """
    Sort points by distance from center.
    Returns list of (point, distance) tuples.
    """
    points_with_distance = [
        (point, haversine_distance(center, point.coordinates))
        for point in points
    ]

    points_with_distance.sort(key=lambda x: x[1])
    return points_with_distance

def calculate_route_distance(points: List[Point]) -> float:
    """
    Calculate total distance for visiting points in order.
    """
    if len(points) < 2:
        return 0.0

    total_distance = 0.0

    for i in range(len(points) - 1):
        distance = haversine_distance(
            points[i].coordinates,
            points[i + 1].coordinates
        )
        total_distance += distance

    return total_distance
```

**Tests**:
```python
# tests/unit/test_geo_utils.py

def test_haversine_distance():
    # Tokyo to Osaka (~400km)
    tokyo = Coordinates(latitude=35.6762, longitude=139.6503)
    osaka = Coordinates(latitude=34.6937, longitude=135.5023)

    distance = haversine_distance(tokyo, osaka)
    assert 395 < distance < 405  # Should be ~400km

def test_filter_points_by_radius():
    center = Coordinates(latitude=35.6762, longitude=139.6503)

    points = [
        Point(..., coordinates=Coordinates(35.6800, 139.6500)),  # ~0.5km
        Point(..., coordinates=Coordinates(35.7000, 139.7000)),  # ~5km
        Point(..., coordinates=Coordinates(36.0000, 140.0000)),  # ~50km
    ]

    filtered = filter_points_by_radius(center, points, 10.0)
    assert len(filtered) == 2  # Only first two points
```

---

### TASK-017: API Caching Layer
**Priority**: P2 (Important)
**Duration**: 1 hour
**Dependencies**: TASK-015

[Continue with remaining tasks...]

---

### TASK-018: MapGenerator Tool
**Priority**: P1 (Critical)
**Duration**: 2.5 hours
**Dependencies**: A-007 (RouteAgent)

**Scope**:
Implement interactive map generation using Folium/Leafmap.

**Implementation**:
```python
# tools/map_generator.py

import folium
from folium import plugins
from typing import List, Optional
from domain.entities import Route, Point, Station
from utils.logger import get_logger

logger = get_logger(__name__)

class MapGeneratorTool:
    """
    Generate interactive HTML maps for pilgrimage routes.
    """

    def __init__(self):
        self.colors = [
            'red', 'blue', 'green', 'purple', 'orange',
            'darkred', 'lightred', 'beige', 'darkblue', 'darkgreen'
        ]

    async def generate(
        self,
        route: Route,
        output_path: str = "outputs/map.html"
    ) -> str:
        """
        Generate interactive map with route visualization.
        """
        logger.info(f"Generating map with {len(route.segments)} points")

        # Create base map centered on starting station
        center_lat = route.origin.coordinates.latitude
        center_lon = route.origin.coordinates.longitude

        m = folium.Map(
            location=[center_lat, center_lon],
            zoom_start=13,
            tiles='OpenStreetMap'
        )

        # Add starting station marker
        folium.Marker(
            location=[center_lat, center_lon],
            popup=folium.Popup(
                f"<b>起点：{route.origin.name}</b>",
                max_width=200
            ),
            icon=folium.Icon(color='blue', icon='star'),
            tooltip="起点"
        ).add_to(m)

        # Group points by bangumi for coloring
        bangumi_colors = {}
        color_index = 0

        # Add point markers
        for i, segment in enumerate(route.segments, 1):
            point = segment.point

            # Assign color by bangumi
            if point.bangumi_id not in bangumi_colors:
                bangumi_colors[point.bangumi_id] = self.colors[color_index % len(self.colors)]
                color_index += 1

            color = bangumi_colors[point.bangumi_id]

            # Create popup content with image
            popup_html = f"""
            <div style="width: 250px;">
                <h4>{i}. {point.cn_name}</h4>
                <p><b>番剧:</b> {point.bangumi_title}</p>
                <p><b>集数:</b> 第{point.episode}集 {point.time_formatted}</p>
                <img src="{point.screenshot_url}" style="width: 100%;" />
                <p><small>{point.address or '地址未知'}</small></p>
            </div>
            """

            folium.Marker(
                location=[
                    point.coordinates.latitude,
                    point.coordinates.longitude
                ],
                popup=folium.Popup(popup_html, max_width=250),
                icon=folium.Icon(color=color, icon='info-sign'),
                tooltip=f"{i}. {point.cn_name}"
            ).add_to(m)

        # Draw route lines
        route_coords = [[route.origin.coordinates.latitude, route.origin.coordinates.longitude]]

        for segment in route.segments:
            route_coords.append([
                segment.point.coordinates.latitude,
                segment.point.coordinates.longitude
            ])

        folium.PolyLine(
            route_coords,
            color='blue',
            weight=2.5,
            opacity=0.8
        ).add_to(m)

        # Add distance and time info
        info_html = f"""
        <div style="position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 200px;
                    background: white;
                    padding: 10px;
                    border-radius: 5px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    z-index: 1000;">
            <h4>路线信息</h4>
            <p>📍 圣地数量: {len(route.segments)}</p>
            <p>📏 总距离: {route.total_distance_km:.1f} km</p>
            <p>⏱️ 预计时间: {route.total_duration_formatted}</p>
        </div>
        """

        m.get_root().html.add_child(folium.Element(info_html))

        # Add fullscreen button
        plugins.Fullscreen().add_to(m)

        # Add minimap
        minimap = plugins.MiniMap()
        m.add_child(minimap)

        # Save map
        m.save(output_path)
        logger.info(f"Map saved to {output_path}")

        return output_path

    async def screenshot(
        self,
        map_path: str,
        output_path: str = "outputs/map_screenshot.png"
    ) -> str:
        """
        Take screenshot of map for PDF embedding.
        Requires playwright.
        """
        from playwright.async_api import async_playwright
        from pathlib import Path

        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(
                viewport={"width": 1200, "height": 800}
            )

            # Load map HTML
            file_url = f"file://{Path(map_path).absolute()}"
            await page.goto(file_url)

            # Wait for map to render
            await page.wait_for_timeout(2000)

            # Take screenshot
            await page.screenshot(path=output_path)
            await browser.close()

        logger.info(f"Screenshot saved to {output_path}")
        return output_path
```

**Acceptance Criteria**:
- ✅ Interactive map with all markers
- ✅ Different colors for different bangumi
- ✅ Popup with images and details
- ✅ Route polyline displayed
- ✅ Screenshot capability for PDF

---

## 📊 Daily Execution Plan

### Day 1 Morning (08:00-12:00)
```
08:00-10:00: TASK-013 (Anitabi Client Core)
10:00-12:00: TASK-014 (Search Logic)
[SYNC with Agent A at 12:00]
```

### Day 1 Afternoon (13:00-17:00)
```
13:00-14:00: TASK-015 (API Parsing)
14:00-15:00: TASK-016 (Distance Calc)
15:00-17:00: Testing & Integration
[SYNC with team at 17:00]
```

### Day 2 Morning (08:00-12:00)
```
08:00-09:00: TASK-017 (Caching)
09:00-11:30: TASK-018 (MapGenerator)
11:30-12:00: Testing
[SYNC at 12:00]
```

### Day 2 Afternoon (13:00-17:00)
```
13:00-14:30: TASK-019 (Map Features)
14:30-15:30: TASK-020 (Optimization)
15:30-17:00: Integration testing
[SYNC at 17:00]
```

### Day 3 Morning (08:00-12:00)
```
08:00-09:00: TASK-021 (Performance)
09:00-10:00: TASK-022 (Mock Data)
10:00-12:00: Bug fixes
[Final sync at 12:00]
```

### Day 3 Afternoon (13:00-15:00)
```
13:00-14:00: TASK-023 (Error Handling)
14:00-14:30: TASK-024 (Rate Limiting)
14:30-15:00: Final testing
```

---

## 🔄 Handoff Points

### To Agent A
- After TASK-013/014: Anitabi client ready for SearchAgent
- After TASK-018: MapGenerator ready for integration
- After TASK-021: Performance metrics available

### To Agent C
- After TASK-014: API patterns for testing
- After TASK-018: Map HTML for PDF embedding
- After TASK-022: Mock data for tests

### From Agent A
- Before TASK-013: Domain models needed
- Before TASK-018: Route structure defined
- Before TASK-021: Full integration complete

### From Agent C
- Before TASK-018: Leafmap/Folium setup confirmed
- Before TASK-021: Testing framework ready
- Before TASK-024: Deployment config ready

---

## ✅ Personal Checklist

### Day 1
- [ ] Anitabi client fully functional
- [ ] Search logic tested
- [ ] API parsing robust
- [ ] Distance calculations accurate
- [ ] Integration with Agent A confirmed

### Day 2
- [ ] Caching implemented
- [ ] Map generator working
- [ ] Map features complete
- [ ] Performance optimized
- [ ] All integrations tested

### Day 3
- [ ] Performance benchmarks met
- [ ] Mock data system ready
- [ ] Error handling comprehensive
- [ ] Rate limiting implemented
- [ ] Ready for delivery

---

## 📝 Notes & Performance Targets

### API Performance
- Single bangumi fetch: < 500ms
- 50 bangumi search: < 5 seconds
- Points fetching: < 1 second per bangumi
- Cache hit ratio: > 70%

### Map Generation
- HTML generation: < 2 seconds
- Screenshot: < 5 seconds
- File size: < 5MB
- Markers limit: 100 points

### Critical Dependencies
1. **Anitabi API**: No official geographic search
2. **Rate limits**: Unknown, implement conservative limits
3. **Image URLs**: Use ?plan=h360 for optimization
4. **Parallel requests**: Max 10 concurrent

---

**Agent**: B (API Integration Specialist)
**Last Updated**: 2025-11-20 09:00
**Next Checkpoint**: 2025-11-20 12:00 (Sync Point 1)