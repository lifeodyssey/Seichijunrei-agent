# Seichijunrei — Findings

Collected from full project review (2026-04-05).

## Product (/office-hours)

- User's pain: 4 tools (Anitabi + Google Maps + blogs + spreadsheet)
- Wedge: route optimization. Dream: photo overlay (native app)
- No community features. Tool, not platform.
- Cultural identity: 聖地巡礼 not "Pilgrimage"
- Competitors (Seichi app, JapanAnimeMaps, AnimeTrips): all databases, none intelligent
- Eureka: competitive advantage is intelligence on top of existing data, not more data

## Engineering (/plan-eng-review)

- Points table = 1 row per screenshot → cluster before routing
- 2-opt on Haversine is premature (Codex validated)
- test_executor_agent.py empty (0 bytes), 31 test gaps
- executor_agent.py at 44% coverage, geocoding.py at 24%
- route_optimizer + route_export should be separate modules
- Coordinate validation needed (0,0 / null island)
- Parallel lanes: backend + frontend independent

## Design (/plan-design-review)

- Initial: 4/10 → Final: 8/10 (7 decisions made)
- Map is hero, spot list collapsible
- shadcn Tabs for pacing, Sheet for spot drawer
- Mobile: vaul bottom sheet
- Re-optimize UX: fade + spinner
- slide-up-fade entrance animation

## Security (/cso)

- 0 CRITICAL, 0 HIGH, 3 MEDIUM
- CORS wildcard * (should be configurable)
- Dockerfile root user (add USER)
- .gstack/ not gitignored (fixed)
- SQL injection: safe (parameterized queries)
- No XSS vectors, no secret leaks

## Code Health (/health)

- 10/10 composite (lint + typecheck + tests all green)
- 281 tests, 73% coverage, 0 failures
- Missing: knip (dead code), shellcheck

## QA (/qa + /investigate)

- P1 BUG FIXED: /v1/conversations → 500 (conversations table missing)
  Root cause: migrations not applied to production DB

- Magic link auth works for headless browser QA
- Mobile layout not responsive on auth page
- English headline on Japanese-identity product
