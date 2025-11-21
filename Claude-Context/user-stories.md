# Feature Specification: Seichijunrei Bot (圣地巡礼机器人)

**Feature Branch**: `seichijunrei-mvp`
**Created**: 2025-11-20
**Status**: Ready for Implementation
**Track**: Concierge Agents (Google ADK Capstone)

---

## Project Overview

**Problem**: 动漫爱好者在圣地巡礼时面临以下痛点：
- 圣地信息分散，难以系统性获取
- 路线规划困难，容易走回头路
- 不知道周边有哪些番剧的圣地

**Solution**: 智能多Agent系统，基于车站位置自动搜索、过滤、规划最优路线并生成可视化输出。

**Value**:
- 节省用户2-3小时的手动搜索和规划时间
- 提供专业的路线规划，避免走回头路
- 生成可打印的巡礼手册和交互式地图

---

## Business Flow (核心流程)

```
┌─────────────────────────────────────────────────────────────┐
│                    Seichijunrei Bot                         │
│                     用户旅程流程                             │
└─────────────────────────────────────────────────────────────┘

用户输入车站名称
       ↓
   【步骤1】地理编码
   └─→ 车站名 → GPS坐标
       ↓
   【步骤2】搜索附近番剧
   └─→ Anitabi API: 查询车站周边5km的番剧
   └─→ 返回：番剧列表（名称、封面、圣地数量、距离）
       ↓
   【步骤3】用户选择
   └─→ 展示番剧列表
   └─→ 用户多选已观看的番剧
       ↓
   【步骤4】获取附近圣地
   └─→ Anitabi API: 获取选中番剧的圣地详情
   └─→ 筛选：仅保留搜索半径内的圣地
   └─→ 返回：圣地点位列表（名称、坐标、截图、集数）
       ↓
   【步骤5】生成最优路线
   └─→ Google Maps Directions API
   └─→ 参数：optimize=true（自动优化访问顺序）
   └─→ 返回：路线（顺序、距离、时间、导航URL）
       ↓
   【步骤6】生成输出
   ├─→ 交互式HTML地图（Leafmap）
   ├─→ Google Maps导航链接
   └─→ PDF巡礼手册（Playwright）
       ↓
   返回给用户
```

---

## User Scenarios & Testing

### User Story 1 - 查询车站附近番剧 (Priority: P1) 🎯 MVP Core

**As a** 动漫爱好者
**I want to** 输入我所在的车站名称，查看附近有哪些番剧的圣地
**So that** 我可以知道周边有哪些值得去的圣地巡礼目标

**Why this priority**: 这是整个功能的入口，必须首先实现。没有这个，后续所有功能都无法进行。

**Independent Test**:
- 输入"新宿站"，系统返回附近番剧列表（如《你的名字》、《天气之子》）
- 验证番剧包含：名称、封面图、圣地数量、距离信息
- 可以独立运行和测试，不依赖后续步骤

**Acceptance Scenarios**:

1. **Given** 用户输入有效的车站名称"新宿站"
   **When** 系统处理请求
   **Then** 系统返回附近5km内的番剧列表，按距离排序

2. **Given** 用户输入无效的车站名称"abcdefg"
   **When** 系统处理请求
   **Then** 系统提示"无法识别该车站，请重新输入"

3. **Given** 用户输入的车站名称"富士山站"周边无番剧
   **When** 系统处理请求
   **Then** 系统提示"该区域暂无圣地数据，建议扩大搜索范围"

**Technical Details**:
- Input: `station_name: str` (如"新宿站")
- Output: `List[Bangumi]`
  ```python
  Bangumi {
    id: str
    title: str  # 原始名称
    cn_title: str  # 中文名称
    cover_url: str
    points_count: int
    distance_km: float  # 距离车站的距离
  }
  ```

---

### User Story 2 - 用户选择已观看的番剧 (Priority: P2) 🎯 MVP Core

**As a** 动漫爱好者
**I want to** 从番剧列表中选择我看过的番剧
**So that** 系统只显示我感兴趣的圣地，避免信息过载

**Why this priority**: 这是个性化的关键步骤，提升用户体验。如果跳过这一步，用户会看到大量不相关的圣地。

**Independent Test**:
- 展示番剧列表，用户勾选2-3部
- 系统记录用户选择，返回选中的番剧ID列表
- 即使不继续后续步骤，这个交互本身也是完整的

**Acceptance Scenarios**:

1. **Given** 系统展示了10部番剧
   **When** 用户选择其中3部
   **Then** 系统返回选中的3个番剧ID

2. **Given** 系统展示了番剧列表
   **When** 用户未选择任何番剧
   **Then** 系统提示"请至少选择一部番剧"

3. **Given** 系统展示了番剧列表
   **When** 用户选择全部番剧
   **Then** 系统接受选择并继续（但警告：圣地数量可能较多）

**Technical Details**:
- Input: `List[Bangumi]` (从US1获得)
- User Interaction: Multi-select UI
- Output: `selected_bangumi_ids: List[str]`

---

### User Story 3 - 获取附近圣地点位 (Priority: P3) 🎯 MVP Core

**As a** 动漫爱好者
**I want to** 系统获取我选中番剧的附近圣地详细信息
**So that** 我可以看到每个圣地的名称、位置、对应场景等详情

**Why this priority**: 这是数据准备的核心步骤，为后续路线规划提供输入。

**Independent Test**:
- 给定番剧ID列表和车站坐标
- 系统调用Anitabi API获取圣地详情
- 筛选出搜索半径内的圣地
- 返回包含坐标、截图、集数信息的圣地列表

**Acceptance Scenarios**:

1. **Given** 用户选择了《你的名字》和《天气之子》
   **When** 系统查询这2部番剧在新宿站5km内的圣地
   **Then** 系统返回所有符合条件的圣地点位列表

2. **Given** 用户选择的番剧在该区域没有圣地
   **When** 系统查询
   **Then** 系统返回空列表并提示"选中的番剧在该区域没有圣地"

3. **Given** 用户选择的番剧有50+个圣地
   **When** 系统查询
   **Then** 系统警告"圣地数量较多(50+)，建议筛选或分多天完成"

**Technical Details**:
- Input:
  - `selected_bangumi_ids: List[str]`
  - `station_coords: (lat, lon)`
  - `search_radius_km: float = 5.0`
- Output: `List[Point]`
  ```python
  Point {
    id: str
    name: str
    cn_name: str
    coordinates: (lat, lon)
    bangumi_id: str
    bangumi_title: str
    episode: int
    time_seconds: int
    screenshot_url: str
    address: str (optional)
  }
  ```

---

### User Story 4 - 生成最优巡礼路线 (Priority: P4) 🎯 MVP Core

**As a** 动漫爱好者
**I want to** 系统自动计算访问所有圣地的最优路线
**So that** 我可以高效地完成巡礼，不走回头路

**Why this priority**: 这是核心价值所在——路线优化。没有这个，用户只能手动规划。

**Independent Test**:
- 给定起点坐标和圣地列表
- 调用Google Maps Directions API（optimize=true）
- 返回优化后的访问顺序、总距离、总时间、Google Maps导航URL
- 可以通过打开导航URL验证路线的正确性

**Acceptance Scenarios**:

1. **Given** 车站起点和10个圣地点位
   **When** 系统计算最优路线
   **Then** 返回优化后的访问顺序、总距离、预计时间

2. **Given** 车站起点和1个圣地
   **When** 系统计算路线
   **Then** 返回简单的两点路线（起点→圣地）

3. **Given** 某些圣地之间无法通过公共交通到达
   **When** 系统计算路线
   **Then** 系统仍然返回路线，但标注"需自行规划部分路段"

**Technical Details**:
- Input:
  - `origin: (lat, lon)` (车站坐标)
  - `points: List[Point]`
- API: Google Maps Directions API
  - `mode=transit` (公共交通优先)
  - `optimize=true` (自动优化顺序)
- Output: `Route`
  ```python
  Route {
    origin: Station
    waypoints: List[Point]  # 优化后的顺序
    total_distance_km: float
    total_duration_minutes: int
    google_maps_url: str  # 导航链接
  }
  ```

---

### User Story 5 - 生成交互式地图 (Priority: P5)

**As a** 动漫爱好者
**I want to** 在交互式地图上查看路线和圣地位置
**So that** 我可以直观地了解巡礼路线，点击查看详情

**Why this priority**: 可视化增强用户体验，但不是核心功能。即使没有地图，文本路线也能工作。

**Independent Test**:
- 给定路线数据
- 生成HTML地图文件
- 打开HTML文件，验证：起点标记、圣地标记、路线折线、点击弹窗功能

**Acceptance Scenarios**:

1. **Given** 已生成的路线数据
   **When** 系统生成地图
   **Then** 输出HTML文件，包含所有标记、路线和交互功能

2. **Given** 多个番剧的圣地
   **When** 系统生成地图
   **Then** 不同番剧的圣地用不同颜色标记

3. **Given** 某个圣地的截图URL失效
   **When** 用户点击该标记
   **Then** 弹窗显示文本信息，截图位置显示占位符

**Technical Details**:
- Input: `Route` (从US4获得)
- Library: Leafmap with ipyleaflet backend
- Output: `map.html` (交互式地图文件)
- Features:
  - 起点标记（蓝色）
  - 圣地标记（按番剧分色）
  - 路线折线（带方向箭头）
  - 点击弹窗（名称、番剧、截图缩略图）

---

### User Story 6 - 导出PDF巡礼手册 (Priority: P6)

**As a** 动漫爱好者
**I want to** 下载可打印的PDF巡礼手册
**So that** 我可以打印出来随身携带，不依赖手机电量

**Why this priority**: 这是附加价值，提升用户体验，但不影响核心功能。

**Independent Test**:
- 给定路线数据和地图截图
- 生成PDF文件
- 打开PDF，验证：封面、路线总览、圣地详情页、地图

**Acceptance Scenarios**:

1. **Given** 已生成的路线数据和地图
   **When** 系统生成PDF
   **Then** 输出包含封面、地图、详情页的PDF文件（<5MB）

2. **Given** PDF包含大量高清截图
   **When** 文件大小超过10MB
   **Then** 系统自动压缩图片至5MB以内

3. **Given** 某些圣地缺少截图
   **When** 系统生成PDF
   **Then** 该页面显示占位符或跳过截图部分

**Technical Details**:
- Input: `Route` + `map_screenshot.png`
- Library: Playwright + Jinja2
- Template: `templates/pilgrimage_guide.html`
- Output: `pilgrimage_guide.pdf`
- PDF Structure:
  - 封面页：番剧封面、日期、起点
  - 路线总览页：地图截图、基本信息
  - 圣地详情页：每个圣地一页
  - 附录页：注意事项

---

## Edge Cases & Error Handling

### Input Validation
- **Invalid station name**: 提示用户重新输入，提供常见车站建议
- **Empty station name**: 提示"请输入车站名称"
- **Special characters**: 清理输入，仅保留中文、日文、英文字母

### API Failures
- **Anitabi API timeout**: 重试3次，失败后提示"服务暂时不可用，请稍后再试"
- **Google Maps API quota exceeded**: 降级：仅显示直线距离，不提供导航
- **Network error**: 显示友好错误信息，保存已搜索数据供重试

### Data Issues
- **No bangumi found**: 提示"该区域暂无圣地数据，建议扩大搜索范围或更换车站"
- **User selects zero bangumi**: 提示"请至少选择一部番剧"
- **Too many points (>50)**: 警告"圣地数量较多，建议筛选或分多天完成"

### Output Generation
- **Image loading failure**: 使用占位符或纯文本信息
- **PDF generation timeout**: 提供简化版PDF（仅文本，无图片）
- **Map rendering error**: 降级：提供Google Maps链接作为替代

---

## Requirements

### Functional Requirements

- **FR-001**: 系统必须能够将车站名称转换为GPS坐标（地理编码）
- **FR-002**: 系统必须能够搜索指定坐标周边5km内的所有番剧
- **FR-003**: 系统必须展示番剧列表供用户多选
- **FR-004**: 系统必须能够获取选中番剧的圣地详细信息
- **FR-005**: 系统必须筛选出搜索半径内的圣地点位
- **FR-006**: 系统必须调用Google Maps API生成最优路线
- **FR-007**: 系统必须生成交互式HTML地图
- **FR-008**: 系统必须生成可打印的PDF手册
- **FR-009**: 系统必须提供Google Maps导航链接

### Non-Functional Requirements

- **NFR-001**: 单次查询响应时间 < 30秒（含API调用）
- **NFR-002**: PDF文件大小 < 5MB（50个圣地以内）
- **NFR-003**: 支持中文和日文输入
- **NFR-004**: 地图必须在现代浏览器中正常显示（Chrome, Firefox, Safari）
- **NFR-005**: API调用失败时必须有3次重试机制
- **NFR-006**: 所有错误必须记录日志（Observability要求）

### Key Entities

- **Station**: 车站（名称、GPS坐标、城市）
- **Bangumi**: 番剧（ID、名称、封面、圣地数量、距离）
- **Point**: 圣地点位（名称、坐标、番剧、截图、集数）
- **Route**: 路线（起点、圣地列表、总距离、总时间、导航URL）

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 用户能在5分钟内完成从输入车站到获得路线的完整流程
- **SC-002**: 系统能处理10-30个圣地的路线规划，响应时间 < 30秒
- **SC-003**: 生成的PDF文件清晰可读，可在A4纸上打印
- **SC-004**: 交互式地图中所有标记和弹窗功能正常工作
- **SC-005**: 90%的有效车站输入能返回至少1部番剧
- **SC-006**: API失败时，用户能收到清晰的错误提示

### User Satisfaction

- **SC-007**: 用户无需手动搜索和规划，系统自动完成
- **SC-008**: 用户能通过地图直观了解路线
- **SC-009**: 用户能通过PDF随身携带巡礼指南

### Technical Success

- **SC-010**: 满足ADK Capstone至少3个关键概念要求：
  - ✅ Multi-agent System (5个Agent)
  - ✅ Custom Tools (MapGenerator, PDFGenerator)
  - ✅ OpenAPI Tools (Google Maps APIs, Anitabi API)
  - ✅ Sessions & Memory (会话状态管理)
  - ✅ Observability (日志和追踪)
- **SC-011**: 成功部署到Google Agent Engine或Cloud Run（Bonus +5分）
- **SC-012**: 提交完整的Demo视频和Writeup

---

## Dependencies & Constraints

### External Dependencies
- **Anitabi API**: 免费、无需认证（可靠性：高）
- **Google Maps APIs**: 需要API密钥和配额（Geocoding + Directions）
- **Gemini API**: ADK框架默认LLM（用于Agent推理）

### Technical Constraints
- **Python 3.10+**: ADK SDK要求
- **Deadline**: 2025年12月1日前提交
- **Deployment**: 云端部署为可选（但有Bonus分）

### Resource Constraints
- **开发时间**: 17-23小时（建议分8-10天完成）
- **单人开发**: 无团队协作
- **API配额**: Google Maps API有免费额度限制

---

## Glossary

- **圣地巡礼 (Anime Pilgrimage)**: 动漫爱好者前往动画作品的真实取景地参观
- **番剧 (Bangumi)**: 动画作品
- **圣地 (Point)**: 动画作品中出现的真实地点
- **ADK**: Agent Development Kit（Google的Agent开发框架）
- **MVP**: Minimum Viable Product（最小可行产品）

---

**Version**: 1.0
**Last Updated**: 2025-11-20
**Author**: Zhenjia Zhou (作为资深BA整理)
