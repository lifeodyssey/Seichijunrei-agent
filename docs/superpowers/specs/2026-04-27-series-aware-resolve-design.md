# Series-Aware Resolve + Grouped Display

## Feature Summary

When a user searches for an anime with multiple seasons/versions, the system uses Anitabi
real point data to determine whether those versions share the same pilgrimage area. Same-area
versions are merged into grouped results; different-area versions trigger a rich clarify card
with cover, city, point count, and map thumbnail so the user can pick a travel destination.

**Who:** Anime fans planning seichi junrei trips (ja/zh/en).
**Problem:** Bangumi API returns multiple results for most popular anime (S1/S2/S3/movie).
Currently the agent clarifies every time, even when all versions share the same area.
Users get asked "which season?" when they just want "all 響け spots in Uji."

## Primary User Action

Search an anime name → get useful pilgrimage results without unnecessary clarification.

## Design Direction

"Pilgrimage planning studio" — the merged view should feel like opening a comprehensive
guide book organized by work, with tab-switchable perspectives. The clarify card should
feel like a travel destination picker — cover + location + scale at a glance.

---

## Three Response Modes

### Mode A: Merge (same area, <15km between all candidates)

**Trigger:** All Bangumi candidates' Anitabi center geo within 15km of each other.

**Examples:** 響け S1/S2/S3 (2-7.5km), 凉宫 忧郁/消失 (3.6km), ぼっち S1/S2 (3.1km)

**User sees:**
- Series title + total point count + city
- Tab bar: 「作品別」「エリア別」「作品×エリア」
- Default view: grouped by work, each group collapsible
- Each point card shows: screenshot, location name, **work label**, episode number
- Points >500 → paginate / lazy-load within each group

**Data flow:**
```
resolve_anime(title)
  → Bangumi search → N candidates
  → For each: Anitabi /bangumi/{id} → get city + center geo
  → Haversine all pairs < 15km → action: "merge"
  → search_bangumi with ALL bangumi_ids
  → Results grouped by bangumi_id in response
```

### Mode B: Clarify with context (different areas, >15km)

**Trigger:** Any pair of candidates' center geo >15km apart.

**Examples:** LL S1 vs Sunshine (92km), ゆるキャン S1 vs S3 (71km)

**User sees:** Rich clarify cards, each containing:
- Cover image (from Anitabi)
- Work title (ja + user locale translation)
- City name
- Point count (from Anitabi pointsLength)
- Map thumbnail showing point distribution (Maps)
- Tappable → triggers search for that specific work

**Data flow:**
```
resolve_anime(title)
  → Bangumi search → N candidates
  → For each: Anitabi /bangumi/{id} → city + center + pointsLength + cover
  → Any pair > 15km → action: "clarify"
  → Return enriched candidates with geo data
  → Agent calls clarify() with enriched options
```

### Mode C: Standard clarify (ambiguous query, no clear series)

**Trigger:** User query is too vague (e.g., "凉宫" matching both Haruhi AND unrelated anime),
or Bangumi returns results from genuinely different series.

**How to distinguish B vs C:** Use Bangumi v0 relation API (`/v0/subjects/{id}/subjects`)
to check if candidates are related (续集/相同世界观/番外篇/总集篇). If related → same series
(apply geo distance check → Mode A or B). If unrelated → Mode C.

**Behavior:** Same as current clarify with enrichment. No change needed.

---

## Threshold: 15km

Validated against real Anitabi data:

| Distance | Examples | Verdict |
|---|---|---|
| <10km | 響け S1↔S3 (7.5km), 凉宫 (3.6km), ぼっち (3.1km) | Merge |
| 10-15km | けいおん S1↔S2 (12.8km), LL S1↔虹ヶ咲 (12.7km) | Merge (same-day reachable) |
| >15km | LL↔Sunshine (92km), ゆるキャン S1↔S3 (71km) | Clarify |

---

## Backend Changes

### 1. Anitabi Gateway: add `get_bangumi_info()`

**File:** `backend/infrastructure/gateways/anitabi.py`

New method calling `/bangumi/{id}` (NOT `/lite`, NOT `/points/detail`).
Returns: `{id, title, cn, city, geo: [lat,lng], cover, pointsLength, color}`.
Cache: 24h (same as Bangumi gateway).

### 2. resolve_anime handler: series-aware logic

**File:** `backend/agents/handlers/resolve_anime.py`

After Bangumi search returns N candidates:
1. For each candidate, call `anitabi.get_bangumi_info(bangumi_id)` (parallel, cached)
2. Compute pairwise haversine distances
3. If ALL pairs <15km → return `{"action": "merge", "bangumi_ids": [...], "series_title": "...", "city": "...", "candidates": [...]}`
4. If ANY pair >15km → return `{"action": "clarify", "candidates": [...with geo/city/points/cover...]}`
5. If Anitabi unavailable → fallback to current behavior (return ambiguous to agent)

### 3. search_bangumi: support multi-ID merge

**File:** `backend/agents/handlers/search_bangumi.py` + `_base_search.py`

Accept `bangumi_ids: list[str]` (plural). Execute retrieval for each ID (parallel),
merge results. Each result row tagged with `bangumi_id` for grouping.

### 4. Response models: add grouping

**File:** `backend/agents/runtime_models.py`

```python
class ResultGroupModel(BaseModel):
    bangumi_id: str
    title: str
    title_cn: str = ""
    point_count: int = 0

class ResultsMetaModel(BaseModel):
    # existing fields...
    groups: list[ResultGroupModel] = Field(default_factory=list)  # NEW
```

### 5. ClarifyResponseModel: enriched candidates

Existing `ClarifyCandidateModel` gets new fields:
```python
class ClarifyCandidateModel(BaseModel):
    title: str
    cover_url: str = ""
    spot_count: int = 0
    city: str = ""
    # NEW:
    center_lat: float = 0.0
    center_lng: float = 0.0
    color: str = ""  # Anitabi theme color
```

### 6. Agent instructions update

Add to `_INSTRUCTIONS`:
```
### Series-aware search
- When resolve_anime returns action="merge", call search_bangumi with ALL
  bangumi_ids — do not clarify. The system has already verified these are
  in the same area.
- When resolve_anime returns action="clarify", call clarify() with the
  enriched candidates. Include city and point count in the question.
```

---

## Frontend Changes

### 1. PilgrimageGrid: grouped display

**File:** `frontend/components/generative/PilgrimageGrid.tsx`

When `data.results.groups` is non-empty:
- Render tab bar: 「作品別」「エリア別」「作品×エリア」
- Each group: collapsible section with title + point count badge
- Each point card: add work label badge (e.g., "S1", "S3")
- Pagination: lazy-load when group has >50 points

### 2. Clarify cards: map thumbnail

**File:** `frontend/components/generative/ClarifyCard.tsx` (or within existing clarify component)

When candidate has `center_lat/center_lng`:
- Render static Maps thumbnail (~150x100px) showing the center point
- Use candidate's `color` as marker color

### 3. Types update

**File:** `frontend/lib/types/domain.ts`

Add `groups` to search result type, add geo fields to clarify candidate type.

---

## Fallback / Error Handling

| Scenario | Behavior |
|---|---|
| Anitabi API down | Fallback: use Bangumi `city` field for rough comparison. Same city string → merge. |
| Anitabi returns no geo | Treat as unknown → standard clarify |
| Only 1 Bangumi candidate | No change — direct search as today |
| All candidates have 0 points | Still apply geo logic — user may want to know the area even without DB points |
| >5 candidates | Only check top 5 by relevance (Bangumi search order) |

---

## Eval Impact

The eval dataset (`agent_eval_v3.json`) already has multi-season/remake cases.
After this change:
- A1 (exact_db_api_ok) cases where agent currently over-clarifies → should now merge → IntentMatch improves
- B3 (ambiguous_series) cases for same-area → acceptable_stages should include `search_bangumi`
- New cases needed for: merge behavior, clarify-with-context behavior, fallback behavior

---

## Open Questions

1. Maps provider for static thumbnails — MapTiler (free tier) vs Mapbox vs OSM static?
2. Should merge search run all Anitabi detail fetches in parallel or sequential?
3. "作品×エリア" tab — what granularity for "area"? Sub-city neighborhoods or broader?
