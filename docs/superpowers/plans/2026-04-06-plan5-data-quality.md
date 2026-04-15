# Plan 5: Data Quality — Anitabi Fixes + Geo Discovery + Unknown Places

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken `/near` endpoint dependency, add `get_bangumi_lite()` for correct titles, handle "不明" place names with reverse geocoding, and investigate the screenshot vs photo distinction in Anitabi data.

**Architecture:** The Anitabi API has only 2 documented endpoints: `/{id}/lite` and `/{id}/points/detail`. The undocumented `/near` endpoint returns null. We remove it and replace location-based discovery with PostGIS + human-in-the-loop (clarify). For "不明" places, we use a baked-in Japan prefecture bounding box table for frontend display.

**Tech Stack:** Python 3.11 / asyncpg / PostGIS (backend), TypeScript (frontend utility)

**Dependencies:** Plan 1 (ReAct loop) is needed for the CLARIFY flow in Task 25. Tasks 18, 19, 26 can run independently.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/clients/anitabi.py` | Modify | Remove `search_bangumi()`, add `get_bangumi_lite()` |
| `backend/agents/retriever.py` | Modify | Remove `/near` fallback, add clarify suggestion on sparse results |
| `backend/agents/executor_agent.py` | Modify | Handle clarify step |
| `frontend/lib/japanRegions.ts` | Create | Baked-in prefecture/city bounding box lookup |
| `frontend/components/generative/PilgrimageGrid.tsx` | Modify | Resolve "不明" names with japanRegions util |
| `backend/tests/unit/test_anitabi_client.py` | Modify | Update tests for removed/added methods |

---

### Task 26 (spec): Add get_bangumi_lite() + fix title bug

**Scope:** Bangumi titles are currently stored as the numeric ID (e.g., "115908" instead of "響け！ユーフォニアム"). The `/lite` endpoint has the real title, city, and cover image.

**Files:**

- Modify: `backend/clients/anitabi.py`
- Modify: `backend/agents/retriever.py`

- [ ] **Step 1: Add get_bangumi_lite() to AnitabiClient**

In `backend/clients/anitabi.py`:

```python
async def get_bangumi_lite(self, bangumi_id: str) -> dict[str, object]:
    """Fetch lightweight bangumi info: title, cn, city, cover, geo, zoom."""
    raw = await self.get(f"/{bangumi_id}/lite")
    return expect_json_object(raw, context="get_bangumi_lite")
```

The `/lite` endpoint returns:
```json
{
  "id": "115908",
  "cn": "吹响吧！上低音号",
  "title": "響け！ユーフォニアム",
  "city": "京都府宇治市",
  "cover": "https://...",
  "color": "#...",
  "geo": [135.xxx, 34.xxx],
  "zoom": 14,
  "pointsLength": 577,
  "imagesLength": 1200
}
```

- [ ] **Step 2: Wire into retriever write-through path**

In `backend/agents/retriever.py`, find `_write_through_bangumi_points()` (around line 251). Currently it only calls `get_bangumi_points()`. Add a parallel call to `get_bangumi_lite()`:

```python
async def _write_through_bangumi_points(
    self, bangumi_id: str
) -> list[dict[str, object]]:
    # Fetch lite info + points in parallel
    lite_task = self._anitabi.get_bangumi_lite(bangumi_id)
    points_task = self._anitabi.get_bangumi_points(bangumi_id)
    lite, points = await asyncio.gather(lite_task, points_task)

    # Upsert bangumi with correct title
    await self._db.upsert_bangumi(
        bangumi_id=bangumi_id,
        title=lite.get("title", bangumi_id),
        cn=lite.get("cn"),
        city=lite.get("city"),
        cover=lite.get("cover"),
    )

    # Insert points (existing logic)
    ...
```

- [ ] **Step 3: Update upsert_bangumi to accept new fields**

In `backend/infrastructure/supabase/client.py`, update the upsert to include `cn`, `city`, `cover`:

```python
async def upsert_bangumi(
    self,
    bangumi_id: str,
    title: str,
    cn: str | None = None,
    city: str | None = None,
    cover: str | None = None,
) -> None:
    await self.pool.execute(
        """INSERT INTO bangumi (bangumi_id, bangumi_title, cn, city, cover)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (bangumi_id)
           DO UPDATE SET bangumi_title = $2, cn = COALESCE($3, bangumi.cn),
                         city = COALESCE($4, bangumi.city),
                         cover = COALESCE($5, bangumi.cover)""",
        bangumi_id, title, cn, city, cover,
    )
```

- [ ] **Step 4: Migration for new columns (if needed)**

Check if `bangumi` table already has `cn`, `city`, `cover` columns. If not:

```sql
ALTER TABLE bangumi ADD COLUMN IF NOT EXISTS cn TEXT;
ALTER TABLE bangumi ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE bangumi ADD COLUMN IF NOT EXISTS cover TEXT;
```

- [ ] **Step 5: Verify**

```bash
make typecheck
make test
```

---

### Task 25 (spec): Remove broken /near + ReAct geo discovery with clarify

**Scope:** Remove the undocumented `/near` endpoint dependency. When location search returns few results, use the ReAct CLARIFY tool to ask the user which anime they're looking for.

**Files:**

- Modify: `backend/clients/anitabi.py`
- Modify: `backend/agents/retriever.py`
- Modify: `backend/agents/planner_agent.py` (prompt update)
- Modify: `backend/tests/unit/test_anitabi_client.py`

- [ ] **Step 1: Remove search_bangumi() from AnitabiClient**

In `backend/clients/anitabi.py`, remove the `search_bangumi()` method and related code (around lines 81-176). Also remove any `search_bangumi` references in tests.

- [ ] **Step 2: Update retriever GEO path**

In `backend/agents/retriever.py`, in the GEO strategy execution path:

```python
async def _execute_geo(
    self, lat: float, lng: float, radius: int
) -> RetrievalResult:
    # PostGIS query
    rows = await self._sql_agent.search_by_location(lat, lng, radius)

    if len(rows) >= 5:
        return RetrievalResult(rows=rows, strategy="geo")

    # Sparse results — suggest clarification
    # Look up known bangumi whose city matches this area
    known_bangumi = await self._db.get_bangumi_by_area(lat, lng)

    return RetrievalResult(
        rows=rows,
        strategy="geo",
        sparse=True,
        suggestions=known_bangumi,  # list of bangumi_id + title near this area
    )
```

- [ ] **Step 3: Add get_bangumi_by_area to client.py**

```python
async def get_bangumi_by_area(
    self, lat: float, lng: float, radius_m: int = 50000
) -> list[dict[str, object]]:
    """Find bangumi whose known points are near a location."""
    rows = await self.pool.fetch(
        """SELECT DISTINCT b.bangumi_id, b.bangumi_title, b.city
           FROM points p
           JOIN bangumi b ON p.bangumi_id = b.bangumi_id
           WHERE ST_DWithin(p.geo::geography, ST_Point($1, $2)::geography, $3)
           LIMIT 10""",
        lng, lat, radius_m,
    )
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Update planner prompt for clarify**

In `backend/agents/planner_agent.py`, add to the system prompt:

```
If search_nearby returns fewer than 5 results and the user did not specify an anime title,
emit a clarify step asking which anime they are looking for. Suggest anime titles known to
have spots near the searched location.
```

- [ ] **Step 5: Update tests**

Remove tests that mock `search_bangumi()`. Add tests for the new sparse-result path.

- [ ] **Step 6: Verify**

```bash
make test
make typecheck
```

---

### Task 18 (spec): Handle "不明" place names

**Scope:** Many Anitabi spots have `name = "不明"` (unknown). Display the city/area instead using a baked-in Japan region lookup table.

**Files:**

- Create: `frontend/lib/japanRegions.ts`
- Modify: `frontend/components/generative/PilgrimageGrid.tsx`

- [ ] **Step 1: Create Japan region lookup utility**

Create `frontend/lib/japanRegions.ts`:

```typescript
/**
 * Rough bounding-box lookup for Japan prefectures/cities.
 * Returns the nearest city name for a lat/lng pair.
 * No API calls — baked-in data for the ~20 most common pilgrimage areas.
 */

interface Region {
  name: string;
  nameJa: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const REGIONS: Region[] = [
  { name: "Uji, Kyoto", nameJa: "宇治市", minLat: 34.87, maxLat: 34.93, minLng: 135.78, maxLng: 135.84 },
  { name: "Kyoto City", nameJa: "京都市", minLat: 34.93, maxLat: 35.08, minLng: 135.68, maxLng: 135.82 },
  { name: "Tokyo 23 Wards", nameJa: "東京都区部", minLat: 35.62, maxLat: 35.82, minLng: 139.60, maxLng: 139.92 },
  { name: "Kamakura", nameJa: "鎌倉市", minLat: 35.28, maxLat: 35.35, minLng: 139.50, maxLng: 139.58 },
  { name: "Chichibu", nameJa: "秩父市", minLat: 35.93, maxLat: 36.05, minLng: 138.95, maxLng: 139.12 },
  { name: "Numazu", nameJa: "沼津市", minLat: 35.05, maxLat: 35.15, minLng: 138.83, maxLng: 138.93 },
  { name: "Takayama", nameJa: "高山市", minLat: 36.10, maxLat: 36.20, minLng: 137.20, maxLng: 137.30 },
  { name: "Hida", nameJa: "飛騨市", minLat: 36.20, maxLat: 36.35, minLng: 137.15, maxLng: 137.30 },
  { name: "Onomichi", nameJa: "尾道市", minLat: 34.38, maxLat: 34.45, minLng: 133.15, maxLng: 133.25 },
  { name: "Nikko", nameJa: "日光市", minLat: 36.72, maxLat: 36.80, minLng: 139.58, maxLng: 139.72 },
  { name: "Hakodate", nameJa: "函館市", minLat: 41.72, maxLat: 41.82, minLng: 140.70, maxLng: 140.82 },
  { name: "Otaru", nameJa: "小樽市", minLat: 43.17, maxLat: 43.22, minLng: 140.95, maxLng: 141.02 },
  { name: "Nara", nameJa: "奈良市", minLat: 34.65, maxLat: 34.72, minLng: 135.78, maxLng: 135.85 },
  { name: "Osaka", nameJa: "大阪市", minLat: 34.60, maxLat: 34.72, minLng: 135.45, maxLng: 135.55 },
  { name: "Kobe", nameJa: "神戸市", minLat: 34.65, maxLat: 34.72, minLng: 135.15, maxLng: 135.25 },
  // Add more as needed — covers ~80% of pilgrimage spots
];

export function resolveUnknownName(
  lat: number,
  lng: number,
  locale: "ja" | "zh" | "en" = "ja"
): string | null {
  for (const r of REGIONS) {
    if (lat >= r.minLat && lat <= r.maxLat && lng >= r.minLng && lng <= r.maxLng) {
      return locale === "en" ? r.name : r.nameJa;
    }
  }
  return null;
}
```

- [ ] **Step 2: Use in PilgrimageGrid**

In `frontend/components/generative/PilgrimageGrid.tsx`, when rendering spot names:

```tsx
import { resolveUnknownName } from "@/lib/japanRegions";

const displayName = (spot.name && spot.name !== "不明")
  ? spot.name
  : resolveUnknownName(spot.lat, spot.lng, locale) ?? spot.name;
```

- [ ] **Step 3: Verify**

Search for an anime with known "不明" spots (e.g., some spots in 響け！ユーフォニアム). They should now show "宇治市" instead of "不明".

---

### Task 19 (spec): Investigate Anitabi API screenshot vs photo (research)

- [ ] **Step 1: Examine Anitabi response schema**

Read `backend/infrastructure/gateways/anitabi.py` and check what fields come back in the points response.

```bash
grep -n "image\|photo\|screenshot\|source\|type\|category" backend/infrastructure/gateways/anitabi.py backend/clients/anitabi.py
```

- [ ] **Step 2: Sample raw API response**

If possible, make a test call to `https://api.anitabi.cn/bangumi/115908/points/detail` and inspect the JSON for any field distinguishing screenshots from user photos.

Look for fields like:

- `image_type` / `img_type`
- `source` / `src`
- `is_screenshot` / `screenshot`
- `category` / `cat`

- [ ] **Step 3: Document findings**

If field exists: add a badge to PilgrimageGrid photo cards ("截图" vs "实拍").

If field does NOT exist: document as known limitation. The images at Anitabi typically follow a pattern:

- Left image = anime screenshot
- Right image = real photo
- They're often paired side-by-side in the source data

Add a comment in the relevant file documenting this finding.

---

## Commit Strategy

1. `feat(anitabi): add get_bangumi_lite(), fix title bug`
2. `fix(anitabi): remove broken /near endpoint, add clarify on sparse geo results`
3. `feat(frontend): resolve "不明" place names with Japan region lookup`
4. `docs: Anitabi API screenshot/photo field investigation result`
