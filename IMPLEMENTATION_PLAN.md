# Seichijunrei Bot Implementation Plan

## Project Overview

**Project**: Seichijunrei Bot (圣地巡礼机器人)
**Type**: Google ADK Capstone Project - Concierge Agents Track
**Deadline**: December 1, 2025
**Objective**: Build a multi-agent travel assistant for anime pilgrims using Gemini LLM

## Architecture Summary

### 7-Agent System
```
OrchestratorAgent (Main Controller)
├── SearchAgent (parallel) - Search nearby anime locations
├── WeatherAgent (parallel) - Query weather conditions
├── FilterAgent (sequential) - Apply user preferences
├── RouteAgent (sequential) - Optimize visit order
├── TransportAgent (parallel) - Find transportation
├── POIAgent (parallel) - Get business hours
└── Tools: MapGeneratorTool, PDFGeneratorTool
```

## Implementation Stages

### Stage 1: Foundation (Day 1 Morning - 20 pts)
**Goal**: Core infrastructure and configuration
**Success Criteria**: All tests pass, logging works, config loads

#### Tasks:
- [x] Environment configuration (.env, settings.py)
- [x] Logging setup with structlog
- [x] Pytest configuration and fixtures
- [x] Domain entities completion with tests
- [x] Base agent architecture
- [x] Session management service

**Tests**:
- Config loading and validation ✅
- Logger initialization ✅
- Domain entity validation ✅ (35 tests)
- Base agent architecture ✅ (22 tests)
- Session state management ✅ (21 tests)

**Status**: ✅ Complete (78 tests passing)

---

### Stage 2: External Integrations (Day 1 Afternoon - 20 pts)
**Goal**: API client implementations
**Success Criteria**: All API calls work with retry logic

#### Tasks:
- [x] Error handling and retry decorators
- [x] Rate limiting implementation
- [x] Response caching layer
- [x] Base HTTP client with all integrations
- [x] AnitabiClient with async support
- [x] GoogleMapsClient wrapper
- [x] Weather API client

**Tests**:
- Mock API responses ✅
- Retry logic verification ✅ (14 tests)
- Rate limit handling ✅ (14 tests)
- Cache hit/miss scenarios ✅ (15 tests)
- Base client integration ✅ (13 tests)
- AnitabiClient tests ✅ (12 tests, 85% coverage)
- GoogleMapsClient tests ✅ (12 tests, 78% coverage)
- WeatherClient tests ✅ (10 tests, 81% coverage)

**Status**: ✅ Complete (90 tests passing)
- All infrastructure components implemented
- Three API clients fully functional:
  - AnitabiClient: Search anime locations and pilgrimage points
  - GoogleMapsClient: Directions, geocoding, and place details
  - WeatherClient: Current weather and forecasts
- Comprehensive test coverage across all components

---

### Stage 3: Core Agents (Day 2 Morning - 40 pts)
**Goal**: Implement primary agents
**Success Criteria**: Each agent processes input/output correctly

#### Tasks:
- [x] SearchAgent - Anitabi API integration
- [x] WeatherAgent - Weather API queries
- [x] FilterAgent - Preference matching logic
- [x] POIAgent - Business hours queries
- [x] Agent communication protocol
- [x] Parallel execution support

**Tests**:
- SearchAgent: 15 tests passing ✅
- WeatherAgent: 16 tests passing ✅
- FilterAgent: 14 tests passing ✅
- POIAgent: 14 tests passing ✅

**Status**: ✅ Complete (59 agent tests passing)

---

### Stage 4: Advanced Agents (Day 2 Afternoon - 40 pts)
**Goal**: Complex agents and orchestration
**Success Criteria**: Full workflow executes end-to-end

#### Tasks:
- [x] RouteAgent - Google Maps Directions API route optimization
- [x] TransportAgent - Intelligent transport mode selection (walking/transit)
- [x] OrchestratorAgent - Main coordination (6-agent workflow)
- [x] State management between agents (PilgrimageSession)
- [x] Error aggregation (unified error handling)
- [x] Workflow optimization (parallel WeatherAgent execution)

**Tests**:
- RouteAgent: 15 tests passing ✅
- TransportAgent: 14 tests passing ✅
- OrchestratorAgent: 14 tests passing ✅
- Transport mode selection: ✅ Implemented (1.5km threshold)
- Orchestration flow: ✅ Complete (6-step workflow)
- State persistence: ✅ PilgrimageSession entity

**Status**: ✅ Complete (All 3 advanced agents implemented, 43 tests passing)

---

### Stage 5: Output Generation (Day 3 Morning - 20 pts)
**Goal**: Tools for maps and PDFs
**Success Criteria**: Generate interactive maps and PDF guides

#### Tasks:
- [x] MapGeneratorTool with Folium
- [x] PDFGeneratorTool with Playwright
- [x] HTML/Jinja2 templates
- [x] Asset management (CSS styling)
- [x] Export formatting (A4 PDF, interactive HTML maps)
- [x] Multi-language support (Chinese/Japanese bilingual)

**Tests**:
- MapGeneratorTool: 12 tests passing ✅
- PDFGeneratorTool: 14 tests passing ✅
- Map generation with markers ✅
- PDF layout rendering ✅
- Template variable injection ✅
- File output validation ✅
- Bilingual content rendering ✅

**Status**: ✅ Complete (26 tests passing)

---

### Stage 6: Production Ready (Day 3 Afternoon - 20 pts)
**Goal**: Deployment and monitoring
**Success Criteria**: Deployed to Google Agent Engine with monitoring

#### Tasks:
- [x] Integration tests suite (6 tests)
- [x] CI/CD configuration (GitHub Actions)
- [x] Health check endpoints
- [x] Google Agent Engine deployment (ADK integration)
- [x] Deployment automation scripts
- [x] Makefile convenience commands

**Tests**:
- End-to-end workflow tests ✅
- Health check verification ✅
- Complete workflow with mocks ✅
- Agent initialization tests ✅
- Map/PDF tool integration ✅

**Files Created**:
- `agent.py` - ADK root agent entry point
- `.github/workflows/ci.yml` - Auto-testing workflow
- `.github/workflows/deploy.yml` - Auto-deployment workflow
- `deploy/config.yaml` - Deployment configuration
- `deploy/deploy.py` - Deployment script
- `health.py` - Health check endpoints
- `tests/integration/test_e2e.py` - Integration tests
- `Makefile` - Convenience commands

**Status**: ✅ Complete (6 integration tests, CI/CD configured)

---

## Technical Implementation Details

### Priority 1: Core Requirements
- **TDD Approach**: Write test → Implement → Refactor
- **Domain Models**: Complete with Pydantic v2 validation
- **Async Patterns**: Throughout all I/O operations
- **Error Handling**: Comprehensive exception chains

### Priority 2: Agent System Design
- **Single Responsibility**: Each agent has one clear purpose
- **Contract-Based**: Pydantic models for input/output
- **Test Coverage**: Minimum 80% coverage required
- **State Management**: InMemorySessionService

### Priority 3: External Services
- **Retry Logic**: Exponential backoff with jitter
- **Rate Limiting**: Token bucket algorithm
- **Circuit Breaker**: Prevent cascade failures
- **Fallback Strategies**: Graceful degradation

### Priority 4: Observability
- **Structured Logging**: Using structlog
- **Distributed Tracing**: Request ID propagation
- **Metrics Collection**: Response times, error rates
- **Health Checks**: Liveness and readiness probes

## File Structure

```
Seichijunrei/
├── agents/
│   ├── __init__.py
│   ├── base.py                 # Abstract base agent
│   ├── search_agent.py          # Anitabi search
│   ├── filter_agent.py          # User preferences
│   ├── route_agent.py           # Route optimization
│   ├── transport_agent.py       # Transportation
│   ├── weather_agent.py         # Weather queries
│   ├── poi_agent.py            # Points of interest
│   └── orchestrator_agent.py    # Main coordinator
│
├── tools/
│   ├── __init__.py
│   ├── map_generator.py        # Folium maps
│   └── pdf_generator.py        # PDF reports
│
├── services/
│   ├── __init__.py
│   ├── session.py              # Session management
│   ├── cache.py                # Caching layer
│   └── retry.py                # Retry decorators
│
├── clients/
│   ├── __init__.py
│   ├── anitabi.py              # Anitabi API client
│   ├── google_maps.py          # Google Maps client
│   └── weather.py              # Weather API client
│
├── domain/
│   ├── __init__.py
│   └── entities.py             # Domain models (DONE)
│
├── config/
│   ├── __init__.py             # (DONE)
│   └── settings.py             # (DONE)
│
├── utils/
│   ├── __init__.py             # (DONE)
│   ├── logger.py               # (DONE)
│   ├── geo.py                  # Geo utilities
│   └── validators.py           # Input validators
│
├── templates/
│   ├── map.html                # Map template
│   └── pdf.html                # PDF template
│
└── tests/
    ├── conftest.py             # (DONE)
    ├── unit/
    │   ├── test_entities.py    # (DONE)
    │   ├── test_agents.py
    │   ├── test_tools.py
    │   └── test_clients.py
    └── integration/
        ├── test_workflow.py
        └── test_e2e.py
```

## Development Guidelines

### TDD Process (STRICT)
1. **Red**: Write failing test first
2. **Green**: Minimal code to pass
3. **Refactor**: Clean up with tests passing
4. **Commit**: Clear message with context

### Code Quality Standards
- **Every commit must**:
  - Compile successfully
  - Pass ALL tests
  - Include tests for new code
  - Follow project formatting

### When Stuck (Max 3 Attempts)
1. Document what failed
2. Research alternatives
3. Question fundamentals
4. Try different approach

### Git Commit Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: feat, fix, test, docs, refactor, style, chore

## Sprint Timeline

### Day 1 (Nov 20)
- **09:00-12:00**: Foundation setup ✅
- **12:00**: Sync point
- **12:00-17:00**: API clients
- **17:00**: Sync point
- **17:00-18:00**: Review & planning

### Day 2 (Nov 21)
- **09:00-12:00**: Core agents
- **12:00**: Sync point
- **12:00-17:00**: Advanced agents
- **17:00**: Sync point
- **17:00-18:00**: Integration testing

### Day 3 (Nov 22)
- **09:00-12:00**: Output tools
- **12:00**: Sync point
- **12:00-15:00**: Performance & polish
- **15:00-17:00**: Deployment prep
- **17:00**: Final review

## Success Metrics

### Functional Requirements
- [x] 7 agents implemented
- [x] 2+ custom tools (MapGeneratorTool, PDFGeneratorTool)
- [x] Session management
- [x] Observability (logging with structlog)
- [x] 80%+ test coverage (84.98% achieved)

### Performance Targets
- API response < 2s average
- Route optimization < 5s for 20 points
- PDF generation < 10s
- Concurrent user support: 100+

### ADK Scoring
- Multi-agent system: 30 pts ✓
- Tools usage: 20 pts ✓
- Sessions/Memory: 20 pts ✓
- Observability: 20 pts ✓
- Gemini bonus: 5 pts ✓
- Deployment bonus: 5 pts ✓
- **Total**: 100/100

## Risk Management

### High Risk
- **Google Maps API quotas**: Implement caching
- **Route optimization complexity**: Limit to 20 points
- **PDF generation time**: Use async processing

### Medium Risk
- **Weather API reliability**: Add fallback provider
- **Anitabi API changes**: Version lock API calls
- **Session state growth**: Implement TTL cleanup

### Mitigation Strategies
- Comprehensive error handling
- Fallback implementations
- Graceful degradation
- Circuit breakers

## Dependencies

### Core
- pydantic >= 2.0.0
- python-dotenv
- asyncio

### Async/HTTP
- aiohttp >= 3.9.0
- httpx >= 0.25.0

### APIs
- googlemaps >= 4.10.0
- google-cloud-storage >= 2.10.0

### Visualization
- folium >= 0.15.0
- playwright >= 1.40.0
- jinja2 >= 3.1.0

### Testing
- pytest >= 7.4.0
- pytest-asyncio
- pytest-cov
- pytest-mock

### Observability
- structlog >= 23.0.0
- rich >= 13.0.0

## Next Steps

1. **Immediate** (Next 2 hours):
   - Complete domain entity tests
   - Implement base agent class
   - Create API client stubs

2. **Today** (Day 1):
   - Finish all foundation tasks
   - Complete API integrations
   - Achieve 40 story points

3. **Tomorrow** (Day 2):
   - Implement all 7 agents
   - Integration testing
   - Achieve 40 more points

4. **Final Day** (Day 3):
   - Tools implementation
   - Deployment setup
   - Demo preparation

## Notes

- Follow TDD strictly - no exceptions
- Incremental commits after each test passes
- Document blockers immediately
- Ask for help after 3 failed attempts
- Maintain >80% test coverage throughout

---

*Last Updated: November 24, 2025 - 5:30 PM*
*Status: Stage 1 ✅ | Stage 2 ✅ | Stage 3 ✅ | Stage 4 ✅ | Stage 5 ✅ | Stage 6 ✅ | Total Tests: 288 passing*
*Agents: 7/7 implemented (SearchAgent, WeatherAgent, FilterAgent, POIAgent, RouteAgent, TransportAgent, OrchestratorAgent)*
*Tools: 2/2 implemented (MapGeneratorTool, PDFGeneratorTool)*
*Deployment: Google Agent Engine ready with CI/CD (GitHub Actions)*
*PROJECT COMPLETE! All stages implemented successfully. 🎉*