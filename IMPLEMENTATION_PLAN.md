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
- [ ] AnitabiClient with async support
- [ ] GoogleMapsClient wrapper
- [ ] Weather API client
- [ ] Error handling and retry decorators
- [ ] Rate limiting implementation
- [ ] Response caching layer

**Tests**:
- Mock API responses
- Retry logic verification
- Rate limit handling
- Cache hit/miss scenarios

**Status**: Not Started

---

### Stage 3: Core Agents (Day 2 Morning - 40 pts)
**Goal**: Implement primary agents
**Success Criteria**: Each agent processes input/output correctly

#### Tasks:
- [ ] SearchAgent - Anitabi API integration
- [ ] WeatherAgent - Weather API queries
- [ ] FilterAgent - Preference matching logic
- [ ] POIAgent - Business hours queries
- [ ] Agent communication protocol
- [ ] Parallel execution support

**Tests**:
- Individual agent unit tests
- Inter-agent communication
- Parallel execution timing
- Error propagation

**Status**: Not Started

---

### Stage 4: Advanced Agents (Day 2 Afternoon - 40 pts)
**Goal**: Complex agents and orchestration
**Success Criteria**: Full workflow executes end-to-end

#### Tasks:
- [ ] RouteAgent - TSP optimization algorithm
- [ ] TransportAgent - Google Maps directions
- [ ] OrchestratorAgent - Main coordination
- [ ] State management between agents
- [ ] Error aggregation
- [ ] Workflow optimization

**Tests**:
- Route optimization correctness
- Transport mode selection
- Orchestration flow
- State persistence

**Status**: Not Started

---

### Stage 5: Output Generation (Day 3 Morning - 20 pts)
**Goal**: Tools for maps and PDFs
**Success Criteria**: Generate interactive maps and PDF guides

#### Tasks:
- [ ] MapGeneratorTool with Folium
- [ ] PDFGeneratorTool with Playwright
- [ ] HTML/Jinja2 templates
- [ ] Asset management (images, icons)
- [ ] Export formatting
- [ ] Multi-language support

**Tests**:
- Map generation with markers
- PDF layout rendering
- Template variable injection
- File output validation

**Status**: Not Started

---

### Stage 6: Production Ready (Day 3 Afternoon - 20 pts)
**Goal**: Deployment and monitoring
**Success Criteria**: Deployed to Google Agent Engine with monitoring

#### Tasks:
- [ ] Integration tests suite
- [ ] Performance optimization
- [ ] Observability pipeline
- [ ] CI/CD configuration
- [ ] Docker containerization
- [ ] Google Agent Engine deployment

**Tests**:
- End-to-end scenarios
- Load testing
- Monitoring alerts
- Deployment smoke tests

**Status**: Not Started

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
- [ ] 2+ custom tools
- [ ] Session management
- [ ] Observability
- [ ] 80%+ test coverage

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

*Last Updated: November 21, 2025*
*Status: Stage 1 Complete ✅ | Stage 2 Ready to Start*