# Seichijunrei Bot

> An intelligent 聖地巡礼 (seichijunrei) travel assistant built on Google ADK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Track: Concierge Agents](https://img.shields.io/badge/Track-Concierge%20Agents-blue)](https://www.kaggle.com/competitions/google-adk-capstone)

---

## Overview

Seichijunrei Bot is a conversational AI agent that helps anime fans plan
聖地巡礼 (seichijunrei) trips to real‑world locations featured in anime.

Through an automatic 2-stage workflow, the agent:

- **Stage 1**: Searches for anime by name and presents top candidates for user selection
- **Stage 2**: Automatically parses user's selection and uses LLM reasoning to select 8-12 suitable 聖地巡礼 points
- Considers geography, story importance, and visit feasibility when choosing points
- Generates simple narrative routes with rough time/distance estimates and generic transport tips

The agent automatically detects the user's language (Chinese / English / Japanese)
and presents results and routes in that language, while keeping Japanese titles
as the canonical reference.

The project is implemented using the Google Agent Development Kit (ADK) with
Gemini 2.0 Flash for intelligent decision-making.

---

## Key Features

- **Conversational Search**
  - Natural language anime search via Bangumi API
  - Presents 3-5 top candidates with summaries
  - User-friendly selection through dialogue

- **LLM-Driven Intelligent Selection**
  - Gemini 2.0 Flash intelligently selects 8-12 optimal 聖地巡礼 points
  - Configured to consider geographic clustering, plot importance, and visit feasibility
  - Balances route feasibility with content coverage

- **Automated Route Planning**
  - Simple narrative-order-based route suggestions via a custom tool
  - Rough estimates for duration and distance
  - Generic transport tips based on the starting location

- **Multilingual UX**
  - Detects user language from the initial query (`zh-CN`, `en`, `ja`)
  - Stage 1 and Stage 2 responses are generated in the user's language
  - Unified title format: **user-language title (Japanese original[, air date])**
  - Uses a dedicated Gemini-powered translation tool for anime titles

- **Rich Outputs**
  - Session-based state management for multi-turn conversations

---

## Example Conversation

```text
User: 我想去镰仓圣地巡礼
Bot: 找到 3 部可能相关的作品，请选择：
     1. 灌篮高手（スラムダンク，1993-10）
     2. 青春猪头少年不会梦到兔女郎学姐（青春ブタ野郎はバニーガール先輩の夢を見ない，2018-10）
     3. TARI TARI（2012-07）

User: 1
Bot: 好的。我将从 Anitabi 获取点位并为你规划 8–12 个适合的一日巡礼路线。
```

### Useful Commands

- `reset`: Clear state and start over
- `back`: Re-pick from the candidate list
- `/help`: Show usage hints
- `/status`: Show current session state keys (debug)

---

## Architecture (High Level)

The core workflow is implemented as a **2-stage conversational flow** using ADK agents:

### Stage 1: Bangumi Search Workflow
1. **ExtractionAgent (LlmAgent)**
   - Extracts `bangumi_name`, `location`, and `user_language` from user query
   - Output: `extraction_result` → session state

2. **BangumiCandidatesAgent (SequentialAgent)**
   - Searches Bangumi API for matching anime works
   - Selects top 3-5 candidates
   - Output: `bangumi_candidates` → session state

3. **UserPresentationAgent (LlmAgent)**
   - Generates multilingual, natural language presentation of candidates
   - Formats titles as **user-language title (Japanese original, air date)**
   - Uses a translation tool for Chinese titles when missing
   - No output_schema (conversational response); user selects their preferred anime

### Stage 2: Route Planning Workflow
4. **UserSelectionAgent (LlmAgent)**
   - Confirms and normalizes user's anime selection
   - Output: `selected_bangumi` → session state

5. **PointsSearchAgent (BaseAgent)**
   - Fetches all 聖地巡礼 points from Anitabi API
   - Output: `all_points` → session state

6. **PointsSelectionAgent (LlmAgent)**
   - Intelligently selects 8-12 best points using LLM reasoning
   - Considers: geography, plot importance, accessibility
   - Output: `points_selection_result` → session state

7. **RoutePlanningAgent (LlmAgent)**
   - Calls custom `plan_route` tool for optimization
   - Generates final route with transport suggestions
   - Output: `route_plan` → session state

8. **RoutePresentationAgent (LlmAgent)**
   - Reads `route_plan`, `selected_bangumi`, and `extraction_result.user_language`
   - Presents a structured, user-language route summary (overview, ordered list,
     time/distance, transport tips, special notes)
   - Uses the same unified title format as Stage 1

**State Management:**
- Uses `InMemorySessionService` for multi-turn conversations
- State keys flow through workflow stages
- Root agent (`seichijunrei_bot`) automatically routes between stages based on session state:
  - No `bangumi_candidates` → Stage 1 (search and present)
  - Has `bangumi_candidates` → Stage 2 (parse selection and plan route)

**Supporting Layers:**
- **Domain layer** (`domain/`) – Pydantic entities: `Bangumi`, `Point`, `Route`, `SeichijunreiSession`
- **Infrastructure** (`clients/`, `services/`) – HTTP clients, retry, cache, session management
- **Tools** (`tools/`) – Map and PDF generator tools exposed to agent
- **Templates** (`templates/`) – HTML/PDF layouts for user-facing outputs

---

## Getting Started

### Prerequisites

- Python 3.11+
- [`uv`](https://github.com/astral-sh/uv) for dependency management
- Google API Key with Gemini API access
- No additional API keys required (Bangumi and Anitabi APIs are public)

### 1. Install dependencies

```bash
uv sync
```

If you run into uv cache permission issues (e.g. in sandboxes/CI), set:

```bash
export UV_CACHE_DIR="$(pwd)/.uv_cache"
```

### 2. Configure environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Required configuration:

```env
GEMINI_API_KEY=your_gemini_api_key
ANITABI_API_URL=https://api.anitabi.cn/bangumi
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
```

### 3. Run the ADK web UI (recommended)

```bash
make dev      # first time only – installs tools
make web      # start ADK Web UI
```

or directly:

```bash
uv run adk web adk_agents
```

Then open the URL printed in the terminal (typically
`http://localhost:8000`) and chat with the agent.

### 4. Run from the command line

```bash
make run
# or
uv run adk run adk_agents/seichijunrei_bot
```

### 5. Run a minimal offline smoke test

This verifies the repo is importable and the ADK agent wiring is valid.
It does **not** call external APIs or LLMs.

```bash
make smoke
```

### 6. Run the experimental A2UI Web UI

This is a local, end-user oriented UI that renders A2UI messages derived from
the ADK session state (candidate picker + route view).

```bash
make a2ui-web
```

Then open `http://127.0.0.1:8081`.

#### Optional: Use a deployed Vertex AI Agent Engine backend

If you have deployed `adk_agents/` to Agent Engine, you can run the same A2UI UI
locally but drive it via remote queries (session state is fetched from Agent Engine):

```bash
export A2UI_BACKEND=agent_engine
export A2UI_VERTEXAI_PROJECT="YOUR_PROJECT_ID"
export A2UI_VERTEXAI_LOCATION="us-central1"
export A2UI_AGENT_ENGINE_NAME="projects/YOUR_PROJECT_ID/locations/us-central1/reasoningEngines/YOUR_RESOURCE_ID"

make a2ui-web
```

You must have Application Default Credentials configured (e.g. `gcloud auth application-default login`).

---

## Project Structure

```text
Seichijunrei/
├── README.md                # Overview (this file)
├── .env.example             # Environment template
├── pyproject.toml           # Project configuration
├── Makefile                 # Convenience commands
│
├── adk_agents/
│   └── seichijunrei_bot/
│       ├── agent.py              # ADK root agent entry point
│       ├── _agents/              # ADK agent implementations
│       │   ├── extraction_agent.py
│       │   ├── bangumi_candidates_agent.py
│       │   ├── bangumi_search_agent.py
│       │   ├── user_presentation_agent.py
│       │   ├── user_selection_agent.py
│       │   ├── points_search_agent.py
│       │   ├── points_selection_agent.py
│       │   ├── route_planning_agent.py
│       │   └── route_presentation_agent.py
│       ├── _state.py             # Shared session state keys
│       ├── _schemas.py           # Pydantic schemas for ADK agents
│       ├── _workflows/           # Stage 1/Stage 2 workflow orchestrations
│       │   ├── bangumi_search_workflow.py
│       │   └── route_planning_workflow.py
│       ├── skills.py             # Workflow contracts (required/provided state)
│       └── tools/                # Custom function tools
│           ├── __init__.py       # ADK FunctionTools export
│           ├── route_planning.py # Route optimization tool (SimpleRoutePlanner)
│           └── translation.py    # Gemini-based title translation tool
│
├── application/             # Use cases + ports (clean boundary)
├── infrastructure/          # Gateways/adapters + optional MCP servers
├── clients/                 # Legacy HTTP clients (being migrated to infrastructure)
├── services/                # Legacy services (cache/retry/planner; being migrated)
├── interfaces/              # Experimental UIs (e.g. A2UI web)
│
├── config/                  # Configuration management
│   └── settings.py          # Pydantic settings
│
├── domain/                  # Domain models
│   └── entities.py          # Core Pydantic entities
│
├── tools/                   # (reserved for future non-ADK utilities)
│   └── __init__.py
│
├── utils/                   # Utilities
│   └── logger.py            # Structured logging
│
├── templates/               # (currently unused; reserved for future HTML/PDF outputs)
│
└── tests/
    ├── unit/                # Unit tests
    └── integration/         # Integration tests
```

---

## Data Sources and APIs

- **Bangumi** (bangumi.tv) – Anime metadata and subject information
- **Anitabi** (api.anitabi.cn) – 聖地巡礼 location database
- **Google Gemini 2.0 Flash** – LLM for intelligent point selection and conversational AI

---

## Deployment

This agent can be deployed to **Google Vertex AI Agent Engine** for production use.

### Deployment via GitHub Actions (Recommended)

The repository includes a GitHub Actions workflow for manual deployment:

1. Configure Google Cloud project and service account
2. Set GitHub Secrets (`GCP_PROJECT_ID`, `GCP_SA_KEY`)
3. Go to **Actions** tab → **Deploy to Agent Engine** workflow
4. Click **Run workflow** → Select environment (staging/production)
5. Agent deploys to Vertex AI Agent Engine in `us-central1`

**📖 Full guide:** See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed setup instructions.

### Manual Deployment (Alternative)

For local/manual deployment:

```bash
# Install ADK CLI
pip install google-adk

# Authenticate
gcloud auth application-default login

# Deploy to Agent Engine
adk deploy agent_engine \
  --project=YOUR_PROJECT_ID \
  --region=us-central1 \
  --staging_bucket=gs://YOUR_PROJECT_ID-agent-staging \
  adk_agents
```

See [ADK Deployment Docs](https://google.github.io/adk-docs/deploy/) for more options.

---

## TODO / Roadmap

The following items are planned or partially implemented and tracked here
instead of being documented as completed features:

- **Google Maps integration**
  - Use the existing Google Maps client more deeply to fetch real route/directions
    data and surface Google Maps links or snippets alongside the LLM-planned route.

- **PDF / document export**
  - Reintroduce a lightweight, template-based PDF or document generator that can
    turn a planned route into a printable guide, without bloating the core agent.

- **Weather integration**
  - Add an optional weather lookup step that annotates the planned day-trip with
    basic forecast info and suggestions (e.g., bring umbrella, temperature range).

- **Deeper multilingual support**
  - Extend the current zh-CN/en/ja chat experience to additional outputs
    (for example, future map or document generation features).

- **Route planning enhancements**
  - Replace the heuristic `SimpleRoutePlanner` with a more realistic planner
    that leverages transit/walking directions APIs while keeping ADK tool
    boundaries clean.

- **Persistent session storage**
  - Add an optional Redis/Cloud-backed `SessionService` for long-lived user
    sessions beyond the current in-memory implementation.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture deep-dive |
| [docs/a2ui/](docs/a2ui/) | A2UI protocol contracts |
| [docs/DOCS_POLICY.md](docs/DOCS_POLICY.md) | Documentation guidelines |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Agent Engine deployment |

For documentation guidelines and writing rules, see [docs/DOCS_POLICY.md](docs/DOCS_POLICY.md).

---

## License

This project is released under the MIT License (see `LICENSE`).

Built as a Google ADK Capstone Project in the "Concierge Agents" track.
