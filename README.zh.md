<div align="center">

# 聖地巡礼 Seichijunrei

**AI 驱动的动漫圣地搜索与路线规划**

[![CI](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg?logo=nextdotjs)](https://nextjs.org)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e.svg?logo=supabase)](https://supabase.com)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/Seichijunrei-agent)](https://github.com/lifeodyssey/Seichijunrei-agent/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/Seichijunrei-agent?style=flat)](https://github.com/lifeodyssey/Seichijunrei-agent)

[**在线体验**](https://seichijunrei.zhenjia.org) | [架构文档](docs/ARCHITECTURE.md) | [部署指南](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

用自然语言告诉 Agent 一部动漫的名字或一个地点，它会找到现实中的圣地巡礼地点、在地图上展示，并规划步行路线——一轮对话搞定。

## 工作原理

```
用户输入 → ReActPlannerAgent（LLM → 结构化 ExecutionPlan）
                     ↓
            ExecutorAgent（确定性工具调度）
              ├── resolve_anime  → DB 优先的标题查找; 未命中时调用 Bangumi.tv API
              ├── search_bangumi → 参数化 SQL → Supabase 数据点
              ├── search_nearby  → PostGIS 地理检索
              ├── plan_route     → 最近邻路线排序
              └── answer_question → 静态 FAQ
```

只有规划器会调用 LLM。执行器完全确定性——执行过程中不使用 LLM。

`resolve_anime` 具有自进化能力：首次查询未知标题时，从 Bangumi.tv 获取元数据并写入数据库，后续查询直接命中本地 DB。

## 主要功能

- **对话式搜索** — 支持日语、英语、中文提问，规划器自动判断意图
- **自进化动漫目录** — DB 优先，Bangumi.tv API 写穿透补全
- **地理检索** — 根据坐标或站名搜索附近圣地
- **路线规划** — 最近邻算法排序，支持用户自选地点
- **生成式 UI** — 三栏布局（聊天面板 + 交互结果面板）
- **边缘认证** — JWT（magic-link）和 API Key 认证在 Cloudflare Worker 层执行
- **评估套件** — 50+ 规划质量用例，覆盖 3 种语言

## 快速开始

```bash
# 安装 Python 依赖
uv sync --extra dev

# 本地启动服务
make serve

# 运行测试
make test              # 单元测试
make test-integration  # 稳定版集成测试
make test-all          # 单元 + 集成
make test-eval         # 模型评估测试（需要 LLM 访问）
make check             # lint + 类型检查 + 测试
```

## 数据库迁移

使用 Supabase CLI 管理所有 schema 变更：

```bash
make db-list           # 列出已应用的迁移
make db-push-dry       # 迁移预演
make db-push           # 执行迁移
make db-diff NAME=x    # 从本地变更生成 diff
```

迁移应在部署时的专用步骤中执行，而非应用启动时。

## 环境变量

**必需：**
| 变量 | 用途 |
|---|---|
| `SUPABASE_DB_URL` | Postgres 连接字符串 |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端 Supabase 认证 |
| `SUPABASE_ANON_KEY` | Worker 边缘 JWT 验证 |
| `ANITABI_API_URL` | Anitabi 圣地数据 API |
| `GEMINI_API_KEY` | 规划器 Agent 使用的 LLM |

**可选：** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

详见 [`backend/config/settings.py`](backend/config/settings.py) 和 [`.env.example`](.env.example)。

## 使用示例

**Python（直接调用）：**
```python
from backend.agents.pipeline import run_pipeline
from backend.infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_pipeline("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.final_output["message"])
```

**HTTP（API Key）：**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

**Python 客户端：**
```python
from backend.clients.python.seichijunrei_client import SeichijunreiClient

client = SeichijunreiClient(api_key="sk_your_key_here")
result = client.search("Hibike Euphonium locations", locale="en")
```

## 仓库结构地图

- `backend/` — Python 运行时：agents、interfaces、infrastructure、tests、tools
- `frontend/` — Next.js 静态导出前端与 UI 组件
- `worker/` — Cloudflare Worker 入口，负责认证与请求路由
- `supabase/` — schema 迁移与 Supabase 项目资产
- `docs/` — 架构文档、运维文档、迭代资料与实现计划
- `Dockerfile`、`Makefile`、`pyproject.toml`、`wrangler.toml`、`package.json` — 保留在根目录的运行与工具入口文件

## 文档

- [架构文档](docs/ARCHITECTURE.md) — 系统设计参考
- [部署指南](docs/ops/deployment.md) — Cloudflare Workers + Containers 部署
- [运维文档](docs/ops/README.md) — 运维手册与环境流程
- [迭代资料](docs/iterations/README.md) — 按迭代归档的 task plan、progress、findings
- [实现计划](docs/superpowers/plans/) — 保持原位的实现计划历史
- [设计规格](docs/superpowers/specs/) — 产品规格说明
