# Findings: Seichijunrei-Agent 重构

## 技术选型对比研究

### Agent 框架（10 个对比后选 Pydantic AI）

| 框架 | 多Agent | Gemini 支持 | 依赖重量 | Plan-and-Execute | 推荐度 |
|------|---------|------------|---------|-----------------|--------|
| **Pydantic AI** | 中（handoffs） | 原生 google-genai | 轻 | 需自建（~300行） | **选定** |
| Agno | 强（Teams） | 原生 | 中 | 需自建 | 备选 |
| LangGraph | 强 | 通过 langchain | 重 | 原生支持 | 复杂度过高 |
| CrewAI | 强（Crews） | 通过 langchain | 中重 | 内置 | 太 opinionated |
| OpenAI Agents SDK | 中（handoffs） | 需适配器 | 轻 | 无 | OpenAI 偏重 |
| LangChain | 中 | 通过集成包 | 重 | 委托给 LangGraph | 过时 |
| Haystack | 中（pipeline） | 通过集成 | 中 | 需自建 | RAG 专用 |
| Semantic Kernel | 强 | 支持 | 重 | 内置 Planner | .NET 偏重 |
| AutoGen/AutoGPT | 弱/强 | 支持 | 重 | 无 | 维护模式 |
| Dify | 中（workflow） | 支持 | 重（全平台） | 视觉编排 | 非代码优先 |

### 向量数据库（5 个对比后选 Supabase pgvector）

| 方案 | 向量搜索 | 地理查询 | SQL | Python SDK | 费用 |
|------|---------|---------|-----|-----------|------|
| **Supabase pgvector** | pgvector HNSW | PostGIS 金标准 | 完整 PG | asyncpg 强 | $0-25/月 |
| Qdrant | 原生 HNSW | geo_radius 原生 | 无 | 最佳 | $0 |
| CF Vectorize | 基础 | 无 | 无 | beta 弱 | $0-5/月 |
| ChromaDB | 基础 | 无 | 无 | Python 原生 | 免费 |
| Weaviate | HNSW+BM25 | 有限(800上限) | GraphQL | 良好 | $0-45/月 |

**选 Supabase 理由**: 一条 SQL = 向量+关系+地理查询。Agent 可直接写 SQL。

### 可观测性（5 个对比后选 OTel 为底）

| 方案 | OTel 原生 | Gemini 支持 | 自部署 | 迁移性 |
|------|----------|------------|--------|--------|
| **OTel + Phoenix** | 原生 | auto-instrument | pip install | **最高** |
| Langfuse | 后加 | 手动插桩 | Docker | 高 |
| Langtrace | 原生 | 部分 | Docker(重) | 高 |
| Helicone | 无 | proxy | 弱 | 低 |
| OpenLIT | 原生 | auto-instrument | Docker(轻) | 高 |

### CF vs Supabase 定位

| 维度 | Cloudflare | Supabase |
|------|-----------|---------|
| **角色** | Compute + CDN + 文件存储 | 数据库（唯一） |
| **服务** | Workers/Containers, R2, KV | PostgreSQL + pgvector + PostGIS |
| **数据** | 截图(R2) | bangumi, points, sessions, routes |
| **为什么不用CF D1** | SQLite 不支持 pgvector/PostGIS | PG 一站式更强 |
| **为什么不用CF Vectorize** | Python SDK beta, 无地理查询 | pgvector+PostGIS 一条SQL |

---

## HLD 系统上下文图

```
┌─────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                     │
│  Bangumi API │ Anitabi API │ Google Maps │ LLM Provider  │
└───────┬──────────────┬──────────────┬────────────┬──────┘
        │              │              │            │
┌───────▼──────────────▼──────────────▼────────────▼──────┐
│  CLOUDFLARE WORKERS / CONTAINERS                        │
│                                                         │
│  Interface: A2A Server (JSON-RPC) + A2UI Web            │
│  Agent Runtime: IntentAgent → PlannerAgent → Executor   │
│  StepAgents: Extract/Search/Select/Points/Route/Present │
│  Tools: Agentic RAG Retriever + API Gateways            │
│  Infra: OTel + SessionStore + Supabase Client           │
│  Storage: R2 (screenshots)                              │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│  SUPABASE (PostgreSQL + pgvector + PostGIS)              │
│  bangumi │ points (embedding+geography) │ sessions       │
│  routes (history)                                        │
└──────────────────────────────────────────────────────────┘
```

---

## Database Schema

### bangumi 表
```sql
CREATE TABLE bangumi (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, title_cn TEXT,
    cover_url TEXT, air_date TEXT, summary TEXT, eps_count INTEGER,
    rating REAL, points_count INTEGER DEFAULT 0, primary_color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### points 表（核心: 向量 + 地理）
```sql
CREATE TABLE points (
    id TEXT PRIMARY KEY,
    bangumi_id TEXT NOT NULL REFERENCES bangumi(id),
    name TEXT NOT NULL, cn_name TEXT, address TEXT,
    episode INTEGER DEFAULT 0, time_seconds INTEGER DEFAULT 0,
    screenshot_url TEXT, origin TEXT, origin_url TEXT,
    opening_hours TEXT, admission_fee TEXT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    embedding VECTOR(1024),
    search_text TEXT GENERATED ALWAYS AS (
        COALESCE(name,'') || ' ' || COALESCE(cn_name,'') || ' ' || COALESCE(address,'')
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_points_bangumi ON points(bangumi_id);
CREATE INDEX idx_points_location ON points USING GIST(location);
CREATE INDEX idx_points_embedding ON points USING hnsw(embedding vector_cosine_ops);
```

### sessions 表
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id TEXT,
    state JSONB NOT NULL DEFAULT '{}', metadata JSONB DEFAULT '{}',
    lifecycle TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
```

### routes 表
```sql
CREATE TABLE routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT REFERENCES sessions(id),
    bangumi_id TEXT REFERENCES bangumi(id),
    origin_station TEXT, origin_location GEOGRAPHY(POINT, 4326),
    point_ids TEXT[] NOT NULL, total_distance REAL, total_duration INTEGER,
    route_data JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API 输入输出

### A2A (JSON-RPC 2.0)
- `tasks/send` → `{ id, sessionId, message }` → `{ task with a2ui_messages }`
- `tasks/get` → `{ id }` → task object
- `/.well-known/agent.json` → Agent Card

### Internal Schemas (Pydantic AI)
- `IntentOutput`: intent, confidence, extracted_params
- `ExecutionPlan`: steps[], rationale
- `RAGQuery`: query_text, bangumi_id, location, radius_m, strategy, limit

---

## 数据存储策略

| 数据 | 来源 | 存储位置 | 大小 |
|------|------|---------|------|
| 动漫元数据 | Bangumi API (种子 5-10部) | Supabase bangumi | ~2.5MB |
| 巡礼点 | Anitabi API (种子数据) | Supabase points | ~250MB |
| 会话 | 用户交互 | Supabase sessions | ~50KB/session |
| 路线 | Agent 生成 | Supabase routes | ~20KB/route |
| 截图 | Anitabi | CF R2 | ~5-10GB |
| Embedding | BGE-M3 | points.embedding | ~200MB |

**DB Miss Fallback**: 没有 → API 查 → 返回用户 → 异步缓存入库

---

## Generative UI (pi-generative-ui)

Agent 调用 `show_widget` tool → 传入 HTML → 前端用 morphdom DOM diffing 流式渲染。
用途: 地图、图表、路线可视化。不影响现有确定性 A2UI 渲染。

## Code Sandbox

方案: E2B / CF Sandboxes / Daytona / 自建 Docker。开发期用自建 Docker。

## Text-to-SQL

内嵌于 Agentic RAG。可选增强: pgai Semantic Catalog。
