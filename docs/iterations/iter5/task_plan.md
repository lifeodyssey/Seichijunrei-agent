# Seichijunrei — Task Plan

Comprehensive plan from full project review (2026-04-05).
Source: /office-hours + /plan-eng-review + /plan-design-review + /health + /cso + /qa + /investigate

---

## Active: feat/smart-route-planner (PR to main)

### Iter 1: Backend — route_optimizer + route_export + models

- [ ] `backend/agents/route_optimizer.py` (NEW): cluster_by_location, nearest_neighbor_sort, compute_dwell, build_timed_itinerary, validate_coordinates, haversine_distance
- [ ] `backend/agents/route_export.py` (NEW): build_google_maps_url, build_ics_calendar
- [ ] `backend/agents/models.py`: add TimedStop, TransitLeg, TimedItinerary, LocationCluster
- [ ] `backend/agents/executor_agent.py`: update `_execute_plan_route` + `_execute_plan_selected`

### Iter 2: Backend tests — full coverage

- [ ] `backend/tests/unit/test_route_optimizer.py` (NEW): property tests + golden cases + edge cases
- [ ] `backend/tests/unit/test_route_export.py` (NEW): URL format, .ics format, UTF-8

### Iter 3: Frontend — RoutePlannerWizard

- [ ] `frontend/components/generative/RoutePlannerWizard.tsx` (NEW): map hero + collapsible spot drawer + timeline + export
- [ ] `frontend/components/generative/registry.ts`: register wizard
- [ ] `frontend/lib/types.ts`: add TypeScript interfaces
- [ ] Mobile: vaul bottom sheet for timeline

### Iter 4: Integration + polish

- [ ] RouteVisualization.tsx backward compat
- [ ] Entrance animation (slide-up-fade)
- [ ] Re-optimization fade + spinner UX

### Iter 5: PR

- [ ] `make check` passes
- [ ] QA smoke test via scripts/qa_auth.py
- [ ] Create PR, CI passes

---

## Bundled fixes (same PR)

From /cso security audit:

- [ ] CORS: replace `*` with configurable origin in http_service.py:288
- [ ] Dockerfile: add `USER appuser` directive

From /qa:

- [x] DB: conversations + user_memory tables applied to production
- [x] .gitignore: add .env.test and .gstack/

---

## Backlog (separate PRs, after route planner ships)

### P2 — UX improvements

- [ ] Mobile responsive on auth page (landing page doesn't stack on narrow screens)
- [ ] Landing page headline: consider Japanese instead of "Anime Pilgrimage, The Journey"
- [ ] Remove "Internal beta · 2026" footer or replace with warmer text

### P2 — Testing infrastructure

- [ ] Encapsulate QA flow into `scripts/qa_smoke.sh` (magic link → login → test queries → screenshots)
- [ ] Add geocoding.py unit tests (24% coverage)

### P3 — Phase A.5 upgrades (post-validation)

- [ ] Google Maps Directions API for real walking times (replace Haversine when insufficient)
- [ ] Apple Maps export URL (`maps://` scheme for iOS)

### P3 — Phase B features (after real usage feedback)

- [ ] OR-Tools integration for TSP with time windows
- [ ] Sun position calculation (latitude + date → optimal photo timing)
- [ ] Multi-day trip support
- [ ] Transit API (Japan GTFS or Jorudan)
- [ ] Route variant comparison (2-3 alternatives)
- [ ] Last-train constraint

### P4 — Future

- [ ] Photo overlay / camera tool (native app, Phase 2)
- [ ] Agent API for B2B (Ctrip integration)
- [ ] Observability: enable OTel exporters in production

---

## Architecture reference

```
User: "響け 宇治 半日"
       │
       ▼
ReActPlannerAgent (LLM)
       │ → ExecutionPlan { steps: [resolve_anime, search_bangumi, plan_route] }
       ▼
ExecutorAgent._execute_plan_route()
       │
       ├── validate_coordinates(rows) → filter out (0,0)
       ├── cluster_by_location(rows, 50m) → LocationCluster[]
       ├── compute_dwell(cluster.photo_count, pacing) per cluster
       ├── nearest_neighbor_sort(clusters, origin)
       ├── build_timed_itinerary(clusters, start_datetime, pacing)
       ├── build_google_maps_url(itinerary.stops)
       ├── build_ics_calendar(itinerary)
       └── Return { ordered_points (compat), timed_itinerary (new), exports }
       ▼
Frontend: registry.ts → RoutePlannerWizard.tsx
       │
       ├── Map (hero, Leaflet)
       ├── Timeline sidebar (240px)
       ├── Spot drawer (shadcn Sheet, collapsible)
       └── Export buttons (Google Maps, Calendar)
```
