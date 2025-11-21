# Seichijunrei Bot - Data Flow & API Contracts

**Version**: 1.0
**Created**: 2025-11-20
**Purpose**: 详细定义系统数据流、API交互和领域模型

---

## Table of Contents

1. [Overall Data Flow](#overall-data-flow)
2. [API Interactions](#api-interactions)
3. [Domain Model](#domain-model)
4. [Interface Contracts](#interface-contracts)
5. [Data Transformations](#data-transformations)

---

## Overall Data Flow

### High-Level Flow Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                    用户输入：车站名称                            │
│                    Example: "新宿站"                            │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                 Step 1: 地理编码 (SearchAgent)                  │
│                                                                 │
│  Input:  station_name: str                                     │
│  API:    Google Maps Geocoding API                             │
│  Output: Coordinates(lat: 35.6896, lon: 139.7006)             │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│             Step 2: 搜索附近番剧 (SearchAgent)                  │
│                                                                 │
│  Input:  Coordinates + radius_km: 5.0                          │
│  API:    Anitabi API (/bangumi/{id}/lite)                      │
│  Logic:  遍历热门番剧 → 计算距离 → 筛选半径内                    │
│  Output: List[Bangumi] (sorted by distance)                   │
│          [                                                      │
│            Bangumi(id="115908", title="你的名字",               │
│                   points_count=15, distance_km=1.2)            │
│          ]                                                      │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│              Step 3: 用户选择 (FilterAgent)                      │
│                                                                 │
│  Input:  List[Bangumi]                                         │
│  UI:     展示列表 → 用户多选                                     │
│  Output: selected_bangumi_ids: ["115908", "126461"]           │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│           Step 4: 获取圣地详情 (PointsAgent)                     │
│                                                                 │
│  Input:  selected_bangumi_ids + Coordinates + radius           │
│  API:    Anitabi API (/bangumi/{id}/points/detail)             │
│  Logic:  并行查询 → 筛选半径内 → 合并去重                        │
│  Output: List[Point] (25 points)                               │
│          [                                                      │
│            Point(id="p1", name="新宿御苑",                      │
│                 coordinates=(35.6851, 139.7100),               │
│                 bangumi_id="115908",                           │
│                 episode=12, screenshot_url="...")              │
│          ]                                                      │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│            Step 5: 生成最优路线 (RouteAgent)                     │
│                                                                 │
│  Input:  origin: Station + points: List[Point]                │
│  API:    Google Maps Directions API                            │
│  Params: mode=transit, optimize=true                           │
│  Output: Route(                                                │
│            origin=Station("新宿站"),                            │
│            segments=[RouteSegment(order=1, point=...), ...],  │
│            total_distance_km=6.5,                              │
│            total_duration_minutes=180,                         │
│            google_maps_url="https://..."                       │
│          )                                                      │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ├───────────────────────┐
                       │                       │
                       ▼                       ▼
┌──────────────────────────────┐  ┌───────────────────────────────┐
│   Step 6a: 生成地图           │  │   Step 6b: 生成PDF           │
│   (MapGeneratorTool)          │  │   (PDFGeneratorTool)          │
│                               │  │                               │
│  Input:  Route               │  │  Input:  Route + map_image    │
│  Library: Leafmap            │  │  Library: Playwright + Jinja2 │
│  Output: map.html            │  │  Output: pilgrimage_guide.pdf │
└──────────────────────────────┘  └───────────────────────────────┘
                       │                       │
                       └───────────┬───────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────┐
│                      最终输出给用户                              │
│                                                                 │
│  - 交互式HTML地图：outputs/map.html                             │
│  - PDF巡礼手册：outputs/pilgrimage_guide.pdf                    │
│  - Google Maps导航链接：https://www.google.com/maps/dir/...   │
│  - 路线摘要：25个圣地，6.5km，预计3小时                         │
└────────────────────────────────────────────────────────────────┘
```

---

## API Interactions

### 1. Google Maps Geocoding API

**Endpoint**: `GET https://maps.googleapis.com/maps/api/geocode/json`

**Request**:
```http
GET /maps/api/geocode/json?address=新宿駅&key=YOUR_API_KEY&language=ja
```

**Request Parameters**:
```python
{
    "address": str,      # 地址或地名（如"新宿駅"）
    "key": str,          # API密钥
    "language": str,     # 语言偏好（ja/zh/en）
}
```

**Response** (Success):
```json
{
  "status": "OK",
  "results": [
    {
      "formatted_address": "日本、〒160-0022 東京都新宿区新宿３丁目３８−１",
      "geometry": {
        "location": {
          "lat": 35.6896067,
          "lng": 139.7005713
        }
      }
    }
  ]
}
```

**Response** (Error):
```json
{
  "status": "ZERO_RESULTS",  // 或 "INVALID_REQUEST", "REQUEST_DENIED"
  "error_message": "..."
}
```

**Data Transformation**:
```python
# Input
station_name = "新宿駅"

# API Response → Domain Entity
api_response = await geocoding_api.get(...)
location = api_response["results"][0]["geometry"]["location"]

# Output
coordinates = Coordinates(
    latitude=location["lat"],
    longitude=location["lng"]
)
```

---

### 2. Anitabi API - 搜索番剧

**Note**: Anitabi API不支持按坐标搜索，需要遍历已知番剧列表。

**Endpoint 1**: `GET https://api.anitabi.cn/bangumi/{id}/lite`

**Purpose**: 获取番剧基础信息（包含最多10个圣地）

**Request**:
```http
GET /bangumi/115908/lite
```

**Response**:
```json
{
  "id": "115908",
  "title": "君の名は。",
  "cn_name": "你的名字",
  "image": "https://image.anitabi.cn/bangumi/115908.jpg",
  "geo": [
    {
      "id": "point_001",
      "name": "新宿御苑",
      "cn_name": "新宿御苑",
      "geo": "35.6851,139.7100",
      "ep": [
        {"n": 12, "s": 345, "image": "https://..."}
      ]
    },
    // ... 最多10个圣地
  ]
}
```

**Endpoint 2**: `GET https://api.anitabi.cn/bangumi/{id}/points/detail`

**Purpose**: 获取番剧的所有圣地详情

**Request**:
```http
GET /bangumi/115908/points/detail?haveImage=true
```

**Request Parameters**:
```python
{
    "haveImage": bool,  # 仅返回有截图的圣地（推荐true）
}
```

**Response**:
```json
{
  "id": "115908",
  "points": [
    {
      "id": "point_001",
      "name": "新宿御苑",
      "cn_name": "新宿御苑",
      "geo": "35.6851,139.7100",
      "address": "東京都新宿区内藤町11",
      "ep": [
        {
          "n": 12,           // 第12集
          "s": 345,          // 345秒（5:45）
          "image": "https://image.anitabi.cn/i/point_001.jpg"
        }
      ]
    },
    // ... 所有圣地
  ]
}
```

**Data Transformation**:
```python
# API Response → Domain Entity
api_response = await anitabi_api.get(f"/bangumi/{bangumi_id}/points/detail")

points = []
for raw_point in api_response["points"]:
    lat, lon = map(float, raw_point["geo"].split(","))

    # 取第一个截图（如果有多个集数）
    first_ep = raw_point["ep"][0] if raw_point["ep"] else None

    point = Point(
        id=raw_point["id"],
        name=raw_point["name"],
        cn_name=raw_point["cn_name"],
        coordinates=Coordinates(latitude=lat, longitude=lon),
        bangumi_id=bangumi_id,
        bangumi_title=bangumi_title,
        episode=first_ep["n"] if first_ep else 0,
        time_seconds=first_ep["s"] if first_ep else 0,
        screenshot_url=f"{first_ep['image']}?plan=h360" if first_ep else "",
        address=raw_point.get("address")
    )
    points.append(point)
```

**Image URL Optimization**:
```python
# 原始URL（大图，可能很慢）
original = "https://image.anitabi.cn/i/point_001.jpg"

# 优化：使用中等分辨率
optimized = f"{original}?plan=h360"  # 高度360px

# 其他选项：
# ?plan=h160  - 缩略图（160px高）
# ?plan=h800  - 高清（800px高）
```

---

### 3. Google Maps Directions API

**Endpoint**: `GET https://maps.googleapis.com/maps/api/directions/json`

**Request**:
```http
GET /maps/api/directions/json?
    origin=35.6896,139.7006&
    destination=35.6851,139.7100&
    waypoints=optimize:true|35.6700,139.7200|35.6800,139.7150&
    mode=transit&
    key=YOUR_API_KEY
```

**Request Parameters**:
```python
{
    "origin": str,          # 起点坐标 "lat,lon"
    "destination": str,     # 终点坐标 "lat,lon"
    "waypoints": str,       # "optimize:true|lat1,lon1|lat2,lon2|..."
    "mode": str,            # "transit" | "walking" | "driving"
    "key": str,             # API密钥
}
```

**Important Constraints**:
- **最多23个waypoints**（不含起点和终点）
- 如果圣地>23个，需要分段处理或使用贪心算法

**Response**:
```json
{
  "status": "OK",
  "routes": [
    {
      "legs": [
        {
          "start_location": {"lat": 35.6896, "lng": 139.7006},
          "end_location": {"lat": 35.6700, "lng": 139.7200},
          "distance": {"value": 1500, "text": "1.5 km"},
          "duration": {"value": 900, "text": "15 mins"},
          "steps": [
            {
              "travel_mode": "WALKING",
              "distance": {"value": 200, "text": "200 m"},
              "duration": {"value": 120, "text": "2 mins"},
              "html_instructions": "Head <b>south</b> on..."
            }
          ]
        }
      ],
      "waypoint_order": [2, 0, 1],  // 优化后的访问顺序（索引）
      "overview_polyline": {
        "points": "encoded_polyline_string"  // 路线折线（编码）
      }
    }
  ]
}
```

**Data Transformation**:
```python
# Input
origin = Coordinates(35.6896, 139.7006)
points = [Point(...), Point(...), ...]  # 25个圣地

# API Response → Route Entity
api_response = await directions_api.get(...)
route_data = api_response["routes"][0]

# 重新排序圣地（根据waypoint_order）
waypoint_order = route_data["waypoint_order"]
optimized_points = [points[i] for i in waypoint_order]

# 构建RouteSegment列表
segments = []
for i, leg in enumerate(route_data["legs"]):
    segment = RouteSegment(
        order=i + 1,
        point=optimized_points[i],
        distance_from_previous_meters=leg["distance"]["value"],
        duration_from_previous_minutes=leg["duration"]["value"] // 60
    )
    segments.append(segment)

# Output
route = Route(
    origin=Station(name="新宿站", coordinates=origin),
    segments=segments,
    total_distance_km=sum(s.distance_from_previous_meters for s in segments) / 1000,
    total_duration_minutes=sum(s.duration_from_previous_minutes for s in segments),
    google_maps_url=build_navigation_url(origin, optimized_points)
)
```

---

## Domain Model

### Entity Relationship Diagram

```
┌─────────────────┐
│   Coordinates   │ (Value Object)
│─────────────────│
│ + latitude: float
│ + longitude: float
└─────────────────┘
         △
         │ contains
         │
    ┌────┴──────────────┬─────────────────────┐
    │                   │                     │
┌───┴────────┐  ┌───────┴────────┐  ┌────────┴────────┐
│  Station   │  │    Bangumi     │  │     Point       │
│────────────│  │────────────────│  │─────────────────│
│ + name     │  │ + id           │  │ + id            │
│ + coords   │  │ + title        │  │ + name          │
│ + city?    │  │ + cn_title     │  │ + cn_name       │
└────────────┘  │ + cover_url    │  │ + coordinates   │
                │ + points_count │  │ + bangumi_id    │
                │ + distance_km? │  │ + episode       │
                └────────────────┘  │ + screenshot_url│
                                    └─────────────────┘
                                            △
                                            │ contains
                                            │
                                    ┌───────┴──────────┐
                                    │  RouteSegment    │ (Value Object)
                                    │──────────────────│
                                    │ + order          │
                                    │ + point          │
                                    │ + distance_from_previous
                                    │ + duration_from_previous
                                    └──────────────────┘
                                            △
                                            │ contains
                                            │
                                    ┌───────┴──────────┐
                                    │     Route        │ (Aggregate Root)
                                    │──────────────────│
                                    │ + origin         │
                                    │ + segments: List │
                                    │ + total_distance │
                                    │ + total_duration │
                                    │ + google_maps_url│
                                    └──────────────────┘
```

### Domain Entities (Pydantic Models)

```python
from pydantic import BaseModel, HttpUrl, field_validator
from typing import Optional

# === Value Objects ===

class Coordinates(BaseModel, frozen=True):
    """GPS坐标（不可变值对象）"""
    latitude: float   # 纬度：-90 ~ 90
    longitude: float  # 经度：-180 ~ 180

    @field_validator('latitude')
    @classmethod
    def validate_latitude(cls, v: float) -> float:
        if not -90 <= v <= 90:
            raise ValueError('Latitude must be between -90 and 90')
        return v

    @field_validator('longitude')
    @classmethod
    def validate_longitude(cls, v: float) -> float:
        if not -180 <= v <= 180:
            raise ValueError('Longitude must be between -180 and 180')
        return v

# === Entities ===

class Station(BaseModel):
    """车站实体"""
    name: str
    coordinates: Coordinates
    city: Optional[str] = None

class Bangumi(BaseModel):
    """番剧实体"""
    id: str
    title: str                      # 原始名称（日文）
    cn_title: str                   # 中文名称
    cover_url: HttpUrl              # 封面图URL
    points_count: int               # 圣地数量
    distance_km: Optional[float] = None  # 距离车站的距离（可选）

class Point(BaseModel):
    """圣地点位实体"""
    id: str
    name: str                       # 原始名称（日文）
    cn_name: str                    # 中文名称
    coordinates: Coordinates
    bangumi_id: str
    bangumi_title: str
    episode: int                    # 对应集数
    time_seconds: int               # 场景时间（秒）
    screenshot_url: HttpUrl         # 场景截图URL
    address: Optional[str] = None   # 详细地址（可选）

class RouteSegment(BaseModel):
    """路线段（值对象）"""
    order: int                      # 第几站（从1开始）
    point: Point
    distance_from_previous_meters: int     # 距离上一站的距离（米）
    duration_from_previous_minutes: int    # 距离上一站的时间（分钟）

class Route(BaseModel):
    """路线（聚合根）"""
    origin: Station
    segments: list[RouteSegment]
    total_distance_km: float
    total_duration_minutes: int
    google_maps_url: HttpUrl
```

---

## Interface Contracts

### Service Interfaces (Protocols)

```python
from typing import Protocol
from domain.entities import Coordinates, Bangumi, Point, Route

class IGeocodingService(Protocol):
    """地理编码服务接口"""

    async def geocode_station(self, station_name: str) -> Coordinates:
        """
        将车站名称转换为GPS坐标

        Args:
            station_name: 车站名称（如"新宿站"、"新宿駅"）

        Returns:
            GPS坐标

        Raises:
            ValueError: 车站名称无效或无法识别
            ConnectionError: API调用失败
        """
        ...

class IAnitabiClient(Protocol):
    """Anitabi API客户端接口"""

    async def search_bangumi_near(
        self,
        coords: Coordinates,
        radius_km: float = 5.0
    ) -> list[Bangumi]:
        """
        搜索坐标附近的番剧

        Args:
            coords: 中心坐标
            radius_km: 搜索半径（公里），默认5.0

        Returns:
            番剧列表，按距离排序（近→远）

        Raises:
            ConnectionError: API调用失败
        """
        ...

    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        """
        获取番剧的所有圣地点位

        Args:
            bangumi_id: 番剧ID（如"115908"）

        Returns:
            圣地列表

        Raises:
            ValueError: 番剧ID无效
            ConnectionError: API调用失败
        """
        ...

class IRoutingService(Protocol):
    """路线规划服务接口"""

    async def optimize_route(
        self,
        origin: Coordinates,
        points: list[Point]
    ) -> Route:
        """
        生成最优巡礼路线

        Args:
            origin: 起点坐标
            points: 圣地列表（最多23个，受Google Maps限制）

        Returns:
            优化后的路线（包含访问顺序）

        Raises:
            ValueError: 圣地数量超过23个
            ConnectionError: API调用失败
        """
        ...

class IMapGenerator(Protocol):
    """地图生成器接口"""

    async def generate_map(
        self,
        route: Route,
        output_path: str = "outputs/map.html"
    ) -> str:
        """
        生成交互式HTML地图

        Args:
            route: 路线数据
            output_path: 输出文件路径

        Returns:
            生成的文件路径

        Raises:
            IOError: 文件写入失败
        """
        ...

class IPDFGenerator(Protocol):
    """PDF生成器接口"""

    async def generate_pdf(
        self,
        route: Route,
        map_screenshot_path: str,
        output_path: str = "outputs/pilgrimage_guide.pdf"
    ) -> str:
        """
        生成PDF巡礼手册

        Args:
            route: 路线数据
            map_screenshot_path: 地图截图路径
            output_path: 输出PDF路径

        Returns:
            生成的文件路径

        Raises:
            IOError: 文件写入失败
        """
        ...
```

---

## Data Transformations

### Transformation Pipeline

```
Raw API Data → Parse → Validate → Domain Entity → Business Logic → Output
```

### Example 1: Anitabi Point → Domain Point

```python
# === Input: Anitabi API Response ===
raw_point = {
    "id": "point_001",
    "name": "新宿御苑",
    "cn_name": "新宿御苑",
    "geo": "35.6851,139.7100",  # 字符串格式
    "address": "東京都新宿区内藤町11",
    "ep": [
        {"n": 12, "s": 345, "image": "https://image.anitabi.cn/i/p001.jpg"}
    ]
}

# === Transformation ===
def parse_anitabi_point(
    raw: dict,
    bangumi_id: str,
    bangumi_title: str
) -> Point:
    """Parse Anitabi API point to domain Point entity"""

    # 1. Parse coordinates (string → tuple)
    lat_str, lon_str = raw["geo"].split(",")
    coords = Coordinates(
        latitude=float(lat_str),
        longitude=float(lon_str)
    )

    # 2. Extract episode info (take first if multiple)
    episode_data = raw["ep"][0] if raw["ep"] else None
    episode = episode_data["n"] if episode_data else 0
    time_seconds = episode_data["s"] if episode_data else 0

    # 3. Optimize image URL (add resolution parameter)
    screenshot_url = (
        f"{episode_data['image']}?plan=h360"
        if episode_data
        else "https://placeholder.com/default.jpg"
    )

    # 4. Create domain entity
    return Point(
        id=raw["id"],
        name=raw["name"],
        cn_name=raw["cn_name"],
        coordinates=coords,
        bangumi_id=bangumi_id,
        bangumi_title=bangumi_title,
        episode=episode,
        time_seconds=time_seconds,
        screenshot_url=screenshot_url,
        address=raw.get("address")  # Optional field
    )

# === Output: Domain Entity ===
point = Point(
    id="point_001",
    name="新宿御苑",
    cn_name="新宿御苑",
    coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
    bangumi_id="115908",
    bangumi_title="你的名字",
    episode=12,
    time_seconds=345,
    screenshot_url="https://image.anitabi.cn/i/p001.jpg?plan=h360",
    address="東京都新宿区内藤町11"
)
```

### Example 2: Google Directions Response → Route

```python
# === Input: Google Directions API Response ===
api_response = {
    "status": "OK",
    "routes": [
        {
            "legs": [
                {
                    "distance": {"value": 1200, "text": "1.2 km"},
                    "duration": {"value": 900, "text": "15 mins"}
                },
                {
                    "distance": {"value": 800, "text": "800 m"},
                    "duration": {"value": 600, "text": "10 mins"}
                }
            ],
            "waypoint_order": [1, 0]  # 优化后的顺序
        }
    ]
}

# === Transformation ===
def parse_directions_response(
    api_response: dict,
    origin: Station,
    points: list[Point]
) -> Route:
    """Parse Google Directions response to domain Route entity"""

    route_data = api_response["routes"][0]
    legs = route_data["legs"]
    waypoint_order = route_data["waypoint_order"]

    # 1. Reorder points based on optimization
    optimized_points = [points[i] for i in waypoint_order]

    # 2. Build RouteSegments
    segments = []
    for i, (point, leg) in enumerate(zip(optimized_points, legs), start=1):
        segment = RouteSegment(
            order=i,
            point=point,
            distance_from_previous_meters=leg["distance"]["value"],
            duration_from_previous_minutes=leg["duration"]["value"] // 60
        )
        segments.append(segment)

    # 3. Calculate totals
    total_distance_km = sum(
        seg.distance_from_previous_meters for seg in segments
    ) / 1000

    total_duration_minutes = sum(
        seg.duration_from_previous_minutes for seg in segments
    )

    # 4. Build Google Maps URL
    google_maps_url = build_navigation_url(origin.coordinates, optimized_points)

    # 5. Create Route entity
    return Route(
        origin=origin,
        segments=segments,
        total_distance_km=round(total_distance_km, 2),
        total_duration_minutes=total_duration_minutes,
        google_maps_url=google_maps_url
    )

# === Output: Domain Entity ===
route = Route(
    origin=Station(name="新宿站", coordinates=Coordinates(...)),
    segments=[
        RouteSegment(order=1, point=..., distance_from_previous_meters=1200, ...),
        RouteSegment(order=2, point=..., distance_from_previous_meters=800, ...)
    ],
    total_distance_km=2.0,
    total_duration_minutes=25,
    google_maps_url="https://www.google.com/maps/dir/..."
)
```

---

## Error Handling Strategy

### Error Types and Handling

| Error Type | Source | Handling Strategy |
|------------|--------|------------------|
| `ValueError` | 无效输入（车站名、番剧ID） | 返回友好错误消息，提示用户重新输入 |
| `ConnectionError` | API调用失败 | 重试3次（间隔1秒），失败后提示"服务暂时不可用" |
| `TimeoutError` | API超时（>10秒） | 视为ConnectionError处理 |
| `HTTPStatusError` | API返回4xx/5xx | 记录日志，转换为ConnectionError |
| `ValidationError` | Pydantic验证失败 | 记录详细日志，返回"数据格式错误" |

### Error Flow Example

```python
# === SearchAgent Error Handling ===
async def search_nearby_bangumi(
    self,
    station_name: str,
    radius_km: float = 5.0
) -> list[Bangumi]:
    """搜索附近番剧（含错误处理）"""

    try:
        # Step 1: Geocoding
        coords = await self._geocoding.geocode_station(station_name)

    except ValueError as e:
        # 用户输入错误 → 友好提示
        logger.warning(f"Invalid station name: {station_name}")
        raise ValueError(
            f"无法识别车站 '{station_name}'，请检查拼写或尝试其他名称"
        ) from e

    except ConnectionError as e:
        # API不可用 → 提示稍后重试
        logger.error(f"Geocoding API failed: {e}")
        raise ConnectionError(
            "地图服务暂时不可用，请稍后再试"
        ) from e

    try:
        # Step 2: Search bangumi
        bangumi_list = await self._anitabi.search_bangumi_near(coords, radius_km)

        if not bangumi_list:
            # 搜索无结果 → 友好提示
            logger.info(f"No bangumi found near {station_name}")
            return []

        return sorted(bangumi_list, key=lambda b: b.distance_km or float('inf'))

    except ConnectionError as e:
        logger.error(f"Anitabi API failed: {e}")
        raise ConnectionError(
            "圣地数据服务暂时不可用，请稍后再试"
        ) from e
```

---

## Performance Considerations

### 1. Caching Strategy

```python
# === Geocoding Cache (避免重复查询) ===
class GoogleMapsClient:
    def __init__(self):
        self._geocoding_cache: dict[str, Coordinates] = {}

    async def geocode_station(self, station_name: str) -> Coordinates:
        # Check cache first
        if station_name in self._geocoding_cache:
            logger.debug(f"Cache hit for {station_name}")
            return self._geocoding_cache[station_name]

        # API call
        coords = await self._fetch_coordinates(station_name)

        # Update cache
        self._geocoding_cache[station_name] = coords
        return coords
```

### 2. Parallel API Calls

```python
# === Parallel Bangumi Points Fetching ===
import asyncio

async def get_nearby_points(
    self,
    bangumi_ids: list[str],
    center: Coordinates,
    radius_km: float
) -> list[Point]:
    """并行查询多个番剧的圣地"""

    # Limit concurrency to avoid overwhelming API
    semaphore = asyncio.Semaphore(10)

    async def fetch_with_limit(bangumi_id: str):
        async with semaphore:
            return await self._anitabi.get_bangumi_points(bangumi_id)

    # Execute in parallel
    tasks = [fetch_with_limit(bid) for bid in bangumi_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Merge results (ignore errors)
    all_points = []
    for result in results:
        if isinstance(result, list):
            all_points.extend(result)

    # Filter by radius
    return filter_points_in_radius(center, all_points, radius_km)
```

### 3. Image Optimization

```python
# === Anitabi Image URL Optimization ===
def optimize_image_url(original_url: str, target_height: int = 360) -> str:
    """
    优化Anitabi图片URL（减少加载时间和PDF大小）

    Args:
        original_url: 原始URL（如 https://image.anitabi.cn/i/p001.jpg）
        target_height: 目标高度（160/360/800）

    Returns:
        优化后的URL（如 https://image.anitabi.cn/i/p001.jpg?plan=h360）
    """
    return f"{original_url}?plan=h{target_height}"

# Usage:
# - h160: 缩略图（地图标记）
# - h360: 中等清晰度（PDF嵌入）
# - h800: 高清（交互式地图）
```

---

## Summary

### Key Data Flow Principles

1. **Single Source of Truth**: 每个实体有明确的数据来源（Anitabi或Google Maps）
2. **Immutable Value Objects**: Coordinates等值对象不可变，确保线程安全
3. **Clear Boundaries**: 领域层不依赖基础设施层（依赖倒置）
4. **Error Transparency**: 错误在边界处转换为领域异常，内层不处理HTTP细节
5. **Performance First**: 使用缓存和并行调用优化性能

### Critical Data Paths

1. **User Input → Coordinates**: 必须成功，否则无法继续
2. **Bangumi Search**: 允许返回空列表（提示用户）
3. **Points Fetching**: 部分失败可忍受（记录日志）
4. **Route Optimization**: 圣地>23个时需要降级处理
5. **Output Generation**: 失败不影响核心功能（路线数据已有）

---

**Version**: 1.0
**Last Updated**: 2025-11-20
**Maintainer**: Zhenjia Zhou
