# Tasks: Seichijunrei Bot (TDD Implementation)

**Input**: User Stories from `Claude-Context/user-stories.md`
**Prerequisites**: 遵循TDD、SOLID、Clean Code、KISS、YAGNI原则
**Deadline**: 2025-12-01

**Tests**: ✅ 强制要求 - 每个任务先写测试，确保测试失败后再实现

**Organization**: 任务按User Story分组，确保每个Story可独立实现和测试

---

## 任务格式说明

每个任务包含：
- **[ID] [P?] [Story] 标题**: 简要说明（<2小时）
- **提示词**: 可直接复制到Claude Code的结构化提示
- **输入/输出**: 明确的接口定义
- **验收标准**: 如何验证任务完成

**标记说明**:
- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属User Story（US1-US6）
- **ultrathink**: 需要深度思考的复杂任务

---

## Phase 1: Setup（项目初始化）

### T001 创建项目结构和依赖配置

**时间**: 30分钟
**依赖**: 无
**文件**: `pyproject.toml`, `requirements.txt`, `.env.template`

**提示词**:
```
你是一位资深Python架构师，精通项目结构设计和依赖管理。

任务：创建Seichijunrei Bot项目的基础结构和依赖配置。

约束条件：
- 使用Python 3.10+
- 采用Clean Architecture分层结构
- 依赖管理使用uv（pip的替代品）
- 必须包含开发依赖（pytest, black, ruff等）

项目结构：
```
seichijunrei-bot/
├── src/
│   ├── domain/          # 领域层：实体和接口
│   ├── application/     # 应用层：Agent和Use Cases
│   ├── infrastructure/  # 基础设施层：API客户端、数据库
│   └── presentation/    # 表现层：输出生成（地图、PDF）
├── tests/
│   ├── unit/           # 单元测试
│   ├── integration/    # 集成测试
│   └── fixtures/       # 测试数据
├── templates/          # HTML模板
├── outputs/            # 输出文件
└── Claude-Context/     # 项目文档
```

核心依赖：
- google-adk-python>=1.0.0  # ADK SDK
- httpx>=0.27.0            # HTTP客户端
- pydantic>=2.0.0          # 数据验证
- pytest>=8.0.0            # 测试框架
- pytest-asyncio>=0.23.0   # 异步测试
- leafmap>=0.32.0          # 地图生成
- playwright>=1.48.0       # PDF生成
- jinja2>=3.1.0            # 模板引擎

输出要求：
1. pyproject.toml（包含所有依赖）
2. .env.template（API密钥模板）
3. .gitignore（排除敏感文件）
4. 项目目录结构（使用mkdir命令创建）

风险提示：
- 不要包含实际的API密钥
- 确保.env文件在.gitignore中
- 版本号使用稳定版本，避免使用latest
```

**验收标准**:
- [ ] 项目结构符合Clean Architecture
- [ ] 所有必需依赖已声明
- [ ] .env.template包含所有必需的API密钥占位符

---

### T002 [P] 配置测试框架和代码质量工具

**时间**: 30分钟
**依赖**: T001
**文件**: `pytest.ini`, `.ruff.toml`, `tests/conftest.py`

**提示词**:
```
你是一位TDD专家和代码质量倡导者。

任务：配置pytest测试框架和代码质量工具（Black, Ruff）。

pytest配置要求：
- 测试文件模式：test_*.py
- 异步支持：pytest-asyncio
- 覆盖率报告：pytest-cov
- 详细输出：-v -s

代码质量工具：
- Black：格式化（line-length=100）
- Ruff：Linting（遵循Google Python Style Guide）

tests/conftest.py需要包含：
- 异步fixture示例
- Mock API客户端的fixture
- 测试数据加载fixture

命名规范：
- 测试函数：test_should_<行为>_when_<条件>()
- 测试类：Test<功能名称>
- 测试文件：test_<模块名>.py

输出要求：
1. pytest.ini（配置文件）
2. pyproject.toml中添加Black和Ruff配置
3. tests/conftest.py（共享fixtures）

范例（pytest.ini）：
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
asyncio_mode = auto
addopts = -v -s --cov=src --cov-report=html
```

不要做：
- 不要创建实际的测试文件（这是后续任务）
- 不要包含过于严格的Linting规则（阻碍开发）
```

**验收标准**:
- [ ] 运行`pytest --co` 能正常发现测试
- [ ] 运行`black .` 能格式化代码
- [ ] 运行`ruff check .` 能进行代码检查

---

## Phase 2: Foundational（领域层和基础设施）

**⚠️ CRITICAL**: 此阶段必须完成后才能开始User Story实现

### T003 [P] 定义领域实体（Domain Entities）

**时间**: 1小时
**依赖**: T001, T002
**文件**: `src/domain/entities.py`

**提示词**:
```
你是一位领域驱动设计(DDD)专家，精通Python的Pydantic库。

任务：定义Seichijunrei Bot的核心领域实体。

原则：
- 使用Pydantic BaseModel确保类型安全
- 实体应该是不可变的（frozen=True）
- 实体不包含业务逻辑，仅数据结构
- 使用明确的类型注解
- 遵循SOLID原则中的单一职责原则

实体定义：

1. **Coordinates** (值对象)
   - latitude: float（纬度）
   - longitude: float（经度）
   - 验证：-90 <= latitude <= 90, -180 <= longitude <= 180

2. **Station** (实体)
   - name: str（车站名称）
   - coordinates: Coordinates
   - city: str | None（所在城市，可选）

3. **Bangumi** (实体)
   - id: str
   - title: str（原始名称）
   - cn_title: str（中文名称）
   - cover_url: HttpUrl（封面URL）
   - points_count: int（圣地数量）
   - distance_km: float | None（距离车站，可选）

4. **Point** (实体)
   - id: str
   - name: str
   - cn_name: str
   - coordinates: Coordinates
   - bangumi_id: str
   - bangumi_title: str
   - episode: int
   - time_seconds: int（场景时间）
   - screenshot_url: HttpUrl
   - address: str | None（地址，可选）

5. **RouteSegment** (值对象)
   - order: int（第几站）
   - point: Point
   - distance_from_previous_meters: int
   - duration_from_previous_minutes: int

6. **Route** (聚合根)
   - origin: Station
   - segments: list[RouteSegment]
   - total_distance_km: float
   - total_duration_minutes: int
   - google_maps_url: HttpUrl

命名规范：
- 类名：PascalCase
- 属性名：snake_case
- 类型注解：使用Python 3.10+ 的 | 语法

范例代码：
```python
from pydantic import BaseModel, HttpUrl, field_validator

class Coordinates(BaseModel, frozen=True):
    \"\"\"GPS坐标值对象\"\"\"
    latitude: float
    longitude: float

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
```

输出要求：
1. src/domain/entities.py（完整的实体定义）
2. 每个实体包含详细的docstring
3. 所有字段包含类型注解和说明

不要做：
- 不要在实体中包含业务逻辑方法
- 不要添加数据库相关代码（ORM）
- 不要添加序列化逻辑（Pydantic自带）
```

**验收标准**:
- [ ] 所有实体都继承自Pydantic BaseModel
- [ ] 关键字段有验证器（如坐标范围、URL格式）
- [ ] 可以创建实体实例：`station = Station(name="新宿站", coordinates=...)`

---

### T004 [US1] 编写Station和Bangumi实体的单元测试

**时间**: 45分钟
**依赖**: T003
**文件**: `tests/unit/domain/test_entities.py`

**TDD阶段**: 🔴 Red（测试必须失败）

**提示词**:
```
你是一位TDD实践者，严格遵循"测试先行"原则。

任务：为Station和Bangumi实体编写单元测试。

TDD流程：
1. 先写测试（本任务）
2. 运行测试，确保失败（RED）
3. 编写实现（下一任务）
4. 运行测试，确保通过（GREEN）
5. 重构（如需要）

测试命名规范：
- test_should_<期望行为>_when_<条件>()

测试覆盖：

**Coordinates测试**:
1. test_should_create_valid_coordinates_when_values_in_range()
2. test_should_raise_error_when_latitude_out_of_range()
3. test_should_raise_error_when_longitude_out_of_range()
4. test_should_be_immutable_when_created()

**Station测试**:
1. test_should_create_station_with_required_fields()
2. test_should_create_station_with_optional_city()
3. test_should_validate_coordinates_type()

**Bangumi测试**:
1. test_should_create_bangumi_with_all_fields()
2. test_should_validate_cover_url_format()
3. test_should_accept_none_for_distance()
4. test_should_set_points_count_to_positive_integer()

范例代码：
```python
import pytest
from pydantic import ValidationError
from src.domain.entities import Coordinates, Station, Bangumi

class TestCoordinates:
    def test_should_create_valid_coordinates_when_values_in_range(self):
        # Arrange & Act
        coords = Coordinates(latitude=35.6896, longitude=139.7006)

        # Assert
        assert coords.latitude == 35.6896
        assert coords.longitude == 139.7006

    def test_should_raise_error_when_latitude_out_of_range(self):
        # Act & Assert
        with pytest.raises(ValidationError) as exc_info:
            Coordinates(latitude=100.0, longitude=0.0)

        assert 'latitude' in str(exc_info.value).lower()

    def test_should_be_immutable_when_created(self):
        # Arrange
        coords = Coordinates(latitude=35.0, longitude=139.0)

        # Act & Assert
        with pytest.raises(ValidationError):
            coords.latitude = 40.0  # 应该失败，因为frozen=True

class TestStation:
    def test_should_create_station_with_required_fields(self):
        # Arrange
        coords = Coordinates(latitude=35.6896, longitude=139.7006)

        # Act
        station = Station(name="新宿站", coordinates=coords)

        # Assert
        assert station.name == "新宿站"
        assert station.coordinates == coords
        assert station.city is None
```

输出要求：
1. tests/unit/domain/test_entities.py
2. 至少10个测试用例
3. 覆盖正常情况和异常情况

ultrathink提示：
- 思考边界条件：空字符串、None、负数、极大值
- 思考不变性：实体创建后是否可修改？
- 思考验证逻辑：哪些字段必须验证？如何验证？

验收：运行pytest，所有测试应该失败（因为还没实现或实现不完整）
```

**验收标准**:
- [ ] 运行`pytest tests/unit/domain/test_entities.py` 测试失败
- [ ] 至少10个测试用例
- [ ] 测试覆盖正常和异常情况

---

### T005 [US1] 实现API客户端接口定义

**时间**: 30分钟
**依赖**: T003
**文件**: `src/domain/interfaces.py`

**提示词**:
```
你是一位接口设计专家，精通依赖倒置原则（SOLID的D原则）。

任务：定义API客户端的接口（Interface/Protocol），而非具体实现。

原则：
- 依赖倒置：高层模块（Agent）不应依赖低层模块（API客户端），都应依赖抽象
- 接口隔离：每个接口只包含必要的方法
- 使用Python的Protocol（结构化子类型）

接口定义：

1. **IGeocodingService** (地理编码服务)
   - async def geocode_station(station_name: str) -> Coordinates
   - 作用：车站名→GPS坐标

2. **IAnitabiClient** (Anitabi API客户端)
   - async def search_bangumi_near(coords: Coordinates, radius_km: float) -> list[Bangumi]
   - async def get_bangumi_points(bangumi_id: str) -> list[Point]
   - 作用：查询番剧和圣地

3. **IRoutingService** (路线规划服务)
   - async def optimize_route(origin: Coordinates, points: list[Point]) -> Route
   - 作用：生成最优路线

4. **IMapGenerator** (地图生成器)
   - async def generate_map(route: Route, output_path: str) -> str
   - 作用：生成HTML地图

5. **IPDFGenerator** (PDF生成器)
   - async def generate_pdf(route: Route, map_path: str, output_path: str) -> str
   - 作用：生成PDF手册

范例代码：
```python
from typing import Protocol
from src.domain.entities import Coordinates, Bangumi, Point, Route

class IGeocodingService(Protocol):
    \"\"\"地理编码服务接口\"\"\"

    async def geocode_station(self, station_name: str) -> Coordinates:
        \"\"\"
        将车站名称转换为GPS坐标

        Args:
            station_name: 车站名称（如"新宿站"）

        Returns:
            GPS坐标

        Raises:
            ValueError: 车站名称无效
            ConnectionError: API调用失败
        \"\"\"
        ...

class IAnitabiClient(Protocol):
    \"\"\"Anitabi API客户端接口\"\"\"

    async def search_bangumi_near(
        self,
        coords: Coordinates,
        radius_km: float = 5.0
    ) -> list[Bangumi]:
        \"\"\"
        搜索坐标附近的番剧

        Args:
            coords: 中心坐标
            radius_km: 搜索半径（公里）

        Returns:
            番剧列表，按距离排序
        \"\"\"
        ...
```

输出要求：
1. src/domain/interfaces.py（所有接口定义）
2. 每个方法包含详细的docstring
3. 明确标注参数类型和返回类型
4. 列出可能抛出的异常

不要做：
- 不要实现具体逻辑（仅定义接口）
- 不要添加私有方法
- 不要依赖具体的第三方库（如requests）
```

**验收标准**:
- [ ] 所有接口使用Protocol定义
- [ ] 方法签名清晰，包含类型注解
- [ ] 每个方法有完整的docstring

---

### T006 [US1] 实现Anitabi API客户端（基础版）

**时间**: 1.5小时
**依赖**: T005
**文件**: `src/infrastructure/anitabi_client.py`

**提示词**:
```
你是一位API集成专家，精通HTTP客户端和错误处理。

任务：实现AnitabiClient，遵循IAnitabiClient接口。

技术栈：
- HTTP客户端：httpx（异步）
- 错误处理：重试机制（最多3次）
- 超时：10秒

Anitabi API文档：
- Base URL: https://api.anitabi.cn/
- 端点1：GET /bangumi/{id}/lite（番剧基础信息，返回最多10个圣地）
- 端点2：GET /bangumi/{id}/points/detail?haveImage=true（完整圣地列表）
- 图片URL：追加?plan=h360获取中等清晰度

实现要求：

1. **search_bangumi_near()**:
   - 说明：Anitabi API不支持按坐标搜索，需要遍历已知番剧列表
   - 实现：读取预设的番剧ID列表（前100个热门番剧）
   - 对每个番剧调用/bangumi/{id}/lite
   - 计算每个圣地与中心坐标的距离
   - 如果有圣地在半径内，添加到结果
   - 按距离排序

2. **get_bangumi_points()**:
   - 调用/bangumi/{id}/points/detail?haveImage=true
   - 解析返回的JSON
   - 转换为Point实体列表

错误处理：
- 网络错误：重试3次，间隔1秒
- 超时：10秒
- API返回错误状态码：记录日志，抛出异常

范例代码：
```python
import httpx
import asyncio
from typing import Optional
from src.domain.entities import Coordinates, Bangumi, Point
from src.domain.interfaces import IAnitabiClient

class AnitabiClient:
    \"\"\"Anitabi API客户端实现\"\"\"

    BASE_URL = "https://api.anitabi.cn"
    TIMEOUT = 10.0
    MAX_RETRIES = 3

    def __init__(self, http_client: Optional[httpx.AsyncClient] = None):
        self._client = http_client or httpx.AsyncClient(timeout=self.TIMEOUT)

    async def search_bangumi_near(
        self,
        coords: Coordinates,
        radius_km: float = 5.0
    ) -> list[Bangumi]:
        \"\"\"搜索附近的番剧\"\"\"
        # TODO: 加载预设的番剧ID列表
        # TODO: 并行查询每个番剧的基本信息
        # TODO: 筛选有圣地在半径内的番剧
        # TODO: 计算距离并排序
        pass

    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        \"\"\"获取番剧的所有圣地\"\"\"
        url = f"{self.BASE_URL}/bangumi/{bangumi_id}/points/detail"
        params = {"haveImage": "true"}

        for attempt in range(self.MAX_RETRIES):
            try:
                response = await self._client.get(url, params=params)
                response.raise_for_status()

                data = response.json()
                return self._parse_points(data, bangumi_id)

            except httpx.TimeoutException:
                if attempt == self.MAX_RETRIES - 1:
                    raise ConnectionError(f"Timeout after {self.MAX_RETRIES} retries")
                await asyncio.sleep(1)

            except httpx.HTTPStatusError as e:
                raise ValueError(f"API error: {e.response.status_code}")

    def _parse_points(self, data: dict, bangumi_id: str) -> list[Point]:
        \"\"\"解析API返回的圣地数据\"\"\"
        # TODO: 实现数据解析逻辑
        pass
```

输出要求：
1. src/infrastructure/anitabi_client.py
2. 包含完整的错误处理和重试逻辑
3. 使用async/await异步编程
4. 添加类型注解

ultrathink：
- 如何高效并行查询100个番剧？（使用asyncio.gather）
- 如何计算两个GPS坐标之间的距离？（Haversine公式）
- 如何处理API返回的数据格式不一致？

不要做：
- 不要硬编码API密钥（Anitabi无需密钥）
- 不要在这个任务中实现地理距离计算（下一任务）
```

**验收标准**:
- [ ] 可以调用`await client.get_bangumi_points("115908")`
- [ ] 网络错误时会重试3次
- [ ] 超时会抛出ConnectionError

---

### T007 [P] [US1] 实现地理工具函数

**时间**: 45分钟
**依赖**: T003
**文件**: `src/infrastructure/geo_utils.py`

**提示词**:
```
你是一位地理计算专家。

任务：实现地理相关的工具函数。

功能需求：

1. **calculate_distance()**:
   - 使用Haversine公式计算两个GPS坐标之间的距离
   - 输入：coords1, coords2 (Coordinates类型)
   - 输出：距离（公里）

2. **filter_points_in_radius()**:
   - 筛选在指定半径内的圣地
   - 输入：center (Coordinates), points (list[Point]), radius_km (float)
   - 输出：list[Point]（在半径内的圣地）

3. **sort_by_distance()**:
   - 按距离排序圣地或番剧
   - 输入：center (Coordinates), items (list[Point | Bangumi])
   - 输出：排序后的列表

Haversine公式：
```
a = sin²(Δlat/2) + cos(lat1) * cos(lat2) * sin²(Δlon/2)
c = 2 * atan2(√a, √(1−a))
distance = R * c  (R = 6371 km)
```

范例代码：
```python
import math
from src.domain.entities import Coordinates, Point, Bangumi

def calculate_distance(coords1: Coordinates, coords2: Coordinates) -> float:
    \"\"\"
    计算两个GPS坐标之间的距离（Haversine公式）

    Args:
        coords1: 起点坐标
        coords2: 终点坐标

    Returns:
        距离（公里），保留2位小数
    \"\"\"
    R = 6371  # 地球半径（公里）

    lat1, lon1 = math.radians(coords1.latitude), math.radians(coords1.longitude)
    lat2, lon2 = math.radians(coords2.latitude), math.radians(coords2.longitude)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    distance = R * c
    return round(distance, 2)
```

输出要求：
1. src/infrastructure/geo_utils.py
2. 每个函数包含详细docstring
3. 添加类型注解
4. 使用标准库math模块（无需第三方库）

不要做：
- 不要使用第三方地理库（如geopy）
- 不要添加复杂的地理功能（仅需基础距离计算）
```

**验收标准**:
- [ ] `calculate_distance(东京coords, 大阪coords)` 返回约400km
- [ ] `filter_points_in_radius()` 正确筛选半径内的点
- [ ] 所有函数有完整的类型注解

---

### T008 [US1] 编写Anitabi客户端的集成测试

**时间**: 1小时
**依赖**: T006, T007
**文件**: `tests/integration/test_anitabi_client.py`

**TDD阶段**: 🟢 Green（验证实现）

**提示词**:
```
你是一位集成测试专家。

任务：编写AnitabiClient的集成测试（真实API调用）。

测试策略：
- 使用真实的Anitabi API
- 使用已知的番剧ID（如115908《你的名字》）
- 设置合理的超时时间
- 使用@pytest.mark.integration标记

测试用例：

1. test_should_fetch_bangumi_points_when_valid_id():
   - 调用get_bangumi_points("115908")
   - 验证返回的圣地列表不为空
   - 验证每个Point包含必需字段

2. test_should_raise_error_when_invalid_bangumi_id():
   - 调用get_bangumi_points("invalid_id")
   - 验证抛出ValueError

3. test_should_search_bangumi_near_shinjuku():
   - 新宿站坐标：(35.6896, 139.7006)
   - 调用search_bangumi_near()
   - 验证返回的番剧列表按距离排序

4. test_should_filter_bangumi_by_radius():
   - 使用较小的半径（1km）
   - 验证只返回非常近的番剧

5. test_should_handle_network_timeout():
   - Mock httpx.AsyncClient使其超时
   - 验证重试3次后抛出ConnectionError

范例代码：
```python
import pytest
from src.infrastructure.anitabi_client import AnitabiClient
from src.domain.entities import Coordinates

class TestAnitabiClientIntegration:
    @pytest.fixture
    async def client(self):
        client = AnitabiClient()
        yield client
        await client._client.aclose()  # 清理

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_should_fetch_bangumi_points_when_valid_id(self, client):
        # Arrange
        bangumi_id = "115908"  # 你的名字

        # Act
        points = await client.get_bangumi_points(bangumi_id)

        # Assert
        assert len(points) > 0
        assert all(p.bangumi_id == bangumi_id for p in points)
        assert all(p.coordinates.latitude != 0 for p in points)

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_should_search_bangumi_near_shinjuku(self, client):
        # Arrange
        shinjuku = Coordinates(latitude=35.6896, longitude=139.7006)

        # Act
        bangumi_list = await client.search_bangumi_near(shinjuku, radius_km=5.0)

        # Assert
        assert len(bangumi_list) > 0
        # 验证按距离排序
        distances = [b.distance_km for b in bangumi_list if b.distance_km]
        assert distances == sorted(distances)
```

输出要求：
1. tests/integration/test_anitabi_client.py
2. 至少5个集成测试
3. 使用真实API调用（不mock）
4. 所有测试标记@pytest.mark.integration

注意事项：
- 集成测试可能较慢（真实网络请求）
- 使用pytest -m "not integration"可跳过集成测试
- 如果API不可用，测试应该跳过（@pytest.mark.skipif）

ultrathink：
- 如何处理API限流？
- 如何处理网络不稳定？
- 如何避免测试污染生产数据？（Anitabi是只读API，无此问题）
```

**验收标准**:
- [ ] 运行`pytest -m integration` 所有测试通过
- [ ] 测试覆盖正常和异常情况
- [ ] 测试可重复运行（幂等性）

---

## Phase 3: User Story 1 - 车站搜索（P1优先级）

**Checkpoint**: 完成后可独立验证US1功能

### T009 [US1] 编写SearchAgent的单元测试（TDD）

**时间**: 1小时
**依赖**: T005, T008
**文件**: `tests/unit/application/test_search_agent.py`

**TDD阶段**: 🔴 Red（测试先行）

**提示词**:
```
你是一位TDD专家和Agent开发者。

任务：为SearchAgent编写单元测试（在实现之前）。

SearchAgent职责：
- 输入：车站名称（str）
- 输出：番剧列表（list[Bangumi]）
- 流程：
  1. 调用IGeocodingService将车站名→坐标
  2. 调用IAnitabiClient搜索附近番剧
  3. 按距离排序返回

测试策略：
- Mock所有外部依赖（IGeocodingService, IAnitabiClient）
- 专注于Agent的业务逻辑
- 不测试API客户端（已在集成测试中测试）

测试用例：

1. test_should_return_bangumi_list_when_valid_station():
   - Mock geocoding返回新宿坐标
   - Mock anitabi返回3个番剧
   - 验证Agent返回3个番剧，按距离排序

2. test_should_raise_error_when_invalid_station():
   - Mock geocoding抛出ValueError
   - 验证Agent也抛出ValueError并包含友好提示

3. test_should_return_empty_list_when_no_bangumi_found():
   - Mock anitabi返回空列表
   - 验证Agent返回空列表

4. test_should_use_default_radius_when_not_specified():
   - 验证默认半径为5.0km

5. test_should_log_search_parameters():
   - 验证Agent记录日志（车站名、坐标、半径）

范例代码：
```python
import pytest
from unittest.mock import AsyncMock, Mock
from src.application.search_agent import SearchAgent
from src.domain.entities import Coordinates, Bangumi

class TestSearchAgent:
    @pytest.fixture
    def mock_geocoding_service(self):
        service = Mock()
        service.geocode_station = AsyncMock()
        return service

    @pytest.fixture
    def mock_anitabi_client(self):
        client = Mock()
        client.search_bangumi_near = AsyncMock()
        return client

    @pytest.fixture
    def agent(self, mock_geocoding_service, mock_anitabi_client):
        return SearchAgent(
            geocoding_service=mock_geocoding_service,
            anitabi_client=mock_anitabi_client
        )

    @pytest.mark.asyncio
    async def test_should_return_bangumi_list_when_valid_station(
        self, agent, mock_geocoding_service, mock_anitabi_client
    ):
        # Arrange
        station_name = "新宿站"
        expected_coords = Coordinates(latitude=35.6896, longitude=139.7006)
        expected_bangumi = [
            Bangumi(id="1", title="Test1", cn_title="测试1",
                   cover_url="http://test.com/1.jpg", points_count=10, distance_km=1.5),
            Bangumi(id="2", title="Test2", cn_title="测试2",
                   cover_url="http://test.com/2.jpg", points_count=5, distance_km=0.8)
        ]

        mock_geocoding_service.geocode_station.return_value = expected_coords
        mock_anitabi_client.search_bangumi_near.return_value = expected_bangumi

        # Act
        result = await agent.search_nearby_bangumi(station_name)

        # Assert
        assert len(result) == 2
        assert result[0].distance_km < result[1].distance_km  # 按距离排序
        mock_geocoding_service.geocode_station.assert_called_once_with(station_name)
        mock_anitabi_client.search_bangumi_near.assert_called_once()
```

输出要求：
1. tests/unit/application/test_search_agent.py
2. 至少5个测试用例
3. 使用Mock和AsyncMock
4. 清晰的Arrange-Act-Assert结构

验收：运行pytest，测试应该失败（因为SearchAgent还未实现）
```

**验收标准**:
- [ ] 运行`pytest tests/unit/application/test_search_agent.py` 测试失败
- [ ] 所有测试使用Mock，不依赖真实API
- [ ] 测试覆盖正常和异常情况

---

### T010 [US1] 实现SearchAgent

**时间**: 1小时
**依赖**: T009
**文件**: `src/application/search_agent.py`

**TDD阶段**: 🟢 Green（让测试通过）

**提示词**:
```
你是一位Agent开发专家，精通SOLID原则。

任务：实现SearchAgent，让T009的测试通过。

设计原则：
- 依赖注入：通过构造函数注入依赖（IGeocodingService, IAnitabiClient）
- 单一职责：仅负责搜索逻辑，不包含API调用细节
- 可测试性：所有依赖可Mock

实现要求：

1. **构造函数**:
   - 接受IGeocodingService和IAnitabiClient
   - 接受logger（可选）

2. **search_nearby_bangumi()**:
   ```python
   async def search_nearby_bangumi(
       self,
       station_name: str,
       radius_km: float = 5.0
   ) -> list[Bangumi]:
   ```
   - 步骤1：调用geocoding_service.geocode_station()
   - 步骤2：调用anitabi_client.search_bangumi_near()
   - 步骤3：按distance_km排序
   - 步骤4：记录日志
   - 错误处理：捕获并转换为友好的错误消息

3. **日志记录**:
   - 搜索开始：记录车站名和半径
   - 搜索完成：记录找到的番剧数量
   - 错误：记录详细的错误信息

范例代码：
```python
import logging
from src.domain.entities import Bangumi
from src.domain.interfaces import IGeocodingService, IAnitabiClient

class SearchAgent:
    \"\"\"搜索附近番剧的Agent\"\"\"

    def __init__(
        self,
        geocoding_service: IGeocodingService,
        anitabi_client: IAnitabiClient,
        logger: logging.Logger | None = None
    ):
        self._geocoding = geocoding_service
        self._anitabi = anitabi_client
        self._logger = logger or logging.getLogger(__name__)

    async def search_nearby_bangumi(
        self,
        station_name: str,
        radius_km: float = 5.0
    ) -> list[Bangumi]:
        \"\"\"
        搜索车站附近的番剧

        Args:
            station_name: 车站名称（如"新宿站"）
            radius_km: 搜索半径（公里），默认5.0

        Returns:
            番剧列表，按距离排序

        Raises:
            ValueError: 车站名称无效
            ConnectionError: API调用失败
        \"\"\"
        self._logger.info(f"搜索 {station_name} 附近 {radius_km}km 的番剧")

        try:
            # 步骤1：地理编码
            coords = await self._geocoding.geocode_station(station_name)
            self._logger.debug(f"车站坐标: {coords}")

            # 步骤2：搜索番剧
            bangumi_list = await self._anitabi.search_bangumi_near(coords, radius_km)

            # 步骤3：排序
            sorted_list = sorted(
                bangumi_list,
                key=lambda b: b.distance_km if b.distance_km else float('inf')
            )

            self._logger.info(f"找到 {len(sorted_list)} 部番剧")
            return sorted_list

        except ValueError as e:
            self._logger.error(f"车站名称无效: {station_name}")
            raise ValueError(f"无法识别车站 '{station_name}'，请重新输入") from e

        except ConnectionError as e:
            self._logger.error(f"API调用失败: {e}")
            raise ConnectionError("服务暂时不可用，请稍后再试") from e
```

输出要求：
1. src/application/search_agent.py
2. 完整的类型注解
3. 详细的docstring
4. 完善的错误处理和日志

ultrathink：
- 如何确保Agent是无状态的？（不保存搜索结果）
- 如何处理并发搜索？（Agent应该是线程安全的）
- 如何优化性能？（缓存地理编码结果？）

验收：运行pytest，T009的测试应该全部通过
```

**验收标准**:
- [ ] 运行`pytest tests/unit/application/test_search_agent.py` 所有测试通过
- [ ] 代码符合SOLID原则
- [ ] 有完整的错误处理和日志

---

**Checkpoint**: 此时可以独立测试US1功能
```python
# 手动测试示例
agent = SearchAgent(geocoding, anitabi)
bangumi_list = await agent.search_nearby_bangumi("新宿站")
print(f"找到 {len(bangumi_list)} 部番剧")
```

---

## Phase 4: User Story 2 - 用户选择（P2优先级）

### T011 [US2] 实现FilterAgent（简化版）

**时间**: 45分钟
**依赖**: T010
**文件**: `src/application/filter_agent.py`

**提示词**:
```
你是一位交互设计专家。

任务：实现FilterAgent，负责展示番剧列表并收集用户选择。

设计考虑：
- 在终端环境下，使用简单的文本输入
- 未来可扩展为Web UI或CLI菜单

实现要求：

1. **filter_bangumi()**:
   ```python
   async def filter_bangumi(
       self,
       bangumi_list: list[Bangumi]
   ) -> list[str]:
   ```
   - 展示番剧列表（编号、名称、圣地数量、距离）
   - 提示用户输入已观看的番剧编号（逗号分隔）
   - 解析输入，返回选中的番剧ID列表
   - 验证：至少选择1个，最多选择列表中的所有

2. **输入格式**:
   - "1,3,5" → 选择第1、3、5个番剧
   - "all" → 选择全部
   - 无效输入 → 提示重新输入

范例代码：
```python
from src.domain.entities import Bangumi

class FilterAgent:
    \"\"\"用户偏好过滤Agent\"\"\"

    async def filter_bangumi(
        self,
        bangumi_list: list[Bangumi]
    ) -> list[str]:
        \"\"\"
        展示番剧列表并收集用户选择

        Args:
            bangumi_list: 搜索到的番剧列表

        Returns:
            选中的番剧ID列表
        \"\"\"
        if not bangumi_list:
            raise ValueError("番剧列表为空")

        # 展示列表
        print("\\n找到以下番剧：")
        for i, bangumi in enumerate(bangumi_list, 1):
            print(f"{i}. {bangumi.cn_title} ({bangumi.title})")
            print(f"   圣地数量: {bangumi.points_count}, 距离: {bangumi.distance_km}km")

        # 收集输入
        while True:
            user_input = input("\\n请输入已观看的番剧编号（逗号分隔，或输入'all'选择全部）: ")

            try:
                selected_ids = self._parse_input(user_input, bangumi_list)
                if selected_ids:
                    return selected_ids
                else:
                    print("请至少选择一部番剧")
            except ValueError as e:
                print(f"输入无效: {e}，请重新输入")

    def _parse_input(self, user_input: str, bangumi_list: list[Bangumi]) -> list[str]:
        \"\"\"解析用户输入\"\"\"
        if user_input.strip().lower() == "all":
            return [b.id for b in bangumi_list]

        indices = [int(x.strip()) for x in user_input.split(",")]

        if any(i < 1 or i > len(bangumi_list) for i in indices):
            raise ValueError("编号超出范围")

        return [bangumi_list[i-1].id for i in indices]
```

输出要求：
1. src/application/filter_agent.py
2. 用户友好的交互提示
3. 完善的输入验证

注意事项：
- 这是简化版实现，未来可扩展为富交互UI
- 保持接口简单，便于后续替换实现
```

**验收标准**:
- [ ] 可以展示番剧列表
- [ ] 可以解析用户输入（逗号分隔的编号）
- [ ] 输入验证正常工作

---

## Phase 5: User Story 3 - 圣地查询（P3优先级）

### T012 [US3] 实现PointsAgent

**时间**: 1小时
**依赖**: T006, T007
**文件**: `src/application/points_agent.py`

**提示词**:
```
你是一位数据聚合专家。

任务：实现PointsAgent，负责获取选中番剧的附近圣地。

实现要求：

1. **get_nearby_points()**:
   ```python
   async def get_nearby_points(
       self,
       bangumi_ids: list[str],
       center: Coordinates,
       radius_km: float = 5.0
   ) -> list[Point]:
   ```
   - 对每个番剧ID，并行调用anitabi_client.get_bangumi_points()
   - 使用geo_utils.filter_points_in_radius()筛选半径内的圣地
   - 合并所有圣地，按距离排序
   - 警告：如果圣地总数>50，提示用户

2. **性能优化**:
   - 使用asyncio.gather()并行查询多个番剧
   - 限制并发数（最多10个并发请求）

范例代码：
```python
import asyncio
from src.domain.entities import Coordinates, Point
from src.domain.interfaces import IAnitabiClient
from src.infrastructure.geo_utils import filter_points_in_radius, calculate_distance

class PointsAgent:
    \"\"\"圣地查询Agent\"\"\"

    MAX_CONCURRENT = 10  # 最大并发请求数
    WARNING_THRESHOLD = 50  # 圣地数量警告阈值

    def __init__(self, anitabi_client: IAnitabiClient):
        self._anitabi = anitabi_client

    async def get_nearby_points(
        self,
        bangumi_ids: list[str],
        center: Coordinates,
        radius_km: float = 5.0
    ) -> list[Point]:
        \"\"\"获取附近的圣地点位\"\"\"

        # 并行查询所有番剧的圣地
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT)

        async def fetch_with_limit(bangumi_id: str):
            async with semaphore:
                return await self._anitabi.get_bangumi_points(bangumi_id)

        tasks = [fetch_with_limit(bid) for bid in bangumi_ids]
        all_points_lists = await asyncio.gather(*tasks, return_exceptions=True)

        # 合并结果（忽略错误）
        all_points = []
        for result in all_points_lists:
            if isinstance(result, list):
                all_points.extend(result)

        # 筛选半径内的圣地
        nearby_points = filter_points_in_radius(center, all_points, radius_km)

        # 排序
        sorted_points = sorted(
            nearby_points,
            key=lambda p: calculate_distance(center, p.coordinates)
        )

        # 警告
        if len(sorted_points) > self.WARNING_THRESHOLD:
            print(f"⚠️ 圣地数量较多({len(sorted_points)}个)，建议筛选或分多天完成")

        return sorted_points
```

输出要求：
1. src/application/points_agent.py
2. 并发控制（Semaphore）
3. 错误容错（部分番剧查询失败不影响其他）

ultrathink：
- 如何处理某个番剧查询失败？（忽略异常，记录日志）
- 如何优化内存占用？（使用生成器？）
```

**验收标准**:
- [ ] 可以并行查询多个番剧
- [ ] 正确筛选半径内的圣地
- [ ] 圣地数量>50时有警告

---

## Phase 6: User Story 4 - 路线生成（P4优先级）

### T013 [US4] 实现Google Maps客户端

**时间**: 1.5小时
**依赖**: T005
**文件**: `src/infrastructure/gmaps_client.py`

**提示词**:
```
你是一位Google Maps API集成专家。

任务：实现GoogleMapsClient，封装Geocoding和Directions API。

API密钥：
- 从环境变量读取：GOOGLE_MAPS_API_KEY
- 错误处理：密钥未设置时抛出清晰错误

实现要求：

1. **geocode_station()**:
   - 调用Geocoding API
   - 输入："新宿站"
   - 输出：Coordinates(35.6896, 139.7006)
   - 缓存结果（避免重复查询）

2. **optimize_route()**:
   - 调用Directions API
   - 参数：
     - origin: 起点坐标
     - destinations: 圣地列表（最多23个waypoints）
     - mode: transit（公共交通）
     - optimize: true（优化顺序）
   - 返回：Route对象
   - 包含Google Maps URL

Google Directions API限制：
- 最多23个waypoints（不含起点和终点）
- 如果圣地>23个，需要分段处理或使用贪心算法

范例代码：
```python
import os
import httpx
from src.domain.entities import Coordinates, Point, Route, RouteSegment
from src.domain.interfaces import IGeocodingService, IRoutingService

class GoogleMapsClient(IGeocodingService, IRoutingService):
    \"\"\"Google Maps API客户端\"\"\"

    BASE_URL = "https://maps.googleapis.com/maps/api"

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.getenv("GOOGLE_MAPS_API_KEY")
        if not self._api_key:
            raise ValueError("GOOGLE_MAPS_API_KEY环境变量未设置")

        self._client = httpx.AsyncClient(timeout=10.0)
        self._cache = {}  # 简单的内存缓存

    async def geocode_station(self, station_name: str) -> Coordinates:
        \"\"\"地理编码\"\"\"
        # 检查缓存
        if station_name in self._cache:
            return self._cache[station_name]

        url = f"{self.BASE_URL}/geocode/json"
        params = {
            "address": station_name,
            "key": self._api_key,
            "language": "ja"  # 日语优先
        }

        response = await self._client.get(url, params=params)
        response.raise_for_status()

        data = response.json()
        if data["status"] != "OK":
            raise ValueError(f"地理编码失败: {data['status']}")

        location = data["results"][0]["geometry"]["location"]
        coords = Coordinates(latitude=location["lat"], longitude=location["lng"])

        # 缓存
        self._cache[station_name] = coords
        return coords

    async def optimize_route(
        self,
        origin: Coordinates,
        points: list[Point]
    ) -> Route:
        \"\"\"生成最优路线\"\"\"

        if len(points) > 23:
            # TODO: 处理超过23个waypoints的情况
            raise ValueError("圣地数量超过23个，暂不支持")

        # 构建Directions API请求
        waypoints_str = "|".join([
            f"{p.coordinates.latitude},{p.coordinates.longitude}"
            for p in points
        ])

        url = f"{self.BASE_URL}/directions/json"
        params = {
            "origin": f"{origin.latitude},{origin.longitude}",
            "destination": f"{points[-1].coordinates.latitude},{points[-1].coordinates.longitude}",
            "waypoints": f"optimize:true|{waypoints_str}",
            "mode": "transit",
            "key": self._api_key
        }

        response = await self._client.get(url, params=params)
        data = response.json()

        # TODO: 解析返回的路线数据
        # TODO: 构建Route对象
        pass
```

输出要求：
1. src/infrastructure/gmaps_client.py
2. 完整的错误处理
3. API密钥从环境变量读取
4. 简单的缓存机制

ultrathink：
- 如何处理超过23个waypoints？
  - 方案1：使用贪心算法自己计算顺序
  - 方案2：分段优化（每23个一组）
  - 方案3：警告用户，建议筛选
```

**验收标准**:
- [ ] 可以成功调用Geocoding API
- [ ] 可以成功调用Directions API
- [ ] API密钥未设置时有清晰错误

---

### T014 [US4] 实现RouteAgent

**时间**: 1小时
**依赖**: T013
**文件**: `src/application/route_agent.py`

**提示词**:
```
你是一位路线规划专家。

任务：实现RouteAgent，负责生成最优巡礼路线。

实现要求：

1. **generate_route()**:
   ```python
   async def generate_route(
       self,
       origin: Station,
       points: list[Point]
   ) -> Route:
   ```
   - 调用routing_service.optimize_route()
   - 生成Google Maps导航URL
   - 计算总距离和总时间
   - 返回Route对象

2. **导航URL生成**:
   - 格式：`https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=...&travelmode=transit`
   - 包含所有waypoints

范例代码：
```python
from src.domain.entities import Station, Point, Route
from src.domain.interfaces import IRoutingService

class RouteAgent:
    \"\"\"路线规划Agent\"\"\"

    def __init__(self, routing_service: IRoutingService):
        self._routing = routing_service

    async def generate_route(
        self,
        origin: Station,
        points: list[Point]
    ) -> Route:
        \"\"\"生成最优路线\"\"\"

        if not points:
            raise ValueError("圣地列表为空")

        # 调用路线规划服务
        route = await self._routing.optimize_route(origin.coordinates, points)

        # 生成导航URL
        navigation_url = self._build_navigation_url(origin, points)

        # 更新Route对象
        route.google_maps_url = navigation_url

        return route

    def _build_navigation_url(self, origin: Station, points: list[Point]) -> str:
        \"\"\"构建Google Maps导航URL\"\"\"
        origin_str = f"{origin.coordinates.latitude},{origin.coordinates.longitude}"
        destination = points[-1]
        dest_str = f"{destination.coordinates.latitude},{destination.coordinates.longitude}"

        waypoints = "|".join([
            f"{p.coordinates.latitude},{p.coordinates.longitude}"
            for p in points[:-1]
        ])

        return (
            f"https://www.google.com/maps/dir/?api=1"
            f"&origin={origin_str}"
            f"&destination={dest_str}"
            f"&waypoints={waypoints}"
            f"&travelmode=transit"
        )
```

输出要求：
1. src/application/route_agent.py
2. 生成可用的Google Maps URL
3. 完整的类型注解

验收：生成的URL可以在浏览器中打开并显示路线
```

**验收标准**:
- [ ] 可以生成Route对象
- [ ] Google Maps URL可以在浏览器打开
- [ ] 路线包含所有圣地点位

---

**Checkpoint**: 此时核心业务逻辑（US1-US4）已完成

---

## Phase 7: User Story 5 - 地图可视化（P5优先级）

### T015 [US5] 实现MapGeneratorTool

**时间**: 1.5小时
**依赖**: T001
**文件**: `src/presentation/map_generator.py`

**提示词**:
```
你是一位地图可视化专家，精通Leafmap和Folium。

任务：实现MapGeneratorTool，生成交互式HTML地图。

技术栈：
- 使用Leafmap（backend: folium）
- 底图：OpenStreetMap
- 标记：不同番剧用不同颜色

实现要求：

1. **generate_map()**:
   ```python
   async def generate_map(
       self,
       route: Route,
       output_path: str = "outputs/map.html"
   ) -> str:
   ```
   - 创建地图实例（中心：起点坐标）
   - 添加起点标记（蓝色）
   - 添加圣地标记（按番剧分色）
   - 绘制路线折线
   - 添加点击弹窗（名称、番剧、截图）
   - 导出HTML

2. **标记样式**:
   - 起点：蓝色圆圈，标签"起点"
   - 圣地：彩色圆点，不同番剧不同颜色
   - 路线：红色实线，带方向箭头

3. **弹窗内容**:
   - 圣地名称（中文/日文）
   - 所属番剧
   - 对应集数和时间
   - 场景截图缩略图

范例代码：
```python
import leafmap
from src.domain.entities import Route

class MapGeneratorTool:
    \"\"\"地图生成工具\"\"\"

    COLORS = ["red", "blue", "green", "purple", "orange", "darkred",
              "lightred", "beige", "darkblue", "darkgreen"]

    async def generate_map(
        self,
        route: Route,
        output_path: str = "outputs/map.html"
    ) -> str:
        \"\"\"生成交互式地图\"\"\"

        # 创建地图（中心：起点）
        center = [route.origin.coordinates.latitude, route.origin.coordinates.longitude]
        m = leafmap.Map(center=center, zoom=13)

        # 添加起点标记
        m.add_marker(
            location=center,
            popup=f"<b>起点</b><br>{route.origin.name}",
            icon=leafmap.Icon(color="blue", icon="info-sign")
        )

        # 按番剧分组圣地
        bangumi_groups = self._group_by_bangumi(route)

        # 添加圣地标记
        for bangumi_id, (color, points) in bangumi_groups.items():
            for segment in points:
                point = segment.point
                popup_html = self._build_popup(point, segment.order)

                m.add_marker(
                    location=[point.coordinates.latitude, point.coordinates.longitude],
                    popup=popup_html,
                    icon=leafmap.Icon(color=color, icon="star")
                )

        # 绘制路线
        route_coords = [[route.origin.coordinates.latitude, route.origin.coordinates.longitude]]
        route_coords.extend([
            [seg.point.coordinates.latitude, seg.point.coordinates.longitude]
            for seg in route.segments
        ])

        m.add_polyline(
            locations=route_coords,
            color="red",
            weight=3,
            opacity=0.7
        )

        # 导出HTML
        m.to_html(output_path)
        return output_path

    def _group_by_bangumi(self, route: Route) -> dict:
        \"\"\"按番剧分组\"\"\"
        groups = {}
        color_index = 0

        for segment in route.segments:
            bangumi_id = segment.point.bangumi_id
            if bangumi_id not in groups:
                groups[bangumi_id] = (self.COLORS[color_index % len(self.COLORS)], [])
                color_index += 1
            groups[bangumi_id][1].append(segment)

        return groups

    def _build_popup(self, point, order: int) -> str:
        \"\"\"构建弹窗HTML\"\"\"
        return f\"\"\"
        <div style="width: 200px">
            <h4>第{order}站: {point.cn_name}</h4>
            <p><b>番剧:</b> {point.bangumi_title}</p>
            <p><b>集数:</b> 第{point.episode}集 {point.time_seconds // 60}:{point.time_seconds % 60:02d}</p>
            <img src="{point.screenshot_url}?plan=h360" width="180px">
        </div>
        \"\"\"
```

输出要求：
1. src/presentation/map_generator.py
2. 生成的HTML地图可在浏览器打开
3. 交互功能正常（点击、缩放、平移）

ultrathink：
- 如何处理大量标记（100+）的性能问题？
- 如何处理截图URL失效的情况？
```

**验收标准**:
- [ ] 可以生成HTML地图文件
- [ ] 地图包含起点、圣地、路线
- [ ] 点击标记显示弹窗

---

## Phase 8: User Story 6 - PDF导出（P6优先级）

### T016 [US6] 实现PDFGeneratorTool

**时间**: 2小时
**依赖**: T015
**文件**: `src/presentation/pdf_generator.py`, `templates/pilgrimage_guide.html`

**提示词**:
```
你是一位PDF生成专家，精通Playwright和Jinja2。

任务：实现PDFGeneratorTool，生成可打印的巡礼手册。

技术栈：
- Playwright（HTML→PDF）
- Jinja2（模板渲染）

实现要求：

1. **generate_pdf()**:
   ```python
   async def generate_pdf(
       self,
       route: Route,
       map_screenshot_path: str,
       output_path: str = "outputs/pilgrimage_guide.pdf"
   ) -> str:
   ```
   - 渲染HTML模板
   - 使用Playwright转换为PDF
   - 压缩图片（保持PDF<5MB）

2. **HTML模板结构**:
   - 封面页：番剧封面、日期、起点
   - 路线总览页：地图截图、基本信息
   - 圣地详情页：每个圣地一页
   - 附录页：注意事项

3. **PDF配置**:
   - 纸张：A4
   - 边距：20mm
   - 背景：打印背景色和图片

范例代码：
```python
from playwright.async_api import async_playwright
from jinja2 import Environment, FileSystemLoader
from src.domain.entities import Route

class PDFGeneratorTool:
    \"\"\"PDF生成工具\"\"\"

    def __init__(self, template_dir: str = "templates"):
        self.env = Environment(loader=FileSystemLoader(template_dir))

    async def generate_pdf(
        self,
        route: Route,
        map_screenshot_path: str,
        output_path: str = "outputs/pilgrimage_guide.pdf"
    ) -> str:
        \"\"\"生成PDF巡礼手册\"\"\"

        # 渲染HTML
        html_content = self._render_template(route, map_screenshot_path)

        # 保存临时HTML
        temp_html = "outputs/temp_guide.html"
        with open(temp_html, "w", encoding="utf-8") as f:
            f.write(html_content)

        # Playwright转换为PDF
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            await page.goto(f"file://{os.path.abspath(temp_html)}")
            await page.wait_for_load_state("networkidle")

            await page.pdf(
                path=output_path,
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

        return output_path

    def _render_template(self, route: Route, map_path: str) -> str:
        \"\"\"渲染Jinja2模板\"\"\"
        template = self.env.get_template("pilgrimage_guide.html")

        data = {
            "route": route,
            "map_image_path": map_path,
            "date": "2025-11-20",  # TODO: 使用实际日期
            "bangumi_list": self._extract_bangumi_list(route)
        }

        return template.render(**data)

    def _extract_bangumi_list(self, route: Route) -> list:
        \"\"\"提取番剧列表（去重）\"\"\"
        seen = set()
        bangumi_list = []

        for segment in route.segments:
            if segment.point.bangumi_id not in seen:
                bangumi_list.append({
                    "id": segment.point.bangumi_id,
                    "title": segment.point.bangumi_title
                })
                seen.add(segment.point.bangumi_id)

        return bangumi_list
```

HTML模板示例（templates/pilgrimage_guide.html）:
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: "Noto Sans CJK SC", sans-serif; }
        .cover { text-align: center; padding: 100px 0; }
        .page-break { page-break-after: always; }
        .point-page { padding: 40px; }
    </style>
</head>
<body>
    <!-- 封面页 -->
    <div class="cover page-break">
        <h1>{{ route.origin.name }}圣地巡礼手册</h1>
        <p>日期: {{ date }}</p>
    </div>

    <!-- 路线总览 -->
    <div class="overview page-break">
        <h2>路线总览</h2>
        <img src="{{ map_image_path }}" width="100%">
        <p>总距离: {{ route.total_distance_km }} km</p>
        <p>预计时间: {{ route.total_duration_minutes }} 分钟</p>
    </div>

    <!-- 圣地详情 -->
    {% for segment in route.segments %}
    <div class="point-page page-break">
        <h3>第{{ segment.order }}站: {{ segment.point.cn_name }}</h3>
        <p>番剧: {{ segment.point.bangumi_title }}</p>
        <img src="{{ segment.point.screenshot_url }}" width="100%">
    </div>
    {% endfor %}
</body>
</html>
```

输出要求：
1. src/presentation/pdf_generator.py
2. templates/pilgrimage_guide.html
3. 生成的PDF文件<5MB

ultrathink：
- 如何处理中文字体？（Playwright自带Noto Sans CJK）
- 如何优化PDF大小？（压缩图片、降低分辨率）
```

**验收标准**:
- [ ] 可以生成PDF文件
- [ ] PDF包含所有页面（封面、地图、详情）
- [ ] 文件大小<5MB（50个圣地以内）

---

## Phase 9: 集成与端到端测试

### T017 实现OrchestratorAgent（主控）

**时间**: 1.5小时
**依赖**: T010, T011, T012, T014
**文件**: `src/application/orchestrator.py`

**提示词**:
```
你是一位系统架构师，精通编排（Orchestration）模式。

任务：实现OrchestratorAgent，协调所有子Agent。

实现要求：

1. **execute_pilgrimage_plan()**:
   ```python
   async def execute_pilgrimage_plan(
       self,
       station_name: str,
       radius_km: float = 5.0
   ) -> dict:
   ```
   - 步骤1：SearchAgent搜索番剧
   - 步骤2：FilterAgent收集用户选择
   - 步骤3：PointsAgent获取圣地
   - 步骤4：RouteAgent生成路线
   - 步骤5：MapGenerator生成地图
   - 步骤6：PDFGenerator生成PDF
   - 返回：所有输出文件路径

2. **状态管理**:
   - 使用InMemorySessionService保存中间状态
   - 记录每个步骤的执行时间
   - 完整的日志追踪

3. **错误处理**:
   - 某个步骤失败时，保存已完成的部分
   - 提供清晰的错误信息和恢复建议

范例代码：
```python
import logging
from src.application.search_agent import SearchAgent
from src.application.filter_agent import FilterAgent
from src.application.points_agent import PointsAgent
from src.application.route_agent import RouteAgent
from src.presentation.map_generator import MapGeneratorTool
from src.presentation.pdf_generator import PDFGeneratorTool

class OrchestratorAgent:
    \"\"\"主控Agent，协调整个流程\"\"\"

    def __init__(
        self,
        search_agent: SearchAgent,
        filter_agent: FilterAgent,
        points_agent: PointsAgent,
        route_agent: RouteAgent,
        map_generator: MapGeneratorTool,
        pdf_generator: PDFGeneratorTool,
        logger: logging.Logger | None = None
    ):
        self._search = search_agent
        self._filter = filter_agent
        self._points = points_agent
        self._route = route_agent
        self._map = map_generator
        self._pdf = pdf_generator
        self._logger = logger or logging.getLogger(__name__)

    async def execute_pilgrimage_plan(
        self,
        station_name: str,
        radius_km: float = 5.0
    ) -> dict:
        \"\"\"执行完整的巡礼规划流程\"\"\"

        self._logger.info(f"开始巡礼规划: {station_name}")

        try:
            # 步骤1：搜索番剧
            self._logger.info("步骤1: 搜索附近番剧")
            bangumi_list = await self._search.search_nearby_bangumi(station_name, radius_km)

            if not bangumi_list:
                return {"error": "该区域暂无圣地数据"}

            # 步骤2：用户选择
            self._logger.info("步骤2: 收集用户偏好")
            selected_ids = await self._filter.filter_bangumi(bangumi_list)

            # 步骤3：获取圣地
            self._logger.info("步骤3: 获取圣地点位")
            station = Station(name=station_name, coordinates=bangumi_list[0].coordinates)
            points = await self._points.get_nearby_points(
                selected_ids,
                station.coordinates,
                radius_km
            )

            if not points:
                return {"error": "选中的番剧在该区域没有圣地"}

            # 步骤4：生成路线
            self._logger.info("步骤4: 生成最优路线")
            route = await self._route.generate_route(station, points)

            # 步骤5：生成地图
            self._logger.info("步骤5: 生成交互式地图")
            map_path = await self._map.generate_map(route)

            # 步骤6：生成PDF
            self._logger.info("步骤6: 生成PDF手册")
            pdf_path = await self._pdf.generate_pdf(route, map_path)

            self._logger.info("巡礼规划完成！")

            return {
                "success": True,
                "map_path": map_path,
                "pdf_path": pdf_path,
                "google_maps_url": route.google_maps_url,
                "summary": {
                    "total_points": len(points),
                    "total_distance_km": route.total_distance_km,
                    "estimated_duration_minutes": route.total_duration_minutes
                }
            }

        except Exception as e:
            self._logger.error(f"执行失败: {e}", exc_info=True)
            return {"error": str(e)}
```

输出要求：
1. src/application/orchestrator.py
2. 完整的流程编排
3. 详细的日志记录

ultrathink：
- 如何实现中间状态保存？（断点续传）
- 如何支持并行执行部分步骤？（如地图和PDF同时生成）
```

**验收标准**:
- [ ] 可以完整执行所有步骤
- [ ] 每个步骤有日志记录
- [ ] 错误时返回清晰的错误信息

---

### T018 端到端集成测试

**时间**: 1.5小时
**依赖**: T017
**文件**: `tests/integration/test_end_to_end.py`

**提示词**:
```
你是一位集成测试专家。

任务：编写端到端集成测试，验证完整流程。

测试策略：
- 使用真实API调用
- 验证完整的用户旅程
- 检查所有输出文件

测试用例：

1. test_complete_pilgrimage_flow():
   - 输入：新宿站
   - 选择：前3个番剧
   - 验证：生成地图和PDF
   - 验证：Google Maps URL可用

2. test_handles_no_bangumi_gracefully():
   - 输入：无圣地的车站
   - 验证：返回友好错误

3. test_handles_too_many_points():
   - 选择：大量番剧（>50个圣地）
   - 验证：有警告提示

范例代码：
```python
import pytest
from src.application.orchestrator import OrchestratorAgent
# ... import all dependencies

class TestEndToEnd:
    @pytest.fixture
    async def orchestrator(self):
        # 创建真实的依赖
        geocoding = GoogleMapsClient()
        anitabi = AnitabiClient()

        search_agent = SearchAgent(geocoding, anitabi)
        filter_agent = FilterAgent()
        points_agent = PointsAgent(anitabi)
        route_agent = RouteAgent(geocoding)
        map_gen = MapGeneratorTool()
        pdf_gen = PDFGeneratorTool()

        return OrchestratorAgent(
            search_agent, filter_agent, points_agent,
            route_agent, map_gen, pdf_gen
        )

    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_complete_pilgrimage_flow(self, orchestrator):
        # Arrange
        station_name = "新宿站"

        # Act
        result = await orchestrator.execute_pilgrimage_plan(station_name)

        # Assert
        assert result["success"] is True
        assert os.path.exists(result["map_path"])
        assert os.path.exists(result["pdf_path"])
        assert result["google_maps_url"].startswith("https://www.google.com/maps")
```

输出要求：
1. tests/integration/test_end_to_end.py
2. 至少3个端到端测试
3. 验证所有输出

ultrathink：
- 如何Mock用户输入？（monkeypatch input函数）
- 如何清理测试生成的文件？（pytest fixture cleanup）
```

**验收标准**:
- [ ] 端到端测试全部通过
- [ ] 生成的文件可用
- [ ] 测试可重复运行

---

## Phase 10: 文档与部署

### T019 [P] 完善README和使用文档

**时间**: 1小时
**依赖**: T018
**文件**: `README.md`, `docs/setup.md`, `docs/usage.md`

**提示词**:
```
你是一位技术文档专家。

任务：完善项目文档。

文档内容：

1. **README.md**:
   - 项目简介和价值主张
   - 快速开始（5分钟内运行）
   - 功能特性
   - 技术架构图
   - ADK Capstone要求映射

2. **docs/setup.md**:
   - 环境要求（Python 3.10+）
   - 依赖安装
   - API密钥配置
   - 故障排除

3. **docs/usage.md**:
   - 命令行使用示例
   - 输出文件说明
   - 高级配置

范例（README.md结构）:
```markdown
# Seichijunrei Bot

> 智能动漫圣地巡礼助手 | Google ADK Capstone Project

## 问题

动漫爱好者在圣地巡礼时面临：信息分散、路线规划困难、不知道周边有哪些圣地

## 解决方案

输入车站名称 → 自动搜索、过滤、规划 → 输出地图和PDF手册

## 快速开始

\`\`\`bash
# 1. 安装依赖
uv pip install -r requirements.txt

# 2. 配置API密钥
cp .env.template .env
# 编辑.env，填入GOOGLE_MAPS_API_KEY

# 3. 运行
python -m src.main --station "新宿站"
\`\`\`

## 输出示例

- `outputs/map.html` - 交互式地图
- `outputs/pilgrimage_guide.pdf` - 巡礼手册
- Google Maps导航链接

## 技术架构

\`\`\`
Orchestrator Agent
├─ SearchAgent (搜索番剧)
├─ FilterAgent (用户选择)
├─ PointsAgent (获取圣地)
├─ RouteAgent (生成路线)
├─ MapGeneratorTool (地图)
└─ PDFGeneratorTool (PDF)
\`\`\`

## ADK Capstone要求

✅ Multi-agent System (5个Agent)
✅ Custom Tools (MapGenerator, PDFGenerator)
✅ OpenAPI Tools (Google Maps, Anitabi)
✅ Sessions & Memory
✅ Observability
\`\`\`

输出要求：
1. 清晰的项目结构
2. 可复制的安装步骤
3. 截图或示例输出

不要做：
- 不要过度技术化（面向非技术用户）
- 不要包含开发细节（留在docs/development.md）
```

**验收标准**:
- [ ] 按README可在5分钟内运行
- [ ] 所有链接可用
- [ ] 包含示例输出截图

---

### T020 部署到Google Agent Engine

**时间**: 2小时
**依赖**: T019
**文件**: `deploy/Dockerfile`, `deploy/cloudbuild.yaml`

**提示词**:
```
你是一位云部署专家，精通Google Cloud Platform。

任务：将Seichijunrei Bot部署到Google Agent Engine或Cloud Run。

部署要求：

1. **Dockerfile**:
   - 基础镜像：python:3.10-slim
   - 安装依赖
   - 安装Playwright Chromium
   - 暴露端口8080

2. **环境变量**:
   - GOOGLE_MAPS_API_KEY（从Secret Manager读取）
   - PORT=8080

3. **部署脚本**:
   - 使用gcloud命令部署
   - 设置内存：2GB
   - 设置超时：300秒

Dockerfile示例：
```dockerfile
FROM python:3.10-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \\
    libnss3 libatk1.0-0 libcups2 \\
    && rm -rf /var/lib/apt/lists/*

# 安装Python依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装Playwright
RUN playwright install chromium

# 复制代码
COPY src/ src/
COPY templates/ templates/

# 暴露端口
EXPOSE 8080

# 启动命令
CMD ["python", "-m", "src.main"]
```

部署命令：
```bash
gcloud run deploy seichijunrei-bot \\
  --source . \\
  --platform managed \\
  --region asia-northeast1 \\
  --memory 2Gi \\
  --timeout 300 \\
  --set-env-vars GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY
```

输出要求：
1. deploy/Dockerfile
2. deploy/cloudbuild.yaml
3. deploy.sh（部署脚本）

ultrathink：
- 如何减小Docker镜像大小？（多阶段构建）
- 如何处理冷启动问题？（保持至少1个实例）

**验收：部署成功，可通过公网URL访问**
```

**验收标准**:
- [ ] Docker镜像可构建
- [ ] 成功部署到Cloud Run
- [ ] 获得公网访问URL

---

## Phase 11: 提交准备

### T021 录制Demo视频

**时间**: 1小时
**依赖**: T020
**文件**: `demo.mp4`

**提示词**:
```
你是一位产品演示专家。

任务：录制3分钟Demo视频（ADK Capstone要求）。

视频结构（符合ADK要求）:

1. **问题陈述** (30秒):
   - 圣地巡礼的痛点
   - 为什么需要这个Agent

2. **Agents介绍** (30秒):
   - 为什么使用Multi-agent架构
   - 每个Agent的职责

3. **架构图** (30秒):
   - 展示系统架构图
   - 数据流

4. **实际演示** (60秒):
   - 输入：新宿站
   - 展示搜索结果
   - 用户选择
   - 生成的地图和PDF

5. **技术亮点** (30秒):
   - Multi-agent协作
   - 路线优化算法
   - 输出质量

录制工具建议：
- OBS Studio（免费）
- QuickTime（Mac）
- Loom（在线）

输出要求：
- 时长：<3分钟
- 格式：MP4
- 分辨率：1080p
- 上传到YouTube（Unlisted）

脚本范例：
```
【画面】标题页
大家好，我是XXX，今天展示我的ADK Capstone项目：Seichijunrei Bot

【画面】痛点图
动漫爱好者在圣地巡礼时面临三大痛点：信息分散、路线规划困难、不知道周边有哪些圣地

【画面】架构图
我使用Multi-agent架构解决这个问题，包含5个专门的Agent...

【画面】实际演示】
让我演示一下：输入"新宿站"...系统自动搜索到20部番剧...我选择《你的名字》和《天气之子》...系统生成了最优路线...
```

不要做：
- 不要超过3分钟
- 不要包含冗长的代码展示
- 不要使用过于技术化的语言
```

**验收标准**:
- [ ] 视频<3分钟
- [ ] 包含所有必需元素（问题、架构、演示）
- [ ] 上传到YouTube

---

### T022 撰写项目Writeup

**时间**: 1.5小时
**依赖**: T021
**文件**: `WRITEUP.md`

**提示词**:
```
你是一位技术作家。

任务：撰写项目Writeup（<1500字）。

结构（符合ADK Capstone要求）:

1. **项目标题和副标题**

2. **问题陈述** (200字):
   - 用户痛点
   - 市场现状

3. **解决方案** (300字):
   - Agent系统设计
   - 核心价值

4. **架构** (400字):
   - Multi-agent设计
   - 每个Agent的职责
   - 数据流
   - 架构图

5. **实现亮点** (300字):
   - TDD实践
   - SOLID原则
   - 性能优化

6. **Demo与结果** (200字):
   - 实际效果
   - 用户反馈

7. **未来规划** (100字):
   - 可扩展性
   - 商业化潜力

范例开头：
```markdown
# Seichijunrei Bot: 智能动漫圣地巡礼助手

> 用Multi-agent系统解决圣地巡礼规划难题

## 问题陈述

动漫圣地巡礼是新兴的旅行方式，但爱好者面临三大痛点：

1. **信息分散**：圣地数据散落在各个网站，难以系统性获取
2. **路线规划困难**：多个圣地之间如何高效访问？
3. **缺少工具**：没有专门的规划和导航工具

手动规划一次巡礼需要2-3小时，且容易遗漏关键信息。

## 解决方案

Seichijunrei Bot使用Multi-agent架构，自动化完成...
\`\`\`

输出要求：
1. WRITEUP.md（<1500字）
2. 包含架构图
3. 清晰的段落结构

不要做：
- 不要超过1500字
- 不要包含代码片段
- 不要过度技术化
```

**验收标准**:
- [ ] 字数<1500
- [ ] 包含所有必需章节
- [ ] 清晰表达价值和技术亮点

---

### T023 Kaggle提交

**时间**: 30分钟
**依赖**: T021, T022
**提示词**:
```
你是一位项目交付专家。

任务：完成Kaggle Capstone提交。

提交清单：

1. **标题和副标题**
2. **Card Image**（封面图）
3. **Track**: Concierge Agents
4. **Media Gallery**: YouTube视频URL
5. **Project Description**: 复制WRITEUP.md内容
6. **Attachments**: GitHub仓库链接

GitHub仓库检查：
- [ ] README.md完整
- [ ] 所有代码已push
- [ ] .env.template已包含
- [ ] 无敏感信息
- [ ] 仓库设为Public

提交步骤：
1. 访问Kaggle Competitions页面
2. 填写所有必填字段
3. 上传封面图
4. 添加视频链接
5. 提交

验收：提交成功，收到确认邮件
```

**验收标准**:
- [ ] Kaggle提交成功
- [ ] GitHub仓库Public且完整
- [ ] 所有链接可访问

---

## 依赖关系总结

```
Phase 1 (Setup)
  └─> Phase 2 (Foundational) [BLOCKING]
        ├─> Phase 3 (US1) ──┐
        ├─> Phase 4 (US2) ──┤
        ├─> Phase 5 (US3) ──┼─> Phase 9 (Integration)
        ├─> Phase 6 (US4) ──┤     └─> Phase 10 (Deploy)
        ├─> Phase 7 (US5) ──┤           └─> Phase 11 (Submission)
        └─> Phase 8 (US6) ──┘
```

**关键路径**: Phase 1 → 2 → 3 → 4 → 5 → 6 → 9 → 10 → 11

**并行机会**:
- Phase 3-8可在Phase 2完成后并行开发
- T003和T007可并行（不同文件）
- T015和T016可并行（地图和PDF）

---

## 时间估算总结

| Phase | 任务数 | 预计时间 | 缓冲时间 | 总计 |
|-------|--------|---------|---------|------|
| Phase 1 | 2 | 1小时 | +0.5小时 | 1.5小时 |
| Phase 2 | 6 | 6小时 | +1.5小时 | 7.5小时 |
| Phase 3 | 2 | 2小时 | +0.5小时 | 2.5小时 |
| Phase 4 | 1 | 0.75小时 | +0.25小时 | 1小时 |
| Phase 5 | 1 | 1小时 | +0.5小时 | 1.5小时 |
| Phase 6 | 2 | 2.5小时 | +0.5小时 | 3小时 |
| Phase 7 | 1 | 1.5小时 | +0.5小时 | 2小时 |
| Phase 8 | 1 | 2小时 | +0.5小时 | 2.5小时 |
| Phase 9 | 2 | 3小时 | +1小时 | 4小时 |
| Phase 10 | 2 | 3小时 | +1小时 | 4小时 |
| Phase 11 | 3 | 3小时 | +0.5小时 | 3.5小时 |
| **总计** | **23** | **25.75小时** | **+7.25小时** | **33小时** |

**建议计划**: 分10天完成，每天3-4小时

---

## 开发原则 Checklist

每个任务完成前检查：

- [ ] **TDD**: 测试先写，确保失败，再实现
- [ ] **SOLID**:
  - [ ] 单一职责（每个类只做一件事）
  - [ ] 开闭原则（对扩展开放，对修改关闭）
  - [ ] 里氏替换（接口和实现可替换）
  - [ ] 接口隔离（接口最小化）
  - [ ] 依赖倒置（依赖抽象不依赖实现）
- [ ] **Clean Code**:
  - [ ] 命名清晰（函数、变量、类）
  - [ ] 函数简短（<20行）
  - [ ] 无重复代码（DRY）
  - [ ] 注释必要但不冗余
- [ ] **KISS**: 保持简单，不过度设计
- [ ] **YAGNI**: 不实现暂时不需要的功能
- [ ] **测试覆盖**: 核心逻辑有单元测试
- [ ] **类型注解**: 所有函数有类型提示
- [ ] **错误处理**: 异常有明确的错误消息

---

**Version**: 1.0
**Created**: 2025-11-20
**Author**: Zhenjia Zhou (遵循TDD和Clean Code原则)
