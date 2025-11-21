# Seichijunrei Bot - Technical Specification

## 项目概述

**项目名称**: Seichijunrei Bot (圣地巡礼机器人)
**项目类型**: Concierge Agent (个人旅行助手)
**目标用户**: 动漫爱好者、圣地巡礼旅行者
**截止日期**: 2025年12月1日

### 问题陈述

动漫圣地巡礼是一种新兴的旅行方式，爱好者希望探访动画作品中的真实取景地。然而，当前存在以下痛点：

1. **信息分散**: 圣地信息散落在各个网站和社区，难以系统性获取
2. **路线规划困难**: 多个圣地之间如何高效访问，避免走回头路
3. **交通信息缺失**: 不清楚使用何种交通方式最优
4. **时效性差**: 天气、营业时间等实时信息难以获取

### 解决方案

构建一个智能多Agent系统，通过以下方式解决上述问题：

- 基于地理位置自动搜索周边动漫圣地
- 智能过滤用户已观看的作品
- 生成最优不走回头路的访问路线
- 提供详细的交通方式建议
- 查询实时天气和营业时间
- 导出可打印的巡礼手册PDF和可视化地图

---

## 功能需求

### 核心功能 (MVP)

#### F1. 地理位置搜索
- **输入**: 地铁站名称（例: "新宿站"、"涉谷站"、"秋叶原站"）
- **处理**:
  - 将地铁站名称转换为GPS坐标
  - 搜索该坐标周边指定范围内（例如5km）的所有动漫圣地
  - 按距离排序番剧列表
- **输出**: 周边番剧列表，包含：
  - 番剧名称（中文/原名）
  - 封面图片
  - 圣地数量
  - 距离地铁站的直线距离

#### F2. 用户偏好过滤
- **输入**: 用户选择已观看的番剧（多选）
- **处理**:
  - 展示番剧列表供用户选择
  - 过滤掉未观看的番剧对应的圣地
- **输出**: 用户感兴趣的圣地点位列表

#### F3. 路线规划
- **算法**: 贪心最近邻算法
  - 从起点（地铁站）出发
  - 每次选择距当前位置最近的未访问圣地
  - 直到所有圣地访问完毕
- **输出**: 有序的访问路线，包含每个圣地的：
  - 序号（第1站、第2站...）
  - 圣地名称（中文/日文）
  - 所属番剧
  - 对应场景（第X集 XX:XX）
  - GPS坐标
  - 动画场景截图

### 扩展功能

#### F4. 交通方式建议
- **数据源**: Google Maps Directions API
- **处理**:
  - 为路线中每两个相邻圣地计算最优交通方式
  - 考虑步行、地铁、公交三种方式
  - 选择时间最短或综合成本最低的方案
- **输出**: 每段路线的：
  - 推荐交通方式
  - 预计时间
  - 距离
  - 步行时具体路线指引

#### F5. 天气查询
- **数据源**: 天气API或Google Search
- **处理**: 查询巡礼当天的天气预报
- **输出**:
  - 温度范围
  - 降水概率
  - 出行建议（是否适合户外巡礼）

#### F6. 营业时间查询
- **数据源**: Google Places API 或 Web Search
- **处理**:
  - 查询圣地附近商业设施的营业时间
  - 优化访问顺序（避开闭店时间）
- **输出**: 每个圣地的建议访问时段

#### F7. 地图可视化
- **输出格式**: HTML交互式地图
- **内容**:
  - 地铁站起点标记
  - 所有圣地的标记点（不同颜色区分番剧）
  - 连接路线的折线
  - 点击标记显示详细信息（番剧名、场景截图）
- **可选**: 导出Google Maps导航链接

#### F8. PDF手册生成
- **输出格式**: 可打印的PDF文档
- **内容**:
  - 封面（巡礼日期、地点、包含的番剧）
  - 路线总览（地图缩略图）
  - 每个圣地的详细页：
    - 序号和名称
    - 所属番剧和集数
    - 动画场景截图
    - GPS坐标
    - 从上一站的交通方式和时间
  - 附录：天气信息、注意事项

---

## Multi-Agent架构设计

### Agent职责划分

```
┌─────────────────────────────────────┐
│   Orchestrator Agent (主控Agent)      │
│   - 管理整体流程                       │
│   - 协调各子Agent                      │
│   - 维护会话状态                       │
└──────────┬──────────────────────────┘
           │
           ├──→ [并行] SearchAgent
           │          - 搜索周边番剧
           │          - 调用Anitabi API
           │
           ├──→ [并行] WeatherAgent
           │          - 查询天气信息
           │
           ├──→ FilterAgent
           │          - 询问用户偏好
           │          - 过滤番剧列表
           │
           ├──→ RouteAgent
           │          - 计算最优路线
           │          - 执行最近邻算法
           │
           ├──→ [并行] TransportAgent
           │          - 查询交通方式
           │          - 每段路线的导航信息
           │
           ├──→ [并行] POIAgent
           │          - 查询营业时间
           │          - 优化访问时段
           │
           ├──→ MapGeneratorTool
           │          - 生成可视化地图
           │
           └──→ PDFGeneratorTool
                      - 生成巡礼手册PDF
```

### Agent详细定义

#### 1. Orchestrator Agent (主控)

**职责**:
- 接收用户输入（地铁站名称）
- 编排其他Agent的执行顺序
- 管理会话状态（记住用户选择、当前位置）
- 汇总结果并呈现给用户

**输入**:
- 用户输入的地铁站名称

**输出**:
- 完整的巡礼计划（路线、地图、PDF）

**状态管理**:
- 当前地铁站GPS坐标
- 用户已选择的番剧列表
- 计算好的路线数据

#### 2. SearchAgent (搜索Agent)

**职责**:
- 将地铁站名称转换为GPS坐标
- 调用Anitabi API搜索周边番剧
- 计算每个番剧与地铁站的距离

**输入**:
- 地铁站名称
- 搜索半径（默认5km）

**输出**:
```json
{
  "station": {
    "name": "新宿站",
    "coordinates": [35.6896, 139.7006]
  },
  "bangumi_list": [
    {
      "id": "115908",
      "title": "你的名字",
      "cn_title": "你的名字",
      "cover_url": "https://...",
      "distance_km": 1.2,
      "points_count": 15,
      "points": [
        {
          "id": "point_001",
          "name": "新宿御苑",
          "cn_name": "新宿御苑",
          "coordinates": [35.6851, 139.7100],
          "episode": 12,
          "time_seconds": 345,
          "screenshot_url": "https://..."
        }
      ]
    }
  ]
}
```

**依赖API**:
- Anitabi API: `/bangumi/{id}/lite` 和 `/bangumi/{id}/points/detail`
- 地理编码服务（地铁站名→GPS坐标）

#### 3. FilterAgent (过滤Agent)

**职责**:
- 向用户展示番剧列表
- 收集用户已观看的番剧
- 过滤圣地列表

**输入**:
- SearchAgent输出的番剧列表

**输出**:
```json
{
  "selected_bangumi_ids": ["115908", "126461"],
  "filtered_points": [
    // 仅包含用户已观看番剧的圣地
  ]
}
```

**交互方式**:
- 多选对话框或列表界面
- 显示番剧封面和名称
- 用户可勾选已观看的番剧

#### 4. RouteAgent (路线规划Agent)

**职责**:
- 使用贪心最近邻算法计算最优访问顺序
- 确保不走回头路

**输入**:
- 起点坐标（地铁站）
- 圣地列表（含GPS坐标）

**算法**:
```
1. current_location = 起点坐标
2. unvisited = 所有圣地
3. route = []
4. while unvisited 不为空:
     nearest = 找到距离current_location最近的圣地
     route.append(nearest)
     unvisited.remove(nearest)
     current_location = nearest的坐标
5. return route
```

**输出**:
```json
{
  "route": [
    {
      "order": 1,
      "point": {/* 圣地详情 */},
      "distance_from_previous": 1200,  // 单位:米
      "cumulative_distance": 1200
    },
    {
      "order": 2,
      "point": {/* 圣地详情 */},
      "distance_from_previous": 800,
      "cumulative_distance": 2000
    }
  ],
  "total_distance_km": 5.8,
  "estimated_time_minutes": 120
}
```

#### 5. TransportAgent (交通Agent)

**职责**:
- 为路线中每两个相邻点查询最优交通方式
- 提供详细的导航指引

**输入**:
- RouteAgent输出的有序路线

**输出**:
```json
{
  "route_with_transport": [
    {
      "order": 1,
      "from": "新宿站",
      "to": "新宿御苑",
      "transport": {
        "mode": "walk",  // walk / subway / bus
        "duration_minutes": 15,
        "distance_meters": 1200,
        "instructions": "步行约15分钟，沿甲州街道向南..."
      }
    },
    {
      "order": 2,
      "from": "新宿御苑",
      "to": "代代木公园",
      "transport": {
        "mode": "subway",
        "duration_minutes": 12,
        "line": "东京地铁丸之内线",
        "stops": 3,
        "fare_yen": 200,
        "instructions": "乘坐丸之内线（池袋方向），3站后在新宿三丁目下车"
      }
    }
  ]
}
```

**依赖API**:
- Google Maps Directions API

#### 6. WeatherAgent (天气Agent)

**职责**:
- 查询当天或未来天气预报
- 提供出行建议

**输入**:
- 巡礼日期（默认今天）
- 地点（地铁站所在城市）

**输出**:
```json
{
  "date": "2025-11-20",
  "location": "东京新宿",
  "weather": {
    "condition": "晴天",
    "temperature_high": 18,
    "temperature_low": 12,
    "precipitation_chance": 10,
    "wind_speed_kmh": 15
  },
  "recommendation": "天气适宜，建议穿着舒适，携带轻便外套"
}
```

**依赖API**:
- Google Search 或 天气API

#### 7. POIAgent (景点信息Agent)

**职责**:
- 查询圣地的营业时间、门票等信息
- 标注需要预约或有特殊开放时间的地点

**输入**:
- 圣地列表

**输出**:
```json
{
  "points_info": [
    {
      "point_id": "point_001",
      "name": "新宿御苑",
      "opening_hours": "9:00-16:30",
      "closed_days": ["周一"],
      "admission_fee": "500日元",
      "notes": "最后入园时间16:00，需购票"
    }
  ]
}
```

**依赖API**:
- Google Places API 或 Web Search

### 自定义工具 (Custom Tools)

#### Tool 1: MapGeneratorTool

**功能**: 生成包含路线的交互式地图

**输入**:
- 起点坐标
- 圣地列表（含坐标）
- 路线顺序

**输出**:
- HTML文件（包含交互式地图）
- 可选：Google Maps链接

**地图元素**:
- 地铁站起点标记（蓝色图标）
- 圣地标记（不同番剧用不同颜色）
- 路线折线（带箭头表示方向）
- 点击标记显示Popup：
  - 圣地名称
  - 所属番剧
  - 动画场景截图缩略图
  - 对应集数和时间

**技术实现**:
- **库选择**: Leafmap with ipyleaflet backend
- **核心API**:
  - `m = leafmap.Map(center=[lat, lon], zoom=13)` - 创建地图实例
  - `m.add_marker(location, popup, icon)` - 添加标记点
  - `m.add_polyline(locations, color, weight)` - 添加路线折线
  - `m.add_basemap()` - 支持多种底图切换（OpenStreetMap, Stamen Terrain等）
- **交互功能**:
  - 内置缩放、平移控件
  - 图层切换控件（可按番剧显示/隐藏圣地）
  - 绘图工具（用户可标注自己的兴趣点）
- **导出选项**:
  - `m.to_html('map.html')` - 导出HTML文件
  - 如性能需要，可切换到 folium backend（API几乎完全兼容）

#### Tool 2: PDFGeneratorTool

**功能**: 生成可打印的巡礼手册PDF

**输入**:
- 路线数据
- 交通信息
- 天气信息
- 地图图片

**输出**:
- PDF文件

**PDF结构**:
1. 封面页
   - 标题："XXX圣地巡礼手册"
   - 日期
   - 起点地铁站
   - 包含番剧名称和封面
2. 路线总览页
   - 地图缩略图
   - 基本信息（总距离、预计时间、圣地数量）
   - 天气信息
3. 详细页（每个圣地一页或半页）
   - 序号和名称
   - 所属番剧
   - 动画场景截图
   - GPS坐标
   - 从上一站的交通方式
   - 营业时间和门票信息
4. 附录
   - 紧急联系方式
   - 注意事项
   - 完整地图

---

## 数据模型

### 实体定义

#### Station (地铁站)
```json
{
  "name": "新宿站",
  "coordinates": {
    "latitude": 35.6896,
    "longitude": 139.7006
  },
  "city": "东京",
  "prefecture": "东京都"
}
```

#### Bangumi (番剧)
```json
{
  "id": "115908",
  "title": "君の名は。",
  "cn_title": "你的名字",
  "cover_url": "https://image.anitabi.cn/...",
  "primary_color": "#FF6B9D",
  "city": "东京",
  "points_count": 15
}
```

#### Point (圣地)
```json
{
  "id": "point_001",
  "name": "新宿御苑",
  "cn_name": "新宿御苑",
  "coordinates": {
    "latitude": 35.6851,
    "longitude": 139.7100
  },
  "bangumi_id": "115908",
  "episode": 12,
  "time_seconds": 345,
  "screenshot_url": "https://image.anitabi.cn/...",
  "address": "东京都新宿区内藤町11",
  "opening_hours": "9:00-16:30",
  "admission_fee": "500日元"
}
```

#### Route (路线)
```json
{
  "start_location": {/* Station */},
  "date": "2025-11-20",
  "segments": [
    {
      "order": 1,
      "from": {/* Station or Point */},
      "to": {/* Point */},
      "distance_meters": 1200,
      "transport": {
        "mode": "walk",
        "duration_minutes": 15,
        "instructions": "..."
      }
    }
  ],
  "total_distance_km": 5.8,
  "estimated_duration_minutes": 180,
  "weather": {/* Weather */}
}
```

---

## 用户交互流程

### 完整流程图

```
[用户输入] 我在新宿站
    ↓
[SearchAgent] 搜索新宿周边5km的番剧
    ↓
[展示结果] 找到20部番剧，共150个圣地
    ↓
[FilterAgent] 请选择你看过的番剧
    - [ ] 你的名字 (15个圣地)
    - [x] 天气之子 (12个圣地)
    - [ ] 言叶之庭 (8个圣地)
    - [x] 秒速5厘米 (10个圣地)
    ...
    ↓
[确认] 你选择了5部番剧，共45个圣地
    ↓
[RouteAgent] 计算最优路线...
    ↓
[并行执行]
    ├─ [TransportAgent] 查询交通方式
    ├─ [WeatherAgent] 查询天气
    └─ [POIAgent] 查询营业时间
    ↓
[汇总结果]
    - 路线：新宿站 → 圣地1 → 圣地2 → ... → 圣地45
    - 总距离：6.5km
    - 预计时间：3小时30分钟
    - 天气：晴天，18°C
    ↓
[生成输出]
    ├─ [MapGeneratorTool] 生成HTML地图
    └─ [PDFGeneratorTool] 生成PDF手册
    ↓
[展示给用户]
    - 查看交互式地图：map.html
    - 下载巡礼手册：pilgrimage_guide.pdf
    - Google Maps导航：https://maps.google.com/...
```

---

## API集成需求

### 1. Anitabi API

**Base URL**: `https://api.anitabi.cn/`

**端点1**: 获取番剧基础信息
- `GET /bangumi/{subjectID}/lite`
- 返回：番剧信息 + 最多10个圣地

**端点2**: 获取完整圣地列表
- `GET /bangumi/{subjectID}/points/detail?haveImage=true`
- 返回：所有圣地详细信息

**图片URL处理**:
- 缩略图：`?plan=h160`
- 中等清晰度：`?plan=h360`
- 原图：去掉query参数

### 2. 地图服务API

**需求**:
- 地理编码：地铁站名称 → GPS坐标
- 路线规划：两点间最优交通方式（步行/公交/地铁）
- 地图展示：在地图上标记点位和路线

**建议服务**: Google Maps Platform
- Geocoding API
- Directions API
- Maps JavaScript API / Static Maps API

### 3. 天气服务API

**需求**:
- 查询指定日期和地点的天气预报
- 返回：温度、降水、风速

**建议服务**:
- Google Search API (通过搜索获取天气)
- OpenWeatherMap API
- 其他天气API

### 4. 景点信息API

**需求**:
- 查询指定地点的营业时间
- 查询门票价格
- 查询是否需要预约

**建议服务**:
- Google Places API
- Web Search (通过搜索获取)

---

## 错误处理和边界情况

### 错误场景

1. **用户输入无效地铁站名称**
   - 处理：提示用户重新输入，提供附近地铁站建议

2. **搜索不到任何番剧**
   - 处理：提示该区域暂无圣地数据，建议扩大搜索范围

3. **用户未选择任何番剧**
   - 处理：提示至少选择一部番剧

4. **API调用失败**
   - 处理：重试3次，失败后降级处理（使用缓存或提示用户稍后再试）

5. **圣地数量过多（>50个）**
   - 处理：提示用户是否按番剧或距离筛选，避免路线过长

6. **交通API返回无可用路线**
   - 处理：仅显示直线距离，标注"需自行规划"

### 边界情况

- **搜索半径**: 默认5km，可配置为1-20km
- **最大圣地数**: 建议不超过50个（一天内可完成）
- **超时处理**: 所有API调用设置10秒超时
- **并发限制**: 并行Agent不超过5个同时执行

---

## 课程要求映射

本项目满足课程的以下关键概念要求（至少3个）：

### 1. Multi-agent System ✅

**使用的Agent类型**:
- **Sequential Agents**: Orchestrator → SearchAgent → FilterAgent → RouteAgent（顺序执行）
- **Parallel Agents**: TransportAgent + WeatherAgent + POIAgent（并行执行）

**总计**: 7个Agent（1个主控 + 6个子Agent）

### 2. Tools ✅

**Custom Tools**:
- MapGeneratorTool（地图生成）
- PDFGeneratorTool（PDF生成）

**OpenAPI Tools**:
- Google Maps APIs（Geocoding, Directions, Maps）
- Google Places API
- Anitabi API（RESTful API）

**Built-in Tools**:
- Google Search（天气查询）

### 3. Sessions & Memory ✅

**Session Management**:
- 使用会话服务保存：
  - 用户当前位置（地铁站）
  - 用户选择的番剧列表
  - 计算好的路线数据

**状态持久化**:
- 会话期间保持状态，支持多轮对话
- 用户可修改选择后重新计算路线

### 4. Observability ✅

**Logging**:
- 记录每个Agent的执行开始/结束时间
- 记录API调用和响应时间
- 记录错误和警告

**Tracing**:
- 追踪完整的请求流程（从用户输入到最终输出）
- 每个Agent的输入输出日志

### 5. Agent Deployment ✅ (Bonus +5分)

**部署平台**: Google Agent Engine 或 Cloud Run

**部署内容**:
- 完整的Multi-Agent系统
- 所有API集成
- 输出文件存储（地图、PDF）

### 6. Effective Use of Gemini ✅ (Bonus +5分)

**使用场景**:
- 至少一个子Agent使用Gemini作为推理引擎
- 例如：FilterAgent使用Gemini理解用户的自然语言偏好

---

## 成功标准

### MVP (最小可行产品)

- [ ] 能够根据地铁站名称搜索周边番剧
- [ ] 能够询问用户偏好并过滤结果
- [ ] 能够生成不走回头路的访问路线
- [ ] 输出包含圣地名称、番剧、场景信息

### 完整版本

- [ ] 所有核心功能 (F1-F3) 实现
- [ ] 至少3个扩展功能 (F4-F8) 实现
- [ ] 生成交互式地图
- [ ] 生成PDF手册
- [ ] 提供交通方式建议
- [ ] Multi-agent架构完整实现
- [ ] 满足课程至少3个关键概念要求
- [ ] 部署到云端（Bonus）

### 质量标准

- [ ] 代码包含详细注释
- [ ] README文档完整
- [ ] 错误处理健全
- [ ] 日志记录完整
- [ ] 用户交互流畅

---

## 附录：技术实现清单

以下部分记录技术选型决策：

- [ ] 编程语言和版本
- [ ] Agent开发框架
- [ ] LLM模型选择
- [x] **地图可视化库**: Leafmap (latest version)
  - **包管理器**: uv (`uv add leafmap`)
  - **推荐后端**: ipyleaflet（最丰富的交互功能，支持双向Widget交互）
  - **备选后端**: folium（更简单的实现，可按需切换）
  - **核心优势**:
    - 6个绘图后端可选（ipyleaflet, folium, plotly, pydeck, kepler.gl, heremap）
    - 468个内置地理处理工具（通过WhiteboxTools）
    - 一行代码创建地图：`m = leafmap.Map()`
    - 支持大规模数据（通过Google Earth Engine集成）
  - **技术理由**: 最大化灵活性，如某个后端性能不佳可无缝切换；内置GIS工具便于未来添加高级功能（地形分析、路线计算等）
- [ ] PDF生成库
- [ ] 部署平台和配置
- [ ] 依赖包列表
- [ ] 环境配置说明

---

**文档版本**: 1.0
**创建日期**: 2025-11-20
**最后更新**: 2025-11-20
**作者**: Zhenjia Zhou
