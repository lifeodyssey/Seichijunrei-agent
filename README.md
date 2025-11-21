# Seichijunrei Bot - 圣地巡礼机器人

> 智能动漫圣地巡礼旅行助手 | An Intelligent Anime Pilgrimage Travel Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Track: Concierge Agents](https://img.shields.io/badge/Track-Concierge%20Agents-blue)](https://www.kaggle.com/competitions/google-adk-capstone)

## 项目简介

Seichijunrei Bot 是一个基于多Agent架构的智能旅行助手，专为动漫爱好者的圣地巡礼之旅而设计。只需输入你所在的地铁站，机器人就能：

- 搜索周边所有动漫圣地
- 根据你看过的番剧智能过滤
- 生成不走回头路的最优访问路线
- 提供详细的交通方式建议
- 查询实时天气和营业时间
- 导出可打印的巡礼手册PDF和交互式地图

### 为什么需要这个项目？

动漫圣地巡礼（Anime Pilgrimage）是一种新兴的旅行方式，爱好者前往动画作品的真实取景地"朝圣"。然而：

- 📍 圣地信息分散在各个网站和社区，难以系统性获取
- 🗺️ 多个圣地之间的路线规划复杂，容易走回头路
- 🚇 不清楚使用哪种交通方式最优（步行？地铁？公交？）
- ⏰ 天气、营业时间等实时信息难以获取

Seichijunrei Bot 通过智能多Agent系统解决了这些痛点，让你的圣地巡礼之旅更加高效和愉快。

---

## 主要功能

### 核心功能

#### 1. 智能地理搜索
输入地铁站名称（如"新宿站"、"秋叶原站"），自动搜索周边5km范围内的所有动漫圣地。

```
输入: "我在新宿站"
输出: 找到20部番剧，共150个圣地
      - 你的名字 (15个圣地, 距离1.2km)
      - 天气之子 (12个圣地, 距离0.8km)
      - 言叶之庭 (8个圣地, 距离2.5km)
      ...
```

#### 2. 个性化过滤
询问你看过哪些番剧，只保留你感兴趣的圣地，避免信息过载。

#### 3. 路线优化
使用贪心最近邻算法，自动计算不走回头路的最优访问顺序。

```
生成路线: 新宿站 → 代代木公园 → 新宿御苑 → 都厅大厦 → ...
总距离: 6.5km
预计时间: 3小时30分钟
```

### 增强功能

#### 4. 交通方式建议
为每两个相邻圣地之间提供最优交通方式：

```
第1站 → 第2站:
  - 方式: 步行
  - 距离: 1.2km
  - 时间: 15分钟
  - 路线: 沿甲州街道向南，经过新宿三丁目...

第2站 → 第3站:
  - 方式: 地铁（东京地铁丸之内线）
  - 站数: 3站
  - 时间: 12分钟
  - 费用: 200日元
```

#### 5. 实时天气查询
查询巡礼当天的天气预报，提供出行建议。

```
天气: 晴天
温度: 12°C - 18°C
降水概率: 10%
建议: 天气适宜，建议穿着舒适，携带轻便外套
```

#### 6. 营业时间查询
查询圣地的开放时间和门票信息，优化访问顺序。

```
新宿御苑:
  - 开放时间: 9:00-16:30
  - 休息日: 周一
  - 门票: 500日元
  - 注意: 最后入园时间16:00
```

#### 7. 地图可视化
生成交互式HTML地图，标注所有圣地和路线。

- 不同颜色区分不同番剧
- 点击标记查看详细信息和动画截图
- 导出Google Maps导航链接，一键开始导航

#### 8. PDF手册导出
生成可打印的巡礼手册，包含：

- 路线总览地图
- 每个圣地的详细信息（名称、番剧、场景截图、交通方式）
- 天气和注意事项

---

## 项目架构

### Multi-Agent系统架构

```
┌─────────────────────────────────────┐
│   Orchestrator Agent (主控Agent)      │
│   - 管理整体流程                       │
│   - 协调各子Agent                      │
│   - 维护会话状态                       │
└──────────┬──────────────────────────┘
           │
           ├──→ [并行] SearchAgent          搜索周边番剧
           ├──→ [并行] WeatherAgent         查询天气信息
           │
           ├──→ FilterAgent                询问用户偏好
           │
           ├──→ RouteAgent                 计算最优路线
           │
           ├──→ [并行] TransportAgent       查询交通方式
           ├──→ [并行] POIAgent             查询营业时间
           │
           ├──→ MapGeneratorTool           生成可视化地图
           └──→ PDFGeneratorTool           生成巡礼手册PDF
```

**Agent职责**:

| Agent | 职责 | 执行方式 |
|-------|------|---------|
| Orchestrator | 主控，协调所有Agent | - |
| SearchAgent | 搜索周边番剧和圣地 | 并行 |
| WeatherAgent | 查询天气信息 | 并行 |
| FilterAgent | 询问用户偏好，过滤番剧 | 顺序 |
| RouteAgent | 计算最优路线（最近邻算法） | 顺序 |
| TransportAgent | 查询每段路线的交通方式 | 并行 |
| POIAgent | 查询圣地营业时间 | 并行 |

**自定义工具**:

| 工具 | 功能 |
|------|------|
| MapGeneratorTool | 生成交互式HTML地图 |
| PDFGeneratorTool | 生成可打印的巡礼手册PDF |

### 技术栈（待确定）

- **编程语言**: Python 3.10+
- **Agent框架**: TBD (Google ADK / LangGraph / CrewAI)
- **LLM模型**: Gemini 1.5 Pro/Flash
- **数据源**:
  - [Anitabi API](https://github.com/anitabi/anitabi.cn-document) (圣地数据)
  - Google Maps APIs (地图、导航、地理编码)
  - 天气API (待定)
- **部署平台**: Google Agent Engine / Cloud Run

---

## 使用场景

### 场景1：东京一日游

**用户**: "我明天在新宿站，想去看新海诚作品的圣地"

**系统流程**:
1. SearchAgent搜索新宿周边5km的圣地
2. 找到《你的名字》、《天气之子》、《言叶之庭》等作品的45个圣地
3. FilterAgent询问用户看过哪些，用户选择全部
4. RouteAgent计算最优路线：新宿站 → 新宿御苑 → 代代木 → 四谷 → ...
5. TransportAgent提供交通建议（步行/地铁组合）
6. WeatherAgent查询明天天气：晴天，18°C
7. 生成地图和PDF手册

**输出**:
- 一条优化的6.5km路线，预计3.5小时完成
- 交互式地图和可打印PDF手册
- Google Maps一键导航链接

### 场景2：京都动画巡礼

**用户**: "我在京都站，想去看京阿尼的作品"

**系统流程**:
1. 搜索京都周边圣地
2. 找到《冰菓》、《紫罗兰永恒花园》、《吹响吧！上低音号》等
3. 用户选择看过的番剧
4. 生成跨区域的一日或两日路线
5. 提供JR/私铁/巴士的综合交通建议

---

## 满足课程要求

本项目为 [Google ADK Capstone Project](https://www.kaggle.com/competitions/google-adk-capstone) 提交作品，选择赛道：**Concierge Agents** (个人生活助手)。

### 关键概念实现

项目满足以下至少3个关键概念要求：

| 要求 | 实现方式 | 状态 |
|------|---------|------|
| **Multi-agent System** | 7个Agent（1主控+6子Agent），包含并行和顺序执行 | ✅ |
| **Tools** | 2个Custom Tools + Google Search + Google Maps API (OpenAPI) | ✅ |
| **Sessions & Memory** | InMemorySessionService保存用户位置、选择和路线状态 | ✅ |
| **Observability** | 完整的logging和tracing系统 | ✅ |
| **Gemini** (+5分) | 使用Gemini作为推理引擎 | ✅ |
| **Agent Deployment** (+5分) | 部署到Google Agent Engine | ✅ |

### 评分预期

| 类别 | 满分 | 预期得分 | 说明 |
|------|------|---------|------|
| Category 1: The Pitch | 30 | 25-30 | 清晰的问题定义和解决方案 |
| Category 2: Implementation | 70 | 60-70 | 完整的multi-agent架构和工具集成 |
| Bonus: Gemini + Deployment | 20 | 10 | 使用Gemini和云端部署 |
| **总计** | **100** | **95-100** | - |

---

## 项目结构

```
seichijunrei-bot/
├── README.md                 # 项目说明（本文件）
├── SPEC.md                   # 详细技术规格文档
├── requirement.md            # 课程要求说明
├── .gitignore                # Git忽略配置
├── agents/                   # Agent模块目录
│   ├── orchestrator.py       # 主控Agent
│   ├── search_agent.py       # 搜索Agent
│   ├── filter_agent.py       # 过滤Agent
│   ├── route_agent.py        # 路线Agent
│   ├── transport_agent.py    # 交通Agent
│   ├── weather_agent.py      # 天气Agent
│   └── poi_agent.py          # 营业时间Agent
├── tools/                    # 自定义工具目录
│   ├── map_generator.py      # 地图生成工具
│   └── pdf_generator.py      # PDF生成工具
├── utils/                    # 工具函数目录
│   ├── anitabi_client.py     # Anitabi API客户端
│   ├── gmaps_client.py       # Google Maps客户端
│   └── geo_utils.py          # 地理计算工具
├── templates/                # 模板目录
│   └── pilgrimage_guide.html # PDF模板
├── outputs/                  # 输出目录（地图、PDF）
└── docs/                     # 文档目录
```

---

## 开发计划

### 阶段1: MVP (最小可行产品) - 预计8-10小时

- [ ] 基础Agent架构搭建
- [ ] Anitabi API集成
- [ ] 地理搜索功能
- [ ] 用户偏好过滤
- [ ] 基础路线规划（最近邻算法）
- [ ] 简单的输出展示

### 阶段2: 增强功能 - 预计8-10小时

- [ ] Google Maps集成（交通方式建议）
- [ ] 天气查询
- [ ] 营业时间查询
- [ ] 地图可视化
- [ ] PDF生成

### 阶段3: 优化和部署 - 预计3-5小时

- [ ] 错误处理完善
- [ ] Logging和Observability
- [ ] 云端部署（Google Agent Engine）
- [ ] 文档和注释完善

**总开发时间估算**: 19-25小时（建议分3-4天完成）
**截止日期**: 2025年12月1日

---

## 数据来源

本项目使用以下开放API：

- **[Anitabi](https://anitabi.cn)**: 动漫圣地数据库，提供番剧和圣地的详细信息
  - API文档: https://github.com/anitabi/anitabi.cn-document/blob/main/api.md
  - 特点: 免费、无需认证、包含场景截图

- **Google Maps Platform**: 地图、导航、地理编码服务
  - Geocoding API: 地铁站名 → GPS坐标
  - Directions API: 路线规划和交通建议
  - Maps JavaScript API: 地图可视化

- **天气服务**: 实时天气查询（API待定）

---

## 贡献指南

本项目为课程项目，暂不接受外部贡献。如有问题或建议，欢迎提Issue。

---

## 许可证

MIT License - 详见 LICENSE 文件

---

## 联系方式

- **作者**: Zhenjia Zhou
- **项目**: Google ADK Capstone Project
- **赛道**: Concierge Agents

---

## 致谢

- 感谢 [Anitabi](https://anitabi.cn) 提供的动漫圣地数据库
- 感谢 Google ADK Course 提供的学习资源
- 感谢所有动漫作品的创作者，让圣地巡礼成为可能

---

**最后更新**: 2025-11-20
