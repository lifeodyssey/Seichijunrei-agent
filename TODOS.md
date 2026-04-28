# TODOS

Tracked work items for Seichijunrei. Each entry includes context so someone
picking it up in 3 months understands the motivation.

---

## Route Planning

### Route Planner Agent — Full Version (Phase 3)
**Priority:** P2
**Spec:** `docs/superpowers/specs/2026-04-28-route-planning-v2.md`

Current state: `route_area_splitter.py` has a minimal agent with 2 tools
(`calculate_distance`, `cluster_points`). It works but relies on LLM world
knowledge for station names and transit info.

Full version needs:
- [ ] Station data source — Overpass API (OSM) or Japanese station CSV dataset
- [ ] `find_nearest_station` tool — given lat/lng, return nearest train station
- [ ] `get_transit_info` tool — Google Directions API or web_search for transit
- [ ] Frontend multi-area route display — tabs or collapsible sections per area
- [ ] Transit legs rendering — different color/style for walk vs transit segments

**Why:** Users described real pilgrimage pattern as "train to area → walk spots →
train to next area." Station-aware routing would make the route actually useful
for trip planning, not just a list of spots.

**Depends on:** Phase 2 (LLM area splitting) ✅ done

### `execute_selected_route` — keep or remove?
**Priority:** P3

User can manually select points from the grid and route them directly (no LLM).
Open question from eng review: is this UX pattern needed once LLM area splitting
exists? Adding 20-40s LLM latency to user-initiated route planning is the tradeoff.

**Needs:** Design review (`/plan-design-review`)

---

## Eval

### Eval V4 Redesign
**Priority:** P1
**Spec:** `docs/superpowers/specs/2026-04-27-series-aware-resolve-design.md` section "Eval V4 Redesign"

Current eval has critical scoring bugs:
- [ ] Error guard: count `report.failures` (task crashes vanish from scoring)
- [ ] Baseline: record and verify `evaluated_count`
- [ ] `retry_task` for transient API errors
- [ ] Evaluators return `bool` assertions (IntentMatch, ToolExecution)
- [ ] Partial credit for IntentMatch (related intent = 0.5)
- [ ] LLM Judge evaluator (response quality)
- [ ] Capability vs regression eval split
- [ ] pass@k consistency measurement
- [ ] Case-specific evaluators (per-case LLMJudge rubrics)
- [ ] Transcript review workflow

**Why:** GPT-5.5 via Univibe scored "100%" on 617 cases but actually only ran 2
(both `selected_route` cases that don't use LLM). The other 615 crashed and were
silently excluded from scoring.

### Route Planner Eval
**Priority:** P2
**Spec:** `docs/superpowers/specs/2026-04-28-route-planning-v2.md` section "Eval strategy"

- [ ] New dataset `route_planner_eval.json` (~20 cases)
- [ ] `AreaSplitQuality` evaluator (score)
- [ ] `StepTrace` evaluator (diagnostic score)
- [ ] `RouteQualityJudge` LLM evaluator
- [ ] Extend 93 existing plan_route cases with `expected_data_keys: ["areas"]`

---

## Agent Features

### Series-Aware Resolve
**Priority:** P2
**Spec:** `docs/superpowers/specs/2026-04-27-series-aware-resolve-design.md`

Bangumi API returns S1/S2/S3/movie for popular anime → agent over-clarifies.
Use Anitabi geo data to decide merge vs clarify:
- [ ] Anitabi gateway: `get_bangumi_info()`
- [ ] Haversine distance between candidates
- [ ] Merge mode (<15km) → search all IDs, group by work
- [ ] Clarify with context (>15km) → rich cards with cover+city+map
- [ ] Frontend: PilgrimageGrid grouped display, tab bar

### ResponseLocale Fix
**Priority:** P2

Eval shows 59.7% ResponseLocale — agent often replies in wrong language.
- [ ] Add output_validator language check → ModelRetry if wrong locale

---

## Frontend

### Cover Image Empty src
**Priority:** P3

React warning: "An empty string was passed to the src attribute." Cover URLs
from Bangumi API sometimes return `""` instead of `null`.
- [ ] `CandidateCard` / `PilgrimageGrid`: render `null` instead of `""` for src

### Locale Detection
**Priority:** P3

Frontend sends `locale: "en"` even when user types Chinese. `detect_language`
in `public_api.py` works server-side but frontend hardcodes locale from browser.
- [ ] Frontend: detect input language or use server-side detection result

---

## Infrastructure

### Logfire Plugin — Shell Token
**Priority:** P3

`logfire-session-capture` plugin needs `LOGFIRE_TOKEN` in shell environment.
Currently in `.env` but not in `~/.zshrc`.
- [ ] User needs to run: `echo 'export LOGFIRE_TOKEN="..."' >> ~/.zshrc`

### Translation Bugs
**Priority:** P2
**Memory:** `project_translation_bugs.md`

Translation eval 72.6% — 3 bug patterns:
- [ ] Bangumi API returns sequel/spinoff instead of main work (13 cases)
- [ ] Place names treated as anime titles (3 cases)
- [ ] Update translation_v1.json expected values for community names (6 cases)
