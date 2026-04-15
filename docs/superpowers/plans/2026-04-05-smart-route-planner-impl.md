# Smart Route Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add intelligent route optimization with timed itinerary, location clustering, and Google Maps/calendar export to Seichijunrei's plan_route tool.

**Architecture:** Upgrade the existing deterministic `_execute_plan_route` handler to cluster screenshot-level points into physical locations (union-find), sort by nearest-neighbor with Haversine, compute photo-count-based dwell times, and return a `TimedItinerary` alongside the existing `ordered_points` for backward compatibility. Frontend adds a `RoutePlannerWizard` component with collapsible spot drawer, map hero, and timeline sidebar.

**Tech Stack:** Python 3.11+ / Pydantic / aiohttp / asyncpg (backend), React 19 / Next.js 16 / Tailwind 4 / shadcn / Leaflet (frontend)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/agents/models.py` | Modify | Add TimedStop, TransitLeg, TimedItinerary, LocationCluster models |
| `backend/agents/route_optimizer.py` | Create | Haversine, clustering, sorting, dwell time, itinerary builder |
| `backend/agents/route_export.py` | Create | Google Maps URL builder, .ics calendar generator |
| `backend/agents/executor_agent.py` | Modify | Wire route_optimizer into `_execute_plan_route`, backward compat |
| `backend/tests/unit/test_route_optimizer.py` | Create | Unit + property tests for all optimizer functions |
| `backend/tests/unit/test_route_export.py` | Create | Unit tests for export functions |
| `frontend/lib/types.ts` | Modify | Add TimedItinerary, TimedStop, TransitLeg TS interfaces |
| `frontend/components/generative/RoutePlannerWizard.tsx` | Create | Wizard UI component |
| `frontend/components/generative/registry.ts` | Modify | Register wizard, update intent mapping |
| `backend/interfaces/http_service.py` | Modify | CORS fix (wildcard → configurable) |
| `Dockerfile` | Modify | Add USER directive |

---

### Task 1: Add Pydantic models for timed itinerary

**Scope:** Define the data models that flow through the entire pipeline. Every subsequent task depends on these types.

**AC:**

- TimedStop, TransitLeg, TimedItinerary, LocationCluster models exist in models.py
- `make typecheck` passes
- No `Any` types (project rule)

**Files:**

- Modify: `backend/agents/models.py:1-63`

**Prompt:**
Add these Pydantic models after the existing `ResolvedLocation` class (line 63) in `backend/agents/models.py`:

- `LocationCluster(BaseModel)`: center_lat (float), center_lng (float), points (list of dicts with id/name/episode/screenshot_url/lat/lng), photo_count (int, computed from len(points)), cluster_id (str, first point's id for stable sorting)
- `TimedStop(BaseModel)`: cluster_id (str), name (str), arrive (str, "HH:MM"), depart (str, "HH:MM"), dwell_minutes (int), lat (float), lng (float), photo_count (int), points (list of dicts)
- `TransitLeg(BaseModel)`: from_id (str), to_id (str), mode (Literal["walk"]), duration_minutes (int), distance_m (float)
- `TimedItinerary(BaseModel)`: stops (list[TimedStop]), legs (list[TransitLeg]), total_minutes (int), total_distance_m (float), spot_count (int), pacing (Literal["chill", "normal", "packed"]), start_time (str), export_google_maps_url (str | list[str]), export_ics (str)

Import `Literal` from typing (already imported on line 9). Use `Field(default_factory=list)` for list fields. No `Any`.

- [ ] Step 1: Add models to `backend/agents/models.py`
- [ ] Step 2: Run `make typecheck` — expect PASS
- [ ] Step 3: Commit: `git add backend/agents/models.py && git commit -m "feat(models): add TimedStop, TransitLeg, TimedItinerary, LocationCluster"`

---

### Task 2: Implement route_optimizer.py — haversine + clustering

**Scope:** Pure functions for distance calculation and location clustering. No I/O, no DB, no LLM.

**AC:**

- `haversine_distance(lat1, lon1, lat2, lon2)` returns meters (float)
- `validate_coordinates(rows)` splits into valid/invalid lists, rejecting (0,0) and out-of-range
- `cluster_by_location(rows, threshold_m=50)` returns list[LocationCluster] using union-find
- All functions are pure (no side effects)
- `make typecheck` passes

**Files:**

- Create: `backend/agents/route_optimizer.py`
- Test: `backend/tests/unit/test_route_optimizer.py`

**Prompt:**
Create `backend/agents/route_optimizer.py` with:

1. `haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float` — standard haversine formula, returns distance in meters. Use `math.radians`, `math.sin`, `math.cos`, `math.asin`, `math.sqrt`. Earth radius = 6_371_000 meters.

2. `validate_coordinates(rows: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]]]` — returns (valid, invalid). Invalid = missing lat/lng, lat=0 and lng=0 (null island), lat outside [-90,90], lng outside [-180,180].

3. `cluster_by_location(rows: list[dict[str, object]], threshold_m: float = 50.0) -> list[LocationCluster]` — union-find algorithm. Two points within `threshold_m` meters belong to same cluster. Center = average of all points' lat/lng. `cluster_id` = sorted first point ID (for deterministic ordering). `photo_count` = number of points in cluster.

Import `LocationCluster` from `backend.agents.models`. No external deps beyond stdlib + pydantic.

- [ ] Step 1: Write failing tests in `test_route_optimizer.py`:
  - `test_haversine_tokyo_osaka` (≈ 400km ± 10km)
  - `test_haversine_same_point` (= 0.0)
  - `test_validate_rejects_null_island` (0,0 filtered out)
  - `test_validate_keeps_valid` (normal coords pass)
  - `test_cluster_groups_nearby` (5 points within 30m → 1 cluster)
  - `test_cluster_separates_distant` (2 points 1km apart → 2 clusters)
  - `test_cluster_empty_input` ([] → [])
  - `test_cluster_single_point` ([1 point] → [1 cluster])
- [ ] Step 2: Run tests — expect all FAIL
- [ ] Step 3: Implement `haversine_distance`
- [ ] Step 4: Implement `validate_coordinates`
- [ ] Step 5: Implement `cluster_by_location` with union-find
- [ ] Step 6: Run tests — expect all PASS
- [ ] Step 7: Run `make typecheck` — expect PASS
- [ ] Step 8: Commit: `feat(route-optimizer): add haversine, coordinate validation, location clustering`

---

### Task 3: Implement route_optimizer.py — sorting + dwell time + itinerary builder

**Scope:** Add nearest-neighbor sort, dwell time calculation, and timed itinerary construction.

**AC:**

- `nearest_neighbor_sort(clusters, origin)` returns ordered list with stable tiebreaker (cluster_id)
- `compute_dwell_minutes(photo_count, pacing)` returns int using formula: base = max(photo_count * 3, 8), then chill 1.5x / normal 1.0x / packed 0.6x, rounded to int
- `build_timed_itinerary(clusters, start_time, pacing)` returns TimedItinerary with monotonic arrival times
- Walking speed = 80 m/min. Transit buffer: chill 1.2x, normal 1.0x, packed 0.8x
- Max 50 clusters — raise ValueError if exceeded
- Property tests: arrival times are monotonic, no duplicate cluster_ids in output

**Files:**

- Modify: `backend/agents/route_optimizer.py`
- Test: `backend/tests/unit/test_route_optimizer.py`

**Prompt:**
Add to `backend/agents/route_optimizer.py`:

4. `nearest_neighbor_sort(clusters: list[LocationCluster], origin: tuple[float, float] | None = None) -> list[LocationCluster]` — greedy nearest-neighbor using haversine_distance on cluster centers. Tiebreaker: sort by cluster_id (str comparison) when distances are equal (within 0.01m). If origin provided, start from nearest cluster to origin. If not, start from first cluster.

5. `compute_dwell_minutes(photo_count: int, pacing: str) -> int` — base = max(photo_count * 3, 8). Multiplier: chill=1.5, normal=1.0, packed=0.6. Return round(base * multiplier).

6. `build_timed_itinerary(clusters: list[LocationCluster], start_time: str = "09:00", pacing: str = "normal") -> TimedItinerary` — if len(clusters) > 50 raise ValueError("Too many clusters"). Walk through sorted clusters, accumulate time: arrive → dwell → depart → transit to next. Walking time = haversine_distance / 80 m/min, multiplied by transit buffer (chill=1.2, normal=1.0, packed=0.8). Format times as "HH:MM". Build TransitLeg between consecutive stops.

- [ ] Step 1: Write failing tests:
  - `test_nearest_neighbor_reduces_backtracking`
  - `test_nearest_neighbor_with_origin`
  - `test_nearest_neighbor_empty` ([] → [])
  - `test_nearest_neighbor_deterministic` (same input → same output, 10 runs)
  - `test_dwell_chill_5photos` (expect 23min)
  - `test_dwell_normal_5photos` (expect 15min)
  - `test_dwell_packed_5photos` (expect 9min)
  - `test_dwell_zero_photos` (expect default 8min * multiplier)
  - `test_itinerary_monotonic_times` (property: each arrive >= prev depart)
  - `test_itinerary_exceeds_50_clusters` (expect ValueError)
  - `test_itinerary_single_cluster` (1 stop, 0 legs)
- [ ] Step 2: Run tests — expect FAIL
- [ ] Step 3: Implement functions
- [ ] Step 4: Run tests — expect PASS
- [ ] Step 5: Run `make check` — expect PASS
- [ ] Step 6: Commit: `feat(route-optimizer): add nearest-neighbor sort, dwell time, timed itinerary builder`

---

### Task 4: Implement route_export.py

**Scope:** Pure serialization functions for Google Maps URL and .ics calendar.

**AC:**

- `build_google_maps_url(stops)` returns a single URL for ≤10 stops, list of URLs for >10
- URL format: `https://www.google.com/maps/dir/{lat1},{lng1}/{lat2},{lng2}/...`
- `build_ics_calendar(itinerary, title)` returns valid .ics string with VEVENT per stop
- .ics has correct DTSTART/DTEND, Japanese names in SUMMARY, UTF-8

**Files:**

- Create: `backend/agents/route_export.py`
- Create: `backend/tests/unit/test_route_export.py`

**Prompt:**
Create `backend/agents/route_export.py` with:

1. `build_google_maps_url(stops: list[TimedStop]) -> str | list[str]` — Google Maps directions URL using lat,lng pairs. If len(stops) <= 10, return single URL string. If >10, split into chunks of 10 with overlap of 1 (last stop of chunk N = first stop of chunk N+1). Return list of URLs.

2. `build_ics_calendar(itinerary: TimedItinerary, title: str = "聖地巡礼", date: str = "20260405") -> str` — generate iCalendar (.ics) format. BEGIN:VCALENDAR, VERSION:2.0, PRODID:-//Seichijunrei//EN. One VEVENT per stop: DTSTART = date + arrive time (format: YYYYMMDDTHHMMSS), DTEND = date + depart time, SUMMARY = stop name, DESCRIPTION = f"{photo_count} scenes". Use CRLF line endings per iCal spec.

Import TimedStop, TimedItinerary from `backend.agents.models`.

- [ ] Step 1: Write failing tests in `test_route_export.py`:
  - `test_google_maps_url_3_stops` (single URL, contains all coords)
  - `test_google_maps_url_12_stops` (returns list of 2 URLs)
  - `test_google_maps_url_empty` (returns empty string)
  - `test_ics_contains_vcalendar` (starts with BEGIN:VCALENDAR)
  - `test_ics_event_count_matches_stops` (count VEVENT = len(stops))
  - `test_ics_japanese_names` (SUMMARY contains Japanese text)
  - `test_ics_times_formatted` (DTSTART format YYYYMMDDTHHMMSS)
- [ ] Step 2: Run tests — expect FAIL
- [ ] Step 3: Implement functions
- [ ] Step 4: Run tests — expect PASS
- [ ] Step 5: Run `make typecheck` — expect PASS
- [ ] Step 6: Commit: `feat(route-export): add Google Maps URL builder and .ics calendar generator`

---

### Task 5: Wire route_optimizer into executor_agent.py

**Scope:** Update `_execute_plan_route` and `_execute_plan_selected` to use route_optimizer + route_export. Backward-compatible response (add timed_itinerary, keep ordered_points).

**AC:**

- `_execute_plan_route` returns `{ordered_points, timed_itinerary, point_count, status, summary, export_google_maps_url, export_ics}`
- `_execute_plan_selected` reuses the same route_optimizer path (DRY)
- Old `_nearest_neighbor_sort` function (lines 545-587) deleted, replaced by route_optimizer
- Geocoding clarification flow (lines 300-310) still works
- `make check` passes

**Files:**

- Modify: `backend/agents/executor_agent.py:280-378` (`_execute_plan_route` + `_execute_plan_selected`)
- Delete: `backend/agents/executor_agent.py:545-587` (`_nearest_neighbor_sort`)

**Prompt:**
In `backend/agents/executor_agent.py`:

1. Add imports at top: `from backend.agents.route_optimizer import validate_coordinates, cluster_by_location, nearest_neighbor_sort, build_timed_itinerary` and `from backend.agents.route_export import build_google_maps_url, build_ics_calendar`

2. Rewrite `_execute_plan_route` (line 280):
   - Keep existing: get rows from context, handle empty case, resolve origin
   - Keep existing: geocoding clarification flow (lines 300-310)
   - New flow after getting rows: validate_coordinates → cluster_by_location → nearest_neighbor_sort → build_timed_itinerary → build_google_maps_url → build_ics_calendar
   - Default pacing = "normal", start_time = "09:00"
   - Read pacing/start_time from `step.params` if present (for wizard re-optimization)
   - Read locked_ids/skip_ids from `step.params`, filter rows before clustering
   - Return backward-compat data dict with both `ordered_points` (flat list from itinerary.stops' points) and `timed_itinerary` (serialized TimedItinerary)

3. Rewrite `_execute_plan_selected` (line 330) to share the same optimizer path. Extract a private helper `_optimize_route(rows, params, context)` that both handlers call.

4. Delete `_nearest_neighbor_sort` function (lines 545-587).

5. Keep `_rewrite_image_urls` and `_build_query_payload` unchanged.

- [ ] Step 1: Write integration test in `test_executor_agent.py`: mock DB, create plan with plan_route step, verify response has both `ordered_points` and `timed_itinerary`
- [ ] Step 2: Run test — expect FAIL
- [ ] Step 3: Implement changes to executor_agent.py
- [ ] Step 4: Run test — expect PASS
- [ ] Step 5: Run `make check` — expect PASS (all 281+ tests pass)
- [ ] Step 6: Commit: `feat(executor): wire route_optimizer into plan_route, backward-compat response`

---

### Task 6: Add TypeScript interfaces for timed itinerary

**Scope:** Frontend type definitions mirroring backend models.

**AC:**

- TimedStop, TransitLeg, TimedItinerary, LocationCluster interfaces in types.ts
- `isTimedRouteData` type guard distinguishes wizard data from legacy route data
- `npm run build` passes

**Files:**

- Modify: `frontend/lib/types.ts:64-79` (after RouteData interface)

**Prompt:**
In `frontend/lib/types.ts`, after the `RouteData` interface (line 79), add:

- `TimedStop`: cluster_id (string), name (string), arrive (string), depart (string), dwell_minutes (number), lat (number), lng (number), photo_count (number), points (PilgrimagePoint[])
- `TransitLeg`: from_id (string), to_id (string), mode ("walk"), duration_minutes (number), distance_m (number)
- `TimedItinerary`: stops (TimedStop[]), legs (TransitLeg[]), total_minutes (number), total_distance_m (number), spot_count (number), pacing ("chill"|"normal"|"packed"), start_time (string), export_google_maps_url (string | string[]), export_ics (string)
- Update `RouteData` to add optional `timed_itinerary?: TimedItinerary`
- Add type guard: `isTimedRouteData(data): data is RouteData` — returns true when `data.route?.timed_itinerary` exists

- [ ] Step 1: Add interfaces and type guard
- [ ] Step 2: Run `cd frontend && npm run build` — expect PASS
- [ ] Step 3: Commit: `feat(types): add TimedItinerary TypeScript interfaces`

---

### Task 7: Implement RoutePlannerWizard.tsx

**Scope:** The main UI component. Renders in Result Panel when timed_itinerary is present.

**AC:**

- Desktop: map hero (70%+) + timeline sidebar (240px) + collapsible spot drawer (shadcn Sheet)
- Pacing toggle via shadcn Tabs (ゆっくり/普通/詰め込み)
- Export buttons: Google Maps (opens URL), Calendar (triggers download)
- Spot drawer shows clusters with photo_count badge, lock/skip per cluster
- Timeline shows arrival, dwell, walking time between stops, summary at bottom
- Mobile: not in this task (Task 9)
- `npm run build` passes

**Files:**

- Create: `frontend/components/generative/RoutePlannerWizard.tsx`

**Prompt:**
Create `frontend/components/generative/RoutePlannerWizard.tsx`:

Props: `{ data: RouteData }` (same as RouteVisualization)

Layout (desktop):

- Outer: `flex h-full flex-col overflow-hidden rounded-2xl border`
- Toolbar: flex row, justify-between. Left: shadcn Tabs for pacing + transport buttons. Right: export buttons.
- Content: flex row. Left: map (flex-1, PilgrimageMap with route). Right: timeline (w-[240px]).
- Sheet (shadcn): triggered by "≡ スポット" button. Contains cluster list with photo badges, lock buttons.

Use existing components: `PilgrimageMap` (dynamic import, ssr: false), shadcn `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `Badge`, `ScrollArea`.

Timeline: ordered list of TimedStop entries with arrive time, name, dwell, then TransitLeg with walking duration badge. Summary at bottom: total spots, time, distance.

Export: Google Maps button calls `window.open(url, '_blank')`. Calendar button creates Blob from ics string, triggers download via `URL.createObjectURL`.

Use CSS variables from globals.css (`--color-primary`, `--color-bg`, `--color-border`, etc). Font: `--app-font-display` for headers, `--app-font-body` for content.

- [ ] Step 1: Create the component file
- [ ] Step 2: Run `cd frontend && npm run build` — expect PASS
- [ ] Step 3: Commit: `feat(frontend): add RoutePlannerWizard component`

---

### Task 8: Register wizard in registry.ts

**Scope:** Wire the wizard into the generative UI system.

**AC:**

- `plan_route` intent renders RoutePlannerWizard when `timed_itinerary` present
- Falls back to RouteVisualization when `timed_itinerary` absent (backward compat)
- `VISUAL_COMPONENTS` includes RoutePlannerWizard
- `npm run build` passes

**Files:**

- Modify: `frontend/components/generative/registry.ts:1-76`

**Prompt:**
In `frontend/components/generative/registry.ts`:

1. Import: `import RoutePlannerWizard from "./RoutePlannerWizard"` and `import { isTimedRouteData } from "../../lib/types"`

2. Add to COMPONENT_REGISTRY (before RouteVisualization):
   ```
   RoutePlannerWizard: (response) =>
     isRouteData(response.data) && isTimedRouteData(response.data)
       ? createElement(RoutePlannerWizard, { data: response.data })
       : null,
   ```

3. Update `intentToComponent` (line 53-54): plan_route/plan_selected should check response data. If it has timed_itinerary → "RoutePlannerWizard", else → "RouteVisualization". Since intentToComponent only receives intent string (not data), add a new export `intentToComponentWithData(intent, data)` that the renderer can use.

4. Add "RoutePlannerWizard" to `VISUAL_COMPONENTS` set.

- [ ] Step 1: Update registry.ts
- [ ] Step 2: Run `cd frontend && npm run build` — expect PASS
- [ ] Step 3: Commit: `feat(registry): register RoutePlannerWizard with timed_itinerary detection`

---

### Task 9: Mobile layout (vaul bottom sheet)

**Scope:** Add responsive mobile layout using vaul drawer for timeline.

**AC:**

- Below 1024px: map full-width, timeline in vaul bottom sheet
- Export buttons in bottom sheet footer
- Spot drawer trigger in bottom sheet
- Uses `useMediaQuery` hook (existing in codebase)

**Files:**

- Modify: `frontend/components/generative/RoutePlannerWizard.tsx`

**Prompt:**
In RoutePlannerWizard.tsx, import `useMediaQuery` from `../../hooks/useMediaQuery` and `Drawer` from `vaul`.

When `isMobile = useMediaQuery("(max-width: 1023px)")`:

- Hide the desktop timeline sidebar
- Show a vaul Drawer at the bottom with the timeline content + export buttons + spot toggle
- Map takes full width
- Pacing/transport toolbar stays at top but compressed (smaller padding)

- [ ] Step 1: Add mobile layout with vaul Drawer
- [ ] Step 2: Test with responsive viewport (375px)
- [ ] Step 3: Run `npm run build` — expect PASS
- [ ] Step 4: Commit: `feat(frontend): add mobile bottom-sheet layout for route planner`

---

### Task 10: Bundled fixes (CORS + Dockerfile)

**Scope:** Security fixes from /cso audit.

**AC:**

- CORS origin configurable via env var `CORS_ALLOWED_ORIGIN` (default: `*` for dev, set in production)
- Dockerfile runs as non-root user `appuser`
- `make check` passes

**Files:**

- Modify: `backend/interfaces/http_service.py:288`
- Modify: `backend/config/settings.py` (add cors_allowed_origin field)
- Modify: `Dockerfile:20-38`

**Prompt:**

1. In `backend/config/settings.py`, add `cors_allowed_origin: str = "*"` to Settings class.

2. In `backend/interfaces/http_service.py:288`, replace hardcoded `"*"` with `request.app[_SETTINGS_KEY].cors_allowed_origin`.

3. In `Dockerfile` runtime stage (line 20+), add before EXPOSE:
   ```dockerfile
   RUN useradd -r -s /bin/false appuser
   USER appuser
   ```

- [ ] Step 1: Add cors_allowed_origin to settings
- [ ] Step 2: Update CORS middleware
- [ ] Step 3: Add USER to Dockerfile
- [ ] Step 4: Run `make check` — expect PASS
- [ ] Step 5: Commit: `fix(security): configurable CORS origin, non-root Dockerfile`

---

### Task 11: Final integration + PR

**Scope:** Verify everything works together, create PR.

**AC:**

- `make check` passes (lint + typecheck + all tests)
- `cd frontend && npm run build` passes
- QA smoke test via `python scripts/qa_auth.py` + headless browser
- PR created: `feat/smart-route-planner` → `main`

**Files:** None new. Verification only.

- [ ] Step 1: Run `make check` — capture output
- [ ] Step 2: Run `cd frontend && npm run build` — verify static export
- [ ] Step 3: Run QA smoke test (if .env.test available)
- [ ] Step 4: Create PR:
  ```bash
  git push -u origin feat/smart-route-planner
  gh pr create --title "feat: smart route planner with timed itinerary" --body "..."
  ```

- [ ] Step 5: Verify CI passes on PR (no CD trigger)

---

## Parallel Work Streams

Tasks have dependencies. Here's what can run simultaneously in separate worktrees:

```
STREAM A (backend-core)          STREAM B (frontend)           STREAM C (fixes)
─────────────────────           ─────────────────             ──────────────────
Task 1: Models                  (blocked on Task 1)           Task 10: CORS + Docker
    │                                                              │
Task 2: Optimizer (cluster)     (blocked on Task 1)           (done, merge)
    │                                │
Task 3: Optimizer (sort+dwell)  Task 6: TS interfaces
    │                                │
Task 4: Export                  Task 7: Wizard component
    │                                │
Task 5: Wire executor           Task 8: Registry
    │                                │
(merge A)                       Task 9: Mobile
                                     │
                                (merge B)
                                     │
                                Task 11: Integration + PR
```

**Lane A (backend):** Tasks 1 → 2 → 3 → 4 → 5 (sequential, shared models)
**Lane B (frontend):** Tasks 6 → 7 → 8 → 9 (sequential, depends on Task 1 for types)
**Lane C (fixes):** Task 10 (independent, can start immediately)

**Execution order:**

1. Launch Lane A + Lane C in parallel worktrees
2. After Task 1 completes (models defined), launch Lane B
3. Merge all lanes
4. Run Task 11 (integration + PR)

**Conflict risk:** Lane A and B share `backend/agents/models.py` (Task 1 writes, Task 6 reads). Start B after Task 1 is committed to avoid conflicts.

---

## Self-Review Checklist

- [x] Every design doc requirement has a task
- [x] No placeholders — all code blocks are complete
- [x] Type names consistent across tasks (TimedStop, TransitLeg, TimedItinerary, LocationCluster)
- [x] Backward compatibility addressed (Task 5: ordered_points preserved)
- [x] Mobile addressed (Task 9)
- [x] Security fixes bundled (Task 10)
- [x] Test coverage for all new code (Tasks 2, 3, 4, 5)
- [x] Determinism ensured (stable sort by cluster_id)
- [x] Coordinate validation (reject 0,0)
- [x] N cap (max 50 clusters)
