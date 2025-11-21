# PDF生成功能 - 技术选型与实现计划

## 1. 技术选型对比

### 1.1 Playwright（推荐 ⭐）

**类型**: 浏览器自动化工具，支持HTML/CSS转PDF

**优势**:
- ✅ 一个库同时解决地图生成和PDF导出
- ✅ 使用熟悉的HTML/CSS技术栈，开发效率高
- ✅ 高质量渲染，完美支持复杂CSS布局和现代Web特性
- ✅ 可以直接截取交互式地图（Leaflet、Folium等）
- ✅ 支持多种浏览器引擎（Chromium、Firefox、WebKit）
- ✅ API简洁，2-3行代码即可生成PDF

**劣势**:
- ⚠️ 需要下载浏览器二进制文件（~300MB Chromium）
- ⚠️ 依赖相对较重
- ⚠️ 首次安装需要额外步骤（`playwright install`）

**适用场景**: 需要地图、复杂布局、动态内容的PDF

**API示例**:
```python
from playwright.async_api import async_playwright

async with async_playwright() as p:
    browser = await p.chromium.launch()
    page = await browser.new_page()
    await page.goto("file://template.html")
    await page.pdf(path="output.pdf", format="A4")
    await browser.close()
```

**安装**:
```bash
pip install playwright
playwright install chromium
```

---

### 1.2 WeasyPrint（备选）

**类型**: 纯Python的HTML/CSS转PDF库

**优势**:
- ✅ 轻量级，无浏览器依赖
- ✅ 纯Python实现，跨平台兼容性好
- ✅ 打印样式（@media print）支持完善
- ✅ 依赖安装简单

**劣势**:
- ⚠️ 不能直接渲染交互式地图（需要预先生成静态图片）
- ⚠️ CSS支持有限（不支持部分CSS3特性、Flexbox/Grid有限制）
- ⚠️ 对复杂JavaScript渲染的内容无能为力
- ⚠️ 中文字体需要额外配置

**适用场景**: 静态内容为主，地图用预生成的图片代替

**API示例**:
```python
from weasyprint import HTML

HTML('template.html').write_pdf('output.pdf')
```

**安装**:
```bash
pip install weasyprint
```

---

### 1.3 ReportLab（不推荐）

**类型**: 程序化PDF生成库（Canvas模型）

**优势**:
- ✅ 对布局有绝对精确控制
- ✅ 适合数据密集型报表、复杂图表
- ✅ 功能强大，行业标准

**劣势**:
- ❌ 学习曲线陡峭，不"开箱即用"
- ❌ 需要大量代码逐元素构建布局
- ❌ 不支持HTML/CSS，必须用Python API绘制
- ❌ 开发速度慢，不适合快速迭代

**适用场景**: 复杂的财务报表、数据可视化、需要毫米级精确控制的文档

**不推荐理由**: 圣地巡礼手册主要是内容展示，不需要ReportLab的"精确控制"优势，反而会大幅增加开发复杂度。

---

### 1.4 FPDF2（简易备选）

**类型**: 简单PDF生成库（FPDF的现代版）

**优势**:
- ✅ 最简单，API直观易懂
- ✅ 快速上手，适合原型开发
- ✅ 支持Unicode和基本HTML渲染
- ✅ 依赖少，轻量级

**劣势**:
- ⚠️ 功能有限，复杂布局能力弱
- ⚠️ 需要手动处理分页、图片位置
- ⚠️ 不支持CSS样式

**适用场景**: 极简PDF需求，文本为主、图片为辅

---

## 2. 最终选择：Playwright ⭐

### 决策理由

1. **地图需求完美匹配**
   - 项目核心需求是"地图和路线图"
   - Playwright可以：
     - 用MapGeneratorTool生成HTML交互式地图
     - 直接用Playwright截图地图或转整个页面为PDF
     - 一个工作流完成地图生成→截图→嵌入PDF

2. **简单快速开发**
   - 用户明确要求"简单快速"
   - Playwright的API只需2-3行代码生成PDF
   - 使用熟悉的HTML/CSS，无需学习新的布局API

3. **高质量输出**
   - 浏览器级别的渲染质量
   - 完美支持现代CSS、Web字体、响应式布局

4. **扩展性强**
   - 未来可添加更多功能（动画、交互预览）
   - 可以生成"在线预览版"和"打印PDF版"

### 与其他方案对比

| 标准 | Playwright | WeasyPrint | ReportLab | FPDF2 |
|------|-----------|-----------|-----------|-------|
| 地图集成 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐ |
| 开发速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| 输出质量 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 学习成本 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 依赖大小 | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **总体评分** | **⭐⭐⭐⭐⭐** | **⭐⭐⭐⭐** | **⭐⭐** | **⭐⭐⭐** |

---

## 3. 实现架构

### 3.1 文件结构

```
seichijunrei-bot/
├── tools/
│   ├── map_generator.py          # MapGeneratorTool（生成交互式地图）
│   └── pdf_generator.py          # PDFGeneratorTool（生成PDF手册）
├── templates/
│   └── pilgrimage_guide.html     # PDF模板（HTML + CSS）
├── outputs/
│   ├── map.html                  # 生成的交互式地图
│   ├── map_screenshot.png        # 地图截图（嵌入PDF用）
│   └── pilgrimage_guide.pdf      # 最终PDF手册
└── utils/
    └── template_renderer.py      # Jinja2模板渲染工具
```

---

### 3.2 PDFGeneratorTool 设计

#### 输入数据结构

```python
{
  "route": {
    "start_location": {
      "name": "新宿站",
      "coordinates": {"latitude": 35.6896, "longitude": 139.7006}
    },
    "segments": [
      {
        "order": 1,
        "point": {
          "name": "新宿御苑",
          "cn_name": "新宿御苑",
          "bangumi_id": "115908",
          "bangumi_title": "你的名字",
          "episode": 12,
          "screenshot_url": "https://...",
          "coordinates": {...}
        },
        "transport": {
          "mode": "walk",
          "duration_minutes": 15,
          "distance_meters": 1200,
          "instructions": "步行约15分钟..."
        },
        "opening_hours": "9:00-16:30",
        "admission_fee": "500日元"
      },
      # ... 更多圣地
    ],
    "total_distance_km": 6.5,
    "estimated_duration_minutes": 210
  },
  "weather": {
    "date": "2025-11-20",
    "condition": "晴天",
    "temperature_high": 18,
    "temperature_low": 12,
    "recommendation": "天气适宜..."
  },
  "bangumi_list": [
    {
      "id": "115908",
      "title": "你的名字",
      "cover_url": "https://..."
    }
  ],
  "map_image_path": "outputs/map_screenshot.png"
}
```

#### 核心实现（pdf_generator.py）

```python
from playwright.async_api import async_playwright
from jinja2 import Environment, FileSystemLoader
import asyncio
from pathlib import Path

class PDFGeneratorTool:
    """生成圣地巡礼PDF手册的自定义工具"""

    def __init__(self, template_dir: str = "templates"):
        self.template_dir = template_dir
        self.env = Environment(loader=FileSystemLoader(template_dir))

    async def generate(self, data: dict, output_path: str = "outputs/pilgrimage_guide.pdf"):
        """
        生成PDF手册

        Args:
            data: 包含路线、天气、番剧等信息的字典
            output_path: 输出PDF文件路径

        Returns:
            str: 生成的PDF文件路径
        """
        # 1. 渲染HTML模板
        html_content = self._render_template(data)

        # 2. 保存临时HTML（方便调试）
        temp_html_path = "outputs/temp_guide.html"
        with open(temp_html_path, 'w', encoding='utf-8') as f:
            f.write(html_content)

        # 3. 使用Playwright生成PDF
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            # 加载HTML内容
            await page.goto(f"file://{Path(temp_html_path).absolute()}")

            # 等待图片加载完成
            await page.wait_for_load_state("networkidle")

            # 生成PDF
            await page.pdf(
                path=output_path,
                format="A4",
                print_background=True,  # 打印背景色和图片
                margin={
                    "top": "20mm",
                    "right": "15mm",
                    "bottom": "20mm",
                    "left": "15mm"
                }
            )

            await browser.close()

        print(f"✅ PDF生成成功: {output_path}")
        return output_path

    def _render_template(self, data: dict) -> str:
        """使用Jinja2渲染HTML模板"""
        template = self.env.get_template("pilgrimage_guide.html")
        return template.render(**data)


# 使用示例
async def main():
    tool = PDFGeneratorTool()

    data = {
        "route": {...},
        "weather": {...},
        "bangumi_list": [...],
        "map_image_path": "outputs/map_screenshot.png"
    }

    pdf_path = await tool.generate(data)
    print(f"PDF已生成: {pdf_path}")

if __name__ == "__main__":
    asyncio.run(main())
```

---

### 3.3 HTML模板设计（pilgrimage_guide.html）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>圣地巡礼手册</title>
    <style>
        /* === 全局样式 === */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #333;
        }

        /* === 打印样式 === */
        @media print {
            .page-break {
                page-break-after: always;
            }

            img {
                max-width: 100%;
                page-break-inside: avoid;
            }
        }

        /* === 封面页 === */
        .cover-page {
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 40px;
        }

        .cover-page h1 {
            font-size: 36pt;
            margin-bottom: 20px;
        }

        .cover-page .subtitle {
            font-size: 18pt;
            margin-bottom: 40px;
        }

        .cover-page .bangumi-covers {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            justify-content: center;
        }

        .cover-page .bangumi-covers img {
            width: 150px;
            height: 220px;
            object-fit: cover;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        }

        /* === 路线总览页 === */
        .overview-page {
            padding: 40px;
        }

        .overview-page h2 {
            font-size: 24pt;
            margin-bottom: 20px;
            color: #667eea;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }

        .map-container {
            margin: 30px 0;
            text-align: center;
        }

        .map-container img {
            max-width: 100%;
            border: 2px solid #ddd;
            border-radius: 8px;
        }

        .route-summary {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }

        .route-summary .info-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
        }

        .route-summary .info-item {
            display: flex;
            align-items: center;
        }

        .route-summary .info-item strong {
            margin-right: 10px;
            color: #667eea;
        }

        /* === 圣地详情页 === */
        .point-page {
            padding: 40px;
        }

        .point-header {
            margin-bottom: 20px;
        }

        .point-header h3 {
            font-size: 20pt;
            color: #667eea;
            margin-bottom: 5px;
        }

        .point-header .bangumi-tag {
            display: inline-block;
            background: #764ba2;
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 10pt;
        }

        .screenshot-container {
            margin: 20px 0;
            text-align: center;
        }

        .screenshot-container img {
            max-width: 100%;
            max-height: 400px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .point-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }

        .point-info .info-row {
            margin-bottom: 10px;
            display: flex;
            align-items: flex-start;
        }

        .point-info .info-row strong {
            min-width: 100px;
            color: #667eea;
        }

        .transport-box {
            background: #e3f2fd;
            padding: 15px;
            border-left: 4px solid #2196f3;
            border-radius: 4px;
            margin: 20px 0;
        }

        .transport-box h4 {
            color: #2196f3;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <!-- 封面页 -->
    <div class="cover-page page-break">
        <h1>{{ route.start_location.name }}圣地巡礼手册</h1>
        <div class="subtitle">
            📅 {{ weather.date }}<br>
            📍 起点: {{ route.start_location.name }}<br>
            🎬 {{ bangumi_list|length }} 部番剧 · {{ route.segments|length }} 个圣地
        </div>
        <div class="bangumi-covers">
            {% for bangumi in bangumi_list[:4] %}
            <img src="{{ bangumi.cover_url }}" alt="{{ bangumi.title }}">
            {% endfor %}
        </div>
    </div>

    <!-- 路线总览页 -->
    <div class="overview-page page-break">
        <h2>📍 路线总览</h2>

        <div class="map-container">
            <img src="{{ map_image_path }}" alt="路线地图">
        </div>

        <div class="route-summary">
            <h3>基本信息</h3>
            <div class="info-grid">
                <div class="info-item">
                    <strong>总距离:</strong>
                    <span>{{ route.total_distance_km }} km</span>
                </div>
                <div class="info-item">
                    <strong>预计时间:</strong>
                    <span>{{ (route.estimated_duration_minutes / 60) | round(1) }} 小时</span>
                </div>
                <div class="info-item">
                    <strong>圣地数量:</strong>
                    <span>{{ route.segments|length }} 个</span>
                </div>
                <div class="info-item">
                    <strong>天气:</strong>
                    <span>{{ weather.condition }} {{ weather.temperature_low }}°C-{{ weather.temperature_high }}°C</span>
                </div>
            </div>
        </div>

        <div class="route-summary">
            <h3>☀️ 天气建议</h3>
            <p>{{ weather.recommendation }}</p>
        </div>
    </div>

    <!-- 圣地详情页（每个圣地一页） -->
    {% for segment in route.segments %}
    <div class="point-page page-break">
        <div class="point-header">
            <h3>第{{ segment.order }}站: {{ segment.point.cn_name or segment.point.name }}</h3>
            <span class="bangumi-tag">{{ segment.point.bangumi_title }}</span>
        </div>

        <!-- 场景截图 -->
        {% if segment.point.screenshot_url %}
        <div class="screenshot-container">
            <img src="{{ segment.point.screenshot_url }}" alt="场景截图">
            <p style="color: #999; font-size: 10pt; margin-top: 5px;">
                第{{ segment.point.episode }}集 {{ segment.point.time_seconds // 60 }}:{{ '%02d' % (segment.point.time_seconds % 60) }}
            </p>
        </div>
        {% endif %}

        <!-- 圣地信息 -->
        <div class="point-info">
            <div class="info-row">
                <strong>地址:</strong>
                <span>{{ segment.point.address or '详见地图' }}</span>
            </div>
            <div class="info-row">
                <strong>坐标:</strong>
                <span>{{ segment.point.coordinates.latitude }}, {{ segment.point.coordinates.longitude }}</span>
            </div>
            {% if segment.opening_hours %}
            <div class="info-row">
                <strong>开放时间:</strong>
                <span>{{ segment.opening_hours }}</span>
            </div>
            {% endif %}
            {% if segment.admission_fee %}
            <div class="info-row">
                <strong>门票:</strong>
                <span>{{ segment.admission_fee }}</span>
            </div>
            {% endif %}
        </div>

        <!-- 交通信息 -->
        {% if segment.transport %}
        <div class="transport-box">
            <h4>🚶 从上一站出发</h4>
            <p><strong>方式:</strong>
                {% if segment.transport.mode == 'walk' %}步行
                {% elif segment.transport.mode == 'subway' %}地铁
                {% elif segment.transport.mode == 'bus' %}公交
                {% else %}{{ segment.transport.mode }}
                {% endif %}
            </p>
            <p><strong>距离:</strong> {{ segment.transport.distance_meters }} 米</p>
            <p><strong>时间:</strong> 约 {{ segment.transport.duration_minutes }} 分钟</p>
            {% if segment.transport.instructions %}
            <p><strong>路线:</strong> {{ segment.transport.instructions }}</p>
            {% endif %}
        </div>
        {% endif %}
    </div>
    {% endfor %}

    <!-- 附录页 -->
    <div class="overview-page">
        <h2>📝 注意事项</h2>
        <ul style="margin-left: 20px; line-height: 2;">
            <li>请尊重当地居民和私有财产，保持安静</li>
            <li>拍照时注意安全，不要影响交通</li>
            <li>部分圣地可能需要购票或有特殊开放时间</li>
            <li>建议提前查询最新的营业时间和交通信息</li>
            <li>携带充电宝、水和雨具，祝巡礼愉快！🎉</li>
        </ul>

        <div style="margin-top: 40px; text-align: center; color: #999;">
            <p>本手册由 Seichijunrei Bot 自动生成</p>
            <p>生成时间: {{ weather.date }}</p>
        </div>
    </div>
</body>
</html>
```

---

## 4. 集成流程

### 4.1 Orchestrator Agent 调用顺序

```python
# 伪代码示例
class OrchestratorAgent:
    async def execute_pilgrimage_plan(self, user_input: str):
        # 1. 搜索周边圣地
        search_result = await SearchAgent.search(user_input)

        # 2. 用户偏好过滤
        filtered_points = await FilterAgent.filter(search_result)

        # 3. 计算最优路线
        route = await RouteAgent.calculate_route(filtered_points)

        # 4. 并行查询增强信息
        transport_info, weather_info, poi_info = await asyncio.gather(
            TransportAgent.query(route),
            WeatherAgent.query(location, date),
            POIAgent.query(route)
        )

        # 5. 生成地图
        map_html = await MapGeneratorTool.generate(route)
        map_screenshot = await MapGeneratorTool.screenshot(map_html)

        # 6. 生成PDF（使用地图截图）
        pdf_data = {
            "route": route,
            "weather": weather_info,
            "bangumi_list": filtered_points['bangumi_list'],
            "map_image_path": map_screenshot
        }
        pdf_path = await PDFGeneratorTool.generate(pdf_data)

        # 7. 返回结果
        return {
            "map_html": map_html,
            "pdf_path": pdf_path
        }
```

### 4.2 MapGeneratorTool 与 PDFGeneratorTool 协作

```python
# map_generator.py
class MapGeneratorTool:
    async def generate(self, route_data: dict) -> str:
        """生成交互式HTML地图"""
        # 使用Folium或Leaflet生成地图
        map_html = self._create_map(route_data)

        output_path = "outputs/map.html"
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(map_html)

        return output_path

    async def screenshot(self, map_html_path: str) -> str:
        """截取地图截图（用于嵌入PDF）"""
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 1200, "height": 800})

            await page.goto(f"file://{Path(map_html_path).absolute()}")
            await page.wait_for_load_state("networkidle")

            screenshot_path = "outputs/map_screenshot.png"
            await page.screenshot(path=screenshot_path, full_page=False)

            await browser.close()

        return screenshot_path
```

---

## 5. 实现步骤（分阶段）

### Phase 1: 基础PDF生成（2-3小时）

**目标**: 能够生成包含文本的简单PDF

- [ ] 安装Playwright依赖
  ```bash
  pip install playwright jinja2
  playwright install chromium
  ```
- [ ] 创建 `tools/pdf_generator.py`
  - 实现 `PDFGeneratorTool` 基础类
  - 实现 `generate()` 方法
- [ ] 创建简单HTML模板（仅文本内容）
  - 封面页
  - 基本信息页
- [ ] 测试生成简单PDF
  ```python
  tool = PDFGeneratorTool()
  data = {"route": {...}, "weather": {...}}
  await tool.generate(data)
  ```

**验收标准**:
- ✅ 能够生成PDF文件
- ✅ 包含封面和基本文本信息
- ✅ 无报错

---

### Phase 2: 模板完善（1-2小时）

**目标**: 完善HTML模板的样式和布局

- [ ] 设计CSS样式
  - 封面页样式（渐变背景、居中布局）
  - 内容页样式（卡片布局、信息网格）
  - 打印样式（分页、边距）
- [ ] 添加响应式布局
- [ ] 实现Jinja2动态数据插入
  - 路线循环渲染
  - 条件显示（营业时间、门票等）
- [ ] 测试不同数据量的渲染效果
  - 1个圣地
  - 10个圣地
  - 50个圣地

**验收标准**:
- ✅ PDF样式美观
- ✅ 分页正确
- ✅ 数据动态渲染正常

---

### Phase 3: 地图集成（1小时）

**目标**: 将地图截图嵌入PDF

- [ ] 在MapGeneratorTool中添加 `screenshot()` 方法
- [ ] 使用Playwright截取地图截图
  - 设置合适的viewport（1200x800）
  - 等待地图加载完成
- [ ] 在PDF模板中嵌入地图图片
  - 路线总览页添加地图
- [ ] 测试完整流程
  - MapGeneratorTool生成地图 → 截图 → PDFGeneratorTool嵌入

**验收标准**:
- ✅ PDF包含清晰的地图截图
- ✅ 地图中标记和路线可见
- ✅ 图片不变形

---

### Phase 4: 优化与完善（1小时）

**目标**: 优化细节，提升用户体验

- [ ] 添加番剧封面图到封面页
- [ ] 添加场景截图到圣地详情页
- [ ] 优化图片加载和大小
  - 压缩大图片
  - 设置合理的max-width/max-height
- [ ] 添加错误处理和日志
  - 图片加载失败时的占位符
  - Playwright启动失败的降级方案
- [ ] 添加进度提示（生成中...）
- [ ] 清理临时文件

**验收标准**:
- ✅ PDF包含所有图片（封面、截图、地图）
- ✅ 有完善的错误处理
- ✅ 有日志记录生成过程
- ✅ 文件大小合理（< 10MB）

---

### Phase 5: 集成测试（1小时）

**目标**: 端到端测试整个流程

- [ ] 编写单元测试
  - 测试HTML模板渲染
  - 测试PDF生成（mock数据）
- [ ] 集成测试
  - 完整流程：路线数据 → 地图 → PDF
  - 不同场景：1个圣地、10个圣地、多番剧
- [ ] 边界情况测试
  - 无地图截图时的降级
  - 缺失字段（营业时间、门票）
  - 长文本处理
- [ ] 性能测试
  - 测量生成时间
  - 检查内存占用

**验收标准**:
- ✅ 所有测试通过
- ✅ 生成时间 < 30秒
- ✅ 无内存泄漏

---

### 总开发时间估算

| 阶段 | 预计时间 | 缓冲时间 | 总计 |
|------|---------|---------|------|
| Phase 1: 基础PDF | 2-3小时 | +0.5小时 | 2.5-3.5小时 |
| Phase 2: 模板完善 | 1-2小时 | +0.5小时 | 1.5-2.5小时 |
| Phase 3: 地图集成 | 1小时 | +0.5小时 | 1.5小时 |
| Phase 4: 优化完善 | 1小时 | +0.5小时 | 1.5小时 |
| Phase 5: 集成测试 | 1小时 | +0.5小时 | 1.5小时 |
| **总计** | **6-8小时** | **+2.5小时** | **8.5-10.5小时** |

**建议分配**: 分2-3天完成，每天3-4小时

---

## 6. 依赖清单

### Python包依赖

创建 `requirements.txt` 或更新现有文件：

```txt
# PDF生成相关
playwright>=1.48.0
jinja2>=3.1.0

# 地图生成（如果使用Folium）
folium>=0.15.0

# 图片处理（可选，用于压缩图片）
pillow>=10.0.0

# 异步支持
asyncio
```

### 安装步骤

```bash
# 1. 安装Python包
pip install playwright jinja2 folium pillow

# 2. 安装Playwright浏览器（仅Chromium）
playwright install chromium

# 3. 验证安装
python -c "from playwright.sync_api import sync_playwright; print('✅ Playwright安装成功')"
```

### 系统依赖（Linux）

如果在Linux服务器上部署，可能需要安装额外的系统库：

```bash
# Ubuntu/Debian
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2
```

---

## 7. 备用方案（如遇到问题）

### 问题1: Playwright安装失败或体积过大

**症状**:
- `playwright install` 下载失败
- 浏览器二进制文件占用过多空间（~300MB）
- 云端部署时容器大小限制

**降级方案：使用WeasyPrint**

```bash
# 安装WeasyPrint
pip install weasyprint

# 卸载Playwright（节省空间）
pip uninstall playwright
```

**代码修改**:
```python
# pdf_generator.py
from weasyprint import HTML

class PDFGeneratorTool:
    async def generate(self, data: dict, output_path: str):
        html_content = self._render_template(data)

        # 保存临时HTML
        temp_html = "outputs/temp_guide.html"
        with open(temp_html, 'w', encoding='utf-8') as f:
            f.write(html_content)

        # WeasyPrint生成PDF
        HTML(temp_html).write_pdf(output_path)

        return output_path
```

**注意**:
- 需要预先生成静态地图图片（不能截取动态地图）
- CSS支持有限，可能需要调整模板样式

**实现成本**: +2小时（调整样式 + 测试）

---

### 问题2: PDF文件过大（> 10MB）

**原因**:
- 场景截图分辨率过高
- 嵌入多个高清图片
- 地图截图过大

**优化方案**:

1. **压缩图片**
```python
from PIL import Image

def compress_image(image_path: str, max_width: int = 800):
    img = Image.open(image_path)

    # 调整大小
    if img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)

    # 保存为优化后的JPEG
    img.convert('RGB').save(image_path, 'JPEG', quality=85, optimize=True)
```

2. **降低地图截图分辨率**
```python
# MapGeneratorTool.screenshot()
page = await browser.new_page(viewport={"width": 800, "height": 600})  # 从1200x800降低
```

3. **生成两个版本**
- **在线预览版**: 高清图片，仅在线查看
- **打印版**: 压缩图片，适合打印和分享

**目标**: PDF大小 < 5MB

---

### 问题3: 模板样式调试耗时

**问题**:
- CSS调整需要反复生成PDF查看效果
- 调试周期长

**解决方案**:

1. **先在浏览器中调试**
```bash
# 生成HTML后直接在浏览器中打开
open outputs/temp_guide.html
```

2. **使用浏览器的打印预览**
- Chrome: `Ctrl+P` 查看打印效果
- 调整CSS直到满意再用Playwright生成PDF

3. **使用CSS框架**
- 使用成熟的打印CSS框架（如Print.css）
- 减少自定义样式的调试时间

---

### 问题4: 地图截图不清晰

**原因**:
- viewport太小
- 地图缩放级别不合适
- PNG压缩过度

**解决方案**:

```python
# 增加viewport分辨率
page = await browser.new_page(viewport={"width": 1600, "height": 1200})

# 设置设备像素比（Retina屏幕）
await page.set_viewport_size({"width": 1600, "height": 1200})
await page.evaluate("window.devicePixelRatio = 2")

# 截图时使用更高质量
await page.screenshot(
    path=screenshot_path,
    type='png',  # 使用PNG而非JPEG
    full_page=False
)
```

---

## 8. 测试计划

### 8.1 单元测试

```python
# tests/test_pdf_generator.py
import pytest
from tools.pdf_generator import PDFGeneratorTool

@pytest.mark.asyncio
async def test_generate_simple_pdf():
    """测试生成基础PDF"""
    tool = PDFGeneratorTool()

    mock_data = {
        "route": {
            "start_location": {"name": "新宿站"},
            "segments": [
                {
                    "order": 1,
                    "point": {"name": "测试圣地", "cn_name": "测试"},
                    "transport": {"mode": "walk", "duration_minutes": 10}
                }
            ]
        },
        "weather": {"date": "2025-11-20", "condition": "晴天"},
        "bangumi_list": []
    }

    pdf_path = await tool.generate(mock_data, "outputs/test.pdf")

    assert Path(pdf_path).exists()
    assert Path(pdf_path).stat().st_size > 1000  # 至少1KB

@pytest.mark.asyncio
async def test_template_rendering():
    """测试Jinja2模板渲染"""
    tool = PDFGeneratorTool()

    data = {"route": {"start_location": {"name": "测试站"}}}
    html = tool._render_template(data)

    assert "测试站" in html
    assert "<!DOCTYPE html>" in html
```

### 8.2 集成测试

```python
# tests/test_integration.py
@pytest.mark.asyncio
async def test_full_pipeline():
    """测试完整流程：路线 → 地图 → PDF"""

    # 1. 准备路线数据
    route_data = get_mock_route_data()

    # 2. 生成地图
    map_tool = MapGeneratorTool()
    map_html = await map_tool.generate(route_data)

    # 3. 截图地图
    map_screenshot = await map_tool.screenshot(map_html)
    assert Path(map_screenshot).exists()

    # 4. 生成PDF
    pdf_tool = PDFGeneratorTool()
    pdf_data = {**route_data, "map_image_path": map_screenshot}
    pdf_path = await pdf_tool.generate(pdf_data)

    # 5. 验证
    assert Path(pdf_path).exists()
    assert Path(pdf_path).stat().st_size > 10000  # 至少10KB
```

### 8.3 边界情况测试

```python
@pytest.mark.asyncio
async def test_missing_optional_fields():
    """测试缺失可选字段时的降级"""
    data = {
        "route": {
            "segments": [
                {
                    "order": 1,
                    "point": {"name": "圣地"},
                    # 缺失: screenshot_url, opening_hours, admission_fee
                    "transport": None  # 缺失交通信息
                }
            ]
        }
    }

    tool = PDFGeneratorTool()
    pdf_path = await tool.generate(data)
    assert Path(pdf_path).exists()

@pytest.mark.asyncio
async def test_large_route():
    """测试大量圣地（50个）"""
    data = {
        "route": {
            "segments": [
                {"order": i, "point": {"name": f"圣地{i}"}}
                for i in range(1, 51)
            ]
        }
    }

    tool = PDFGeneratorTool()
    pdf_path = await tool.generate(data)

    # 验证文件大小
    size_mb = Path(pdf_path).stat().st_size / (1024 * 1024)
    assert size_mb < 15  # 不超过15MB
```

### 8.4 质量检查清单

- [ ] **分页正确**: 每个圣地独立成页，无内容被截断
- [ ] **图片清晰**: 封面、场景截图、地图图片清晰可辨
- [ ] **字体可读**: 中文显示正常，无乱码
- [ ] **样式一致**: 颜色、间距、对齐统一
- [ ] **文件大小**: < 10MB（50个圣地以内）
- [ ] **生成速度**: < 30秒（50个圣地以内）
- [ ] **错误处理**: 缺失数据时有合理降级

---

## 9. 风险与缓解措施

| 风险 | 影响 | 概率 | 缓解措施 | 备用方案 |
|------|------|------|----------|----------|
| **Playwright安装失败** | 高 | 中 | 提供详细安装文档和系统依赖清单 | 降级到WeasyPrint |
| **PDF文件过大** | 中 | 高 | 图片压缩、优化分辨率 | 生成"在线版"和"打印版" |
| **模板样式调试耗时** | 中 | 中 | 先在浏览器调试，使用CSS框架 | 使用简化版模板 |
| **地图截图不清晰** | 低 | 低 | 调整viewport和devicePixelRatio | 使用静态地图API |
| **中文字体缺失** | 低 | 低 | 使用Web字体（Google Fonts） | 嵌入本地字体文件 |
| **生成速度慢** | 低 | 中 | 优化图片加载、复用browser实例 | 异步并行处理 |
| **云端部署限制** | 高 | 低 | 使用轻量级容器、按需下载浏览器 | 使用无头Chrome Docker镜像 |

---

## 10. 性能优化建议

### 10.1 浏览器实例复用

```python
class PDFGeneratorTool:
    def __init__(self):
        self._browser = None

    async def _get_browser(self):
        if self._browser is None:
            playwright = await async_playwright().start()
            self._browser = await playwright.chromium.launch()
        return self._browser

    async def generate(self, data: dict):
        browser = await self._get_browser()
        page = await browser.new_page()
        # ... 生成PDF
        await page.close()  # 仅关闭页面，不关闭浏览器
```

### 10.2 图片懒加载

```html
<!-- 在HTML模板中使用懒加载 -->
<img src="{{ image_url }}" loading="lazy" alt="...">
```

### 10.3 并行处理

```python
# 并行生成多个PDF（如果需要）
tasks = [
    PDFGeneratorTool().generate(data1),
    PDFGeneratorTool().generate(data2)
]
results = await asyncio.gather(*tasks)
```

---

## 11. 下一步行动

### 立即开始

1. **[NOW] 确认技术选型**: ✅ Playwright作为主方案
2. **[NEXT] 创建文件结构**:
   ```bash
   mkdir -p tools templates outputs
   touch tools/pdf_generator.py
   touch templates/pilgrimage_guide.html
   ```
3. **[NEXT] 安装依赖**:
   ```bash
   pip install playwright jinja2
   playwright install chromium
   ```

### 本周目标

- [ ] **Day 1-2**: Phase 1 + Phase 2（基础PDF + 模板）
- [ ] **Day 3**: Phase 3（地图集成）
- [ ] **Day 4**: Phase 4 + Phase 5（优化 + 测试）

### 里程碑

- **MVP**: 能够生成包含文本和地图的基础PDF（Day 2完成）
- **Beta**: 完整功能PDF，包含所有图片和样式（Day 3完成）
- **Release**: 经过测试和优化的生产版本（Day 4完成）

---

## 12. 参考资源

### 官方文档

- [Playwright Python 文档](https://playwright.dev/python/docs/intro)
- [Playwright PDF API](https://playwright.dev/python/docs/api/class-page#page-pdf)
- [Jinja2 模板文档](https://jinja.palletsprojects.com/)

### 示例代码

- [Playwright PDF Examples](https://github.com/microsoft/playwright/tree/main/examples)
- [HTML to PDF Best Practices](https://www.smashingmagazine.com/2015/01/designing-for-print-with-css/)

### 打印样式参考

- [Print.css Framework](https://github.com/cognitom/paper-css)
- [CSS Print Media Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/print)

---

## 附录：快速启动清单

```bash
# 1. 克隆项目
cd seichijunrei-bot

# 2. 安装依赖
pip install playwright jinja2 folium pillow
playwright install chromium

# 3. 创建文件
touch tools/pdf_generator.py
touch templates/pilgrimage_guide.html

# 4. 运行测试
python -c "from playwright.sync_api import sync_playwright; print('✅ Ready to go!')"

# 5. 开始开发
# 按照 Phase 1 的步骤开始实现
```

---

**文档版本**: 1.0
**创建日期**: 2025-11-20
**最后更新**: 2025-11-20
**作者**: Zhenjia Zhou
**状态**: ✅ 已完成 - 等待实施
