# Frontend Redesign Journey

Seichijunrei 聖地巡礼 — 从 mockup 到真实代码的完整历程

## 背景

一个动漫巡礼搜索和路线规划 app，后端 ReAct agent 已经 deployed。前端需要从 "能用" 升级到 "好用且好看"。

用户画像：动漫 fan，在家用桌面端规划行程 + 在车站用手机查圣地。

---

## Phase 1: 设计探索（HTML Mockup）

### 目标
确定视觉方向、交互模式、信息架构。不写 React 代码。

### 使用的 Skills
| Skill | 用途 |
|-------|------|
| `/impeccable teach` | 建立设计上下文：用户、品牌人格、美学方向、设计原则 |
| `/design-consultation` | 创建 DESIGN.md：色板、字体、间距、组件规范 |
| `/shape` | Feature 设计 brief：chat access pattern 的 UX 设计 |
| `/design-shotgun` | 多方案对比：4 个 chat toolbar variant、6 个 nearby/clarify variant |

### 产出
- **DESIGN.md** — 完整设计系统文档（颜色、字体、间距、组件、动效、反模式）
- **.impeccable.md** — 设计上下文（用户、品牌、美学方向、技术约束）
- **docs/mockups/demo/** — 8 个独立 HTML 页面（shared.css 共享样式）
  - 01-welcome.html — 欢迎页
  - 02-chatting.html — 聊天中
  - 03-results.html — 搜索结果
  - 04-map.html — 地图视图
  - 05-confirm.html — 确认排序
  - 06-route.html — 路线时间线
  - 07-nearby.html — 附近探索
  - 08-clarify.html — 消歧义
- **chat-in-toolbar.html** — Chat 访问模式初版
- **chat-toolbar-variants.html** — 4 方案对比板
- **nearby-clarify-variants.html** — 6 方案对比板
- **nearby-clarify-journeys.html** — 3 条 user journey 流程图

### 关键决策
1. **美学方向**：editorial/cinematic "巡礼规划工作室"，不是 AI chat assistant
2. **色板**：京吹夏季 OKLCH 双 accent（品牌朱红 + 交互蓝）
3. **字体**：Shippori Mincho B1 (display) + Noto Sans SC/Outfit (body)
4. **布局**：always-collapsed 60px sidebar + adaptive content area
5. **Chat 模式**：可拖动浮动面板（不是 inline toolbar input、不是 side panel）
6. **Nearby 流程**：chat-first（先选动漫再看地图，不是直接 dump 所有圣地）

---

## Phase 2: Live Demo（交互式 HTML）

### 目标
验证交互逻辑，让用户能"点一下试试"。

### 方法
在 HTML mockup 基础上加 JavaScript 交互：
- Tab 切换（按集数/按地区、Grid/Map）
- 卡片选择（点击 toggle + checkmark）
- 选择栏显示/隐藏
- 步调切换（悠闲/正常/紧凑）
- 页面间跳转

### 问题
HTML demo 无论怎么做都不像真实产品。点击反馈、数据流、状态管理都是假的。
用户反馈："我老感觉你的这个 live demo 做的有些问题"。

### 关键决策
**放弃 HTML demo，直接改真实前端代码 + mock 数据。**

> "能不能造 mock 数据，然后直接改对应的前端代码然后来看呢"

---

## Phase 3: Mock 数据层

### 目标
在不启动后端的情况下，用真实 React 组件 + mock 数据看效果。

### 使用的 Skills
无（纯工程实现）

### 实现
- **MSW (Mock Service Worker)** — 拦截 `/v1/runtime/stream` API 请求
- **mock-data.ts** — 5 个 RuntimeResponse（search, route, clarify, nearby, greet）
- **handlers.ts** — 关键词路由（涼宮 → clarify, 附近 → nearby, 路线 → route）
- **SSE 模拟** — step(running) → step(done) → done 事件流

### 关键决策
选 MSW 而不是 mock hook，因为：
1. 网络层拦截，对组件完全透明
2. 支持 SSE streaming 模拟
3. 切换真实后端只需关闭 MOCK_MODE

---

## Phase 4: 逐 Wave 实现

### 方法论

```
Planner → 拆卡 → 每个 Wave 实现 → 截图验证 → 用户反馈 → 迭代
```

每个 Wave 完成后必须给用户看，等反馈后再继续下一个。

### 使用的 Skills
| Skill | 用途 | 用在哪个 Wave |
|-------|------|-------------|
| `/impeccable craft` | 按 design brief 实现生产级组件 | Wave 5 (Route) |
| `/critique` | 设计评审（LLM review + automated scan） | Wave 5, 6, 7 |
| `/design-shotgun` | 多方案视觉对比 | Wave 3 (Chat), Wave 6 (Nearby+Clarify) |
| `/shape` | Feature UX 设计 brief | Wave 3 (Chat access pattern) |
| `/layout` | 空间布局修复 | Wave 5 (Stats bar), Wave 7 (Back button) |

### Wave 详情

#### Wave 1: Foundation
- mock-data.ts + MSW handlers
- globals.css 补充 design tokens（--color-brand, --r-sm/md/lg, --color-walk-*）

#### Wave 2: Layout Shell
- AppShell 自适应布局（chat/split/full-result 三种模式）
- IconSidebar 60px（Torii logo + 4 nav icons）
- useLayoutMode hook

#### Wave 3: Chat Access（迭代最多的部分）
问题：浮动 Chat 按钮和选择栏/地图标记重合。

迭代过程：
1. FloatingChatToggle（底部右侧）→ 和选择栏重合
2. 移到左侧 → 和侧边栏重合
3. 移到右上角 → 和地图控件重合
4. **用 `/shape` 设计 brief** → "inline toolbar input" 方案
5. **用 `/design-shotgun` 画 4 个方案** → 用户看了说 "你 mockup 画的有点烂"
6. 用 agent 重画高质量对比板
7. 用户提出："要不要改成能拖动浮动的？"
8. **最终方案**：可拖动浮动面板 + 最小化 pill
   - 搜索结果页：自动展开
   - 路线页：自动最小化（pill 状态）
   - 无 backdrop，背后内容可交互

#### Wave 4: Search Results
- 按集数/按地区 tab 切换（haversine 距离推导地区）
- 4 列照片网格 + dark overlay bar
- 地图组件统一：BaseMap (Mapbox GL JS) 替代 3 个分散实现
- tile-providers.ts 集中配置
- `/dev/map-bench` 性能测试页
  - Mapbox raster: 430ms, OSM: 403ms, 高德: 2618ms
  - Mapbox GL JS: 4052ms（冷启动）
  - 优化：prewarm() + reuseMaps → 二次打开秒开
- 底部选择栏（min 2 才能规划）

#### Wave 5: Route Planning
- **RouteConfirm**：@dnd-kit 拖拽排序 + 删除 undo + 出发站
- **RoutePlannerWizard**：45/55 水平分割（地图 + 时间线）
- **RouteTimeline**：3 列结构 + walk pills + discovery card
- **用 `/impeccable craft` 实现** — 按 mockup 06-route.html 精确还原
- **用 `/critique` 评审** — 发现 10+ 问题，全部修复：
  - Stats bar 从 "数据表" → "叙事标题"
  - Walk pills 更大更饱和
  - Anime title 从 breadcrumb → hero
  - Pacing toggle 实际调整停留时间
  - Discovery card 附近推荐
  - 删除 undo toast

#### Wave 6: Nearby + Clarify
- **用 `/design-shotgun` 画 6 个方案**（3 Clarify + 3 Nearby）
- **用 journey mockup 对齐用户流程**
- 用户反馈改变了 Nearby 设计："应该是先提示有哪些动漫，然后再用户选择"
- **Clarify (C1)**：聊天气泡内竖排候选卡片（封面 + 标题 + spots + city）
- **Nearby (chat-first)**：聊天气泡内动漫选择卡片（彩色圆点 + 缩略图 + 距离）→ 选了再出地图
- **用 `/critique` 评审** — 发现 Clarify 质量远低于 Nearby：
  - 去掉横向滚动，统一竖排
  - 去掉 fallback 纯文字链接
  - 统一封面 + display font
  - 修复 `applyClarifyOverride` 丢 candidates 的 bug

#### Wave 7: Detail + Polish
- **SpotDetail**：55/45 水平分割（大图 + 信息 | 小地图 + 附近列表）
- PhotoCard hover ℹ 图标 → 打开详情
- **用 `/critique` 评审** — 修复：
  - Touch target 28px → 44px
  - 硬编码颜色 → CSS variables
  - Border radius → design tokens
  - 返回按钮移到顶部
  - Mini-map 200px → 280px

---

## Phase 5: 设计评审循环

### `/critique` Skill 流程

```
触发 → 两个独立评估并行运行：

Assessment A (LLM Design Review):
  - 读源码 + 截图
  - AI slop 检测
  - Nielsen 10 heuristics 打分
  - 认知负荷 8 项检查
  - 优先级问题 + 修复建议

Assessment B (Automated Detection):
  - 14 种反模式扫描
  - 硬编码颜色 / radius tokens / touch targets / 纯黑白
  - 和基准组件对比质量

合并报告 → 用户选方向 → 修复 → commit push
```

### 分数变化

| Page | 初始 | 修后 |
|------|------|------|
| Route Timeline | 21/40 | 27/40 → 修 narrative stats 等后未重测 |
| Nearby | 26/40 | 改善（统一卡片后） |
| Clarify | 14/40 | 改善（去掉 fallback + 统一竖排后） |
| SpotDetail | 33.5/40 | 修 touch targets + layout 后 |

---

## 技术决策记录

| 决策 | 原因 |
|------|------|
| MSW 而不是 mock hook | 网络层透明，支持 SSE，切后端无改动 |
| Mapbox GL JS 而不是 Leaflet | Vector tiles 更清晰，GPU 渲染更流畅 |
| 保留 Leaflet 作为 fallback | 无 Mapbox token 时降级到 OSM raster |
| @dnd-kit 而不是 HTML5 drag | 触屏支持、keyboard accessible、更流畅 |
| 可拖动面板而不是 inline input | 用户控制位置，不和任何元素固定重合 |
| Chat-first nearby | 先选动漫再看地图，符合用户心理模型 |
| Vertical stack 而不是 horizontal scroll | 聊天气泡内横向滚动不自然 |

---

## 文件结构（新增/大改的文件）

```
frontend/
├── mocks/
│   ├── handlers.ts          # MSW SSE handlers
│   ├── browser.ts           # MSW browser worker
│   └── MSWProvider.tsx       # Client wrapper
├── lib/
│   └── mock-data.ts         # 5 个 mock responses
├── components/
│   ├── map/
│   │   ├── BaseMap.tsx       # 统一 Mapbox GL JS 地图
│   │   ├── tile-providers.ts # 集中 tile 配置
│   │   └── prewarm.ts       # WebGL 预热
│   ├── chat/
│   │   ├── ChatPopup.tsx     # 可拖动浮动面板
│   │   ├── ClarificationBubble.tsx
│   │   └── NearbyBubbleWrapper.tsx
│   ├── generative/
│   │   ├── RouteConfirm.tsx  # 拖拽排序确认页
│   │   ├── RoutePlannerWizard.tsx  # 路线时间线（重写）
│   │   ├── RouteTimeline.tsx      # 3 列时间线（重写）
│   │   ├── Clarification.tsx      # 候选卡片（重写）
│   │   ├── NearbyBubble.tsx       # 动漫选择卡片（新）
│   │   ├── SpotDetail.tsx         # 圣地详情页（新）
│   │   └── PhotoCard.tsx          # 照片卡片（改）
│   └── layout/
│       ├── AppShell.tsx      # 自适应布局（大改）
│       ├── ResultPanel.tsx   # 搜索结果面板（大改）
│       └── ResultPanelToolbar.tsx  # 按集数/按地区 tab
├── hooks/
│   ├── useLayoutMode.ts     # chat/split/full-result 模式
│   └── useRouteSelection.ts # 路线选择 + 确认流程
└── app/
    └── dev/map-bench/page.tsx  # 地图性能测试页
```

---

## 核心设计原则回顾

来自 `.impeccable.md`：

1. **Start from user intent, not from an empty chat box.**
2. **Keep scenes, map, and route in the same working context.**
3. **Let imagery and place do narrative work before copy explains it.**
4. **Treat AI as a route copilot that modifies plans, not as the product's main screen.**
5. **Make the next action obvious on every screen.**
6. **The layout serves the content — panels appear when there is content, not before.**
7. **Every screen size gets a considered experience, not a breakpoint hack.**
