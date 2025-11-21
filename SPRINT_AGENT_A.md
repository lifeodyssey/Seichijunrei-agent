# 🏗️ Agent A - Architecture Lead Task List

**Role**: Architecture Lead & Integration Specialist
**Focus**: Core Infrastructure, Domain Models, Agent Architecture, System Integration
**Total Story Points**: 42
**Total Tasks**: 12

---

## 📋 Task Overview

| Task ID | Title | Priority | Points | Duration | Status |
|---------|-------|----------|---------|----------|--------|
| TASK-001 | Project Structure Setup | P0 | 3 | 1h | 🔴 Not Started |
| TASK-002 | Domain Models Implementation | P0 | 5 | 1.5h | 🔴 Not Started |
| TASK-003 | Base Configuration | P0 | 3 | 0.5h | 🔴 Not Started |
| TASK-004 | SearchAgent Implementation | P1 | 5 | 2h | 🔴 Not Started |
| TASK-005 | FilterAgent Implementation | P1 | 3 | 1h | 🔴 Not Started |
| TASK-006 | PointsAgent Implementation | P1 | 3 | 1.5h | 🔴 Not Started |
| TASK-007 | RouteAgent Implementation | P1 | 5 | 2h | 🔴 Not Started |
| TASK-008 | OrchestratorAgent Core | P1 | 5 | 2h | 🔴 Not Started |
| TASK-009 | Agent Integration | P1 | 3 | 1.5h | 🔴 Not Started |
| TASK-010 | Session Management | P2 | 3 | 1h | 🔴 Not Started |
| TASK-011 | Documentation Update | P3 | 2 | 1h | 🔴 Not Started |
| TASK-012 | Final Integration & Demo | P1 | 2 | 1h | 🔴 Not Started |

---

## 📝 Detailed Task Specifications

### TASK-001: Project Structure Setup
**Priority**: P0 (Blocker)
**Duration**: 1 hour
**Dependencies**: None

**Scope**:
Create the complete project directory structure and initialize the Python project.

**Steps**:
```bash
# 1. Create directory structure (15 min)
mkdir -p domain agents services tools utils config
mkdir -p tests/unit tests/integration tests/e2e
mkdir -p templates outputs docs
mkdir -p .github/workflows

# 2. Initialize Python project (15 min)
touch __init__.py domain/__init__.py agents/__init__.py
touch services/__init__.py tools/__init__.py utils/__init__.py

# 3. Create configuration files (15 min)
touch .env.example .gitignore README.md
touch pytest.ini setup.py pyproject.toml

# 4. Setup version control (15 min)
git init
git add .
git commit -m "Initial project structure"
```

**Acceptance Criteria**:
- ✅ All directories created
- ✅ Python packages properly initialized
- ✅ Configuration files in place
- ✅ Git repository initialized

**Output**: Complete project skeleton ready for development

---

### TASK-002: Domain Models Implementation
**Priority**: P0 (Blocker)
**Duration**: 1.5 hours
**Dependencies**: TASK-001

**Scope**:
Implement all domain entities, value objects, and exceptions.

**Implementation**:
```python
# domain/entities.py

from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, List
from datetime import datetime

class Coordinates(BaseModel):
    """GPS coordinates value object"""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    class Config:
        frozen = True  # Immutable

    def distance_to(self, other: 'Coordinates') -> float:
        """Calculate haversine distance in km"""
        # Implementation here

class Station(BaseModel):
    """Railway station entity"""
    name: str
    coordinates: Coordinates
    city: Optional[str] = None
    prefecture: Optional[str] = None

class Bangumi(BaseModel):
    """Anime series entity"""
    id: str
    title: str  # Japanese
    cn_title: str  # Chinese
    cover_url: HttpUrl
    points_count: int
    distance_km: Optional[float] = None

class Point(BaseModel):
    """Pilgrimage location entity"""
    id: str
    name: str
    cn_name: str
    coordinates: Coordinates
    bangumi_id: str
    bangumi_title: str
    episode: int
    time_seconds: int
    screenshot_url: HttpUrl
    address: Optional[str] = None

class RouteSegment(BaseModel):
    """Route segment with transport info"""
    order: int
    point: Point
    transport: Optional[TransportInfo] = None
    cumulative_distance_km: float = 0

class Route(BaseModel):
    """Complete pilgrimage route"""
    origin: Station
    segments: List[RouteSegment]
    total_distance_km: float
    total_duration_minutes: int
    google_maps_url: Optional[HttpUrl] = None
```

**Testing Requirements**:
```python
# tests/unit/test_entities.py

def test_coordinates_validation():
    # Valid coordinates
    coords = Coordinates(latitude=35.6762, longitude=139.6503)
    assert coords.latitude == 35.6762

    # Invalid latitude
    with pytest.raises(ValidationError):
        Coordinates(latitude=91, longitude=0)

def test_coordinates_immutable():
    coords = Coordinates(latitude=35.6762, longitude=139.6503)
    with pytest.raises(AttributeError):
        coords.latitude = 40.0

def test_distance_calculation():
    tokyo = Coordinates(latitude=35.6762, longitude=139.6503)
    osaka = Coordinates(latitude=34.6937, longitude=135.5023)
    distance = tokyo.distance_to(osaka)
    assert 400 < distance < 500  # ~400km
```

**Acceptance Criteria**:
- ✅ All entities implemented with validation
- ✅ Value objects are immutable
- ✅ Distance calculation works correctly
- ✅ All tests passing (>90% coverage)

---

### TASK-003: Base Configuration
**Priority**: P0 (Blocker)
**Duration**: 0.5 hours
**Dependencies**: TASK-001

**Scope**:
Setup configuration management using pydantic-settings.

**Implementation**:
```python
# config/settings.py

from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """Application settings"""

    # API Keys
    google_maps_api_key: str
    gemini_api_key: Optional[str] = None

    # API URLs
    anitabi_base_url: str = "https://api.anitabi.cn"

    # Search Parameters
    default_search_radius_km: float = 5.0
    max_search_radius_km: float = 20.0
    max_waypoints: int = 23

    # Performance
    api_timeout_seconds: int = 10
    max_concurrent_requests: int = 10
    cache_ttl_seconds: int = 3600

    # Output
    output_dir: str = "outputs"
    template_dir: str = "templates"

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

# Singleton instance
settings = Settings()
```

**.env.example**:
```bash
# Required API Keys
GOOGLE_MAPS_API_KEY=your_key_here
GEMINI_API_KEY=optional_key_here

# API Configuration
ANITABI_BASE_URL=https://api.anitabi.cn

# Search Parameters
DEFAULT_SEARCH_RADIUS_KM=5.0
MAX_SEARCH_RADIUS_KM=20.0
MAX_WAYPOINTS=23

# Performance
API_TIMEOUT_SECONDS=10
MAX_CONCURRENT_REQUESTS=10
CACHE_TTL_SECONDS=3600

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json
```

**Acceptance Criteria**:
- ✅ Settings class implemented
- ✅ Environment variables loading
- ✅ .env.example created
- ✅ Configuration accessible throughout app

---

### TASK-004: SearchAgent Implementation
**Priority**: P1 (Critical)
**Duration**: 2 hours
**Dependencies**: TASK-002, TASK-003, B-013 (Anitabi Client), C-025 (Google Maps)

**Scope**:
Implement the SearchAgent that searches for nearby bangumi based on station input.

**Implementation**:
```python
# agents/search_agent.py

from typing import List
from domain.entities import Station, Bangumi, Coordinates
from services.anitabi_client import AnitabiClient
from services.gmaps_client import GoogleMapsClient
from utils.logger import get_logger

logger = get_logger(__name__)

class SearchAgent:
    """
    Agent responsible for searching nearby bangumi.
    Input: Station name
    Output: List of bangumi sorted by distance
    """

    def __init__(
        self,
        anitabi_client: AnitabiClient,
        gmaps_client: GoogleMapsClient
    ):
        self.anitabi = anitabi_client
        self.gmaps = gmaps_client

    async def run(
        self,
        station_name: str,
        radius_km: float = 5.0
    ) -> List[Bangumi]:
        """
        Main execution method.

        Steps:
        1. Geocode station name to coordinates
        2. Search for nearby bangumi
        3. Sort by distance
        4. Return results
        """
        logger.info(f"SearchAgent started for station: {station_name}")

        # Step 1: Geocoding
        try:
            coordinates = await self.gmaps.geocode_station(station_name)
            station = Station(
                name=station_name,
                coordinates=coordinates
            )
            logger.info(f"Station geocoded: {coordinates}")
        except Exception as e:
            logger.error(f"Geocoding failed: {e}")
            raise ValueError(f"无法识别车站 '{station_name}'")

        # Step 2: Search bangumi
        try:
            bangumi_list = await self.anitabi.search_bangumi_near(
                coordinates,
                radius_km
            )
            logger.info(f"Found {len(bangumi_list)} bangumi")
        except Exception as e:
            logger.error(f"Bangumi search failed: {e}")
            raise ConnectionError("圣地数据服务暂时不可用")

        # Step 3: Sort by distance
        bangumi_list.sort(key=lambda b: b.distance_km or float('inf'))

        # Step 4: Return results
        return bangumi_list
```

**Testing**:
```python
# tests/integration/test_search_agent.py

@pytest.mark.asyncio
async def test_search_agent_success():
    # Mock clients
    anitabi = Mock(spec=AnitabiClient)
    gmaps = Mock(spec=GoogleMapsClient)

    # Setup mocks
    gmaps.geocode_station.return_value = Coordinates(
        latitude=35.6762,
        longitude=139.6503
    )

    anitabi.search_bangumi_near.return_value = [
        Bangumi(id="1", title="Test", distance_km=1.5),
        Bangumi(id="2", title="Test2", distance_km=0.5)
    ]

    # Run agent
    agent = SearchAgent(anitabi, gmaps)
    results = await agent.run("東京駅")

    # Assertions
    assert len(results) == 2
    assert results[0].distance_km == 0.5  # Sorted
    assert results[1].distance_km == 1.5
```

**Acceptance Criteria**:
- ✅ Geocoding integration working
- ✅ Bangumi search integration working
- ✅ Results sorted by distance
- ✅ Error handling robust
- ✅ Logging implemented
- ✅ Tests passing

---

### TASK-005: FilterAgent Implementation
**Priority**: P1 (Critical)
**Duration**: 1 hour
**Dependencies**: TASK-004

**Scope**:
Implement user preference filtering for bangumi selection.

**Implementation**:
```python
# agents/filter_agent.py

from typing import List
from domain.entities import Bangumi
from utils.logger import get_logger

logger = get_logger(__name__)

class FilterAgent:
    """
    Agent responsible for filtering bangumi based on user preferences.
    Shows bangumi list and collects user selection.
    """

    async def run(
        self,
        bangumi_list: List[Bangumi]
    ) -> List[str]:
        """
        Display bangumi and get user selection.

        Returns:
            List of selected bangumi IDs
        """
        if not bangumi_list:
            logger.warning("No bangumi to filter")
            return []

        # Display options
        print("\n📺 找到以下番剧的圣地，请选择您看过的作品：\n")

        for i, bangumi in enumerate(bangumi_list, 1):
            distance_text = f"({bangumi.distance_km:.1f}km)" if bangumi.distance_km else ""
            print(f"{i}. {bangumi.cn_title} - {bangumi.points_count}个圣地 {distance_text}")

        print("\n请输入番号（多个用逗号分隔，0表示全选）：")

        # Get user input
        selection = input().strip()

        # Parse selection
        if selection == "0":
            selected_ids = [b.id for b in bangumi_list]
            logger.info(f"User selected all {len(selected_ids)} bangumi")
        else:
            try:
                indices = [int(x.strip()) - 1 for x in selection.split(",")]
                selected_ids = [
                    bangumi_list[i].id
                    for i in indices
                    if 0 <= i < len(bangumi_list)
                ]
                logger.info(f"User selected {len(selected_ids)} bangumi")
            except (ValueError, IndexError):
                logger.error("Invalid selection")
                raise ValueError("选择无效，请重新输入")

        if not selected_ids:
            raise ValueError("请至少选择一部番剧")

        return selected_ids
```

**Acceptance Criteria**:
- ✅ Display bangumi list clearly
- ✅ Handle user input correctly
- ✅ Support multiple selection
- ✅ Validate input
- ✅ Return selected IDs

---

### TASK-006: PointsAgent Implementation
**Priority**: P1 (Critical)
**Duration**: 1.5 hours
**Dependencies**: TASK-005, B-013 (Anitabi Client)

**Implementation Details**: [Continues with similar detail for remaining tasks...]

---

### TASK-007 through TASK-012
[Similar detailed specifications for each task]

---

## 📊 Daily Execution Plan

### Day 1 Morning (08:00-12:00)
```
08:00-09:00: TASK-001 (Project Structure)
09:00-10:30: TASK-002 (Domain Models)
10:30-11:00: TASK-003 (Configuration)
11:00-12:00: Code review & sync preparation
```

### Day 1 Afternoon (13:00-17:00)
```
13:00-15:00: TASK-004 (SearchAgent)
15:00-16:00: TASK-005 (FilterAgent)
16:00-17:00: Integration testing & sync
```

### Day 2 Morning (08:00-12:00)
```
08:00-09:30: TASK-006 (PointsAgent)
09:30-11:30: TASK-007 (RouteAgent)
11:30-12:00: Testing & sync preparation
```

### Day 2 Afternoon (13:00-17:00)
```
13:00-15:00: TASK-008 (OrchestratorAgent)
15:00-16:30: TASK-009 (Integration)
16:30-17:00: End-to-end testing
```

### Day 3 Morning (08:00-12:00)
```
08:00-09:00: TASK-010 (Session Management)
09:00-10:00: TASK-011 (Documentation)
10:00-12:00: Bug fixes & optimization
```

### Day 3 Afternoon (13:00-15:00)
```
13:00-14:00: TASK-012 (Final Integration)
14:00-15:00: Demo preparation & recording
```

---

## 🔄 Handoff Points

### To Agent B
- After TASK-002: Domain models ready for API client implementation
- After TASK-004: SearchAgent ready for API integration testing
- After TASK-007: Route data ready for map generation

### To Agent C
- After TASK-002: Entities ready for tool implementation
- After TASK-008: Full flow ready for E2E testing
- After TASK-011: Documentation ready for final review

### From Agent B
- Before TASK-004: Need Anitabi client completed
- Before TASK-006: Need points fetching implemented
- Before TASK-008: Need map generator ready

### From Agent C
- Before TASK-004: Need Google Maps client
- Before TASK-007: Need routing service
- Before TASK-012: Need PDF generator ready

---

## ✅ Personal Checklist

### Day 1
- [ ] Environment setup complete
- [ ] Domain models tested
- [ ] SearchAgent working
- [ ] FilterAgent working
- [ ] Integration with B & C confirmed

### Day 2
- [ ] All agents implemented
- [ ] Orchestrator functioning
- [ ] Integration complete
- [ ] E2E flow working

### Day 3
- [ ] Session management added
- [ ] Documentation updated
- [ ] Demo recorded
- [ ] All tests passing
- [ ] Ready for delivery

---

## 📝 Notes & Reminders

1. **Critical Path**: TASK-001 → TASK-002 → TASK-004 must be completed ASAP
2. **API Keys**: Ensure Google Maps API key is configured before TASK-004
3. **Testing**: Write tests alongside implementation, not after
4. **Documentation**: Update docstrings as you code
5. **Communication**: Update status in main SPRINT_PLAN.md after each task
6. **Quality**: Run linters and type checkers before marking complete

---

**Agent**: A (Architecture Lead)
**Last Updated**: 2025-11-20 09:00
**Next Checkpoint**: 2025-11-20 12:00 (Sync Point 1)