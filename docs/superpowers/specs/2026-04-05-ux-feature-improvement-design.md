# Seichijunrei UX & Feature Improvement Plan

## Context

The core functionality and UI of the Seichijunrei anime pilgrimage app do not meet expectations. Search results are capped at 20, the planner never asks clarifying questions, images load slowly with no caching, point display is flat with no grouping, the route info panel is unreliable, the ResultPanel auto-opens intrusively, and the UI lacks polish (no component library). The repo root is also cluttered with legacy directories.

This plan addresses all issues in a phased approach, ordered by dependency.

---

## Execution Strategy: Git Worktrees

All phases execute in isolated git worktrees via `superpowers:using-git-worktrees` to keep `main` clean. Each phase gets its own branch, and work merges back to main via PR or fast-forward.

---

## Phase 0: Housekeeping (gstack + root cleanup + branch cleanup)

### 0a. Install gstack
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```
- Append `## gstack` section to `CLAUDE.md` listing available skills

### 0b. Clean root directory

**Delete empty shell directories** (only contain `__pycache__`):
- `agents/`, `clients/`, `config/`, `domain/`, `services/`, `utils/`

**Delete build artifacts:**
- `coverage.xml`, `htmlcov/`, `__pycache__/`

**Move working files under iteration docs:**
- `findings.md` → `docs/iterations/iter5/findings.md`
- `progress.md` → `docs/iterations/iter5/progress.md`
- `task_plan.md` → `docs/iterations/iter5/task_plan.md`

**Delete stray files:**
- `untitled.pen`

**Investigate before deleting** (may have unique content):
- `infrastructure/mcp_servers/` — check if referenced anywhere
- `interfaces/a2a_server/`, `interfaces/a2ui_web/` — check if used
- `application/ports/`, `application/use_cases/` — hexagonal architecture remnants
- `contracts/a2ui/` — A2UI contract definitions
- `tests/` — check if `backend/tests/` is the canonical copy
- `images/` — generated screenshots, likely safe to delete

**Update `.gitignore`:**
- Add `__pycache__/`, `htmlcov/`, `coverage.xml`, `.superpowers/`

### 0c. Clean up stale git branches

**Delete local branches** (all merged or abandoned, `main` is the only active branch):

Local branches to delete (30+):
- `codex/*` (8 branches): `refactor-backend`, `refactor-frontend`, `refactor-worker-ci`, `refactor-integrate`, `iter3-compact-selection-frontend`, `iter3-compact-selection-backend`, `iter2-persistence`, `iter2-persistence-frontend`, `greeting-onboarding`, `iter1-memory-sse`, `supabase-migration-workflow`, `frontend-ux-polish`, `iter3-compact-selection`
- `worktree-frontend-ux-polish`
- `integration/iter1`
- `spec-*` (7 branches): `spec-iter1-api`, `spec-iter3`, `spec-iter05-auth`, `spec-iter1-executor`, `spec-refactor`, `spec-frontend-polish`, `spec-task4-sql-agent`, `spec-task3-bangumi`, `spec-task5-retriever`, `spec-task2-supabase`
- `feature/*` (2): `feature/i18n`, `feature/frontend-generative-ui`
- `refactor/v2-architecture-plan`

**Delete remote branches** (stale remote-only branches):
- `origin/feat/*` (10+): `arch-foundation`, `infra-session-observability`, `a2ui-a2a-server`, `testing-contracts-coverage`, `planner-hybrid-router`, `stream3-a2ui`, `stream1-infra`, `stream2-location`, `intent-router`, `planner`, `a2ui-a2a`, `sprint1-foundation`
- `origin/fix/*`: `ci-black-formatting`, `code-review-security-and-bugs`
- `origin/backup/pre-restructure-20251130`
- `origin/dev`
- `origin/worktree-frontend-ux-polish`
- `origin/integration/iter1`
- `origin/feature/*`, `origin/refactor/*`

```bash
# Delete all local branches except main
git branch | grep -v '^\* main$' | grep -v '^  main$' | xargs git branch -D

# Delete stale remote branches
git remote prune origin
# Then delete remaining remote branches individually
```

**Files:** root directory, `.gitignore`, `CLAUDE.md`

---

## Phase 1: Remove 20-point limit + Geocoding (Backend)

### 1a. Remove hardcoded limit

- `backend/agents/sql_agent.py`: Remove `LIMIT {_DEFAULT_LIMIT}` from `_search_by_bangumi` and `_plan_route` queries. Keep a safety cap (500) for `_search_by_location` geo queries.
- `backend/agents/retriever.py:33`: Raise `_DEFAULT_GEO_LIMIT` from 50 → 200

### 1b. Google Geocoding gateway

- **New file:** `backend/infrastructure/gateways/geocoding.py`
  - `GoogleGeocodingGateway.geocode(address: str) -> tuple[float, float] | None`
  - Uses `GOOGLE_MAPS_API_KEY` from env
  - Calls `https://maps.googleapis.com/maps/api/geocode/json?address={address}&key={key}&region=jp&language=ja`
- `backend/agents/sql_agent.py`: In `resolve_location()`, add fallback to `GoogleGeocodingGateway` after `KNOWN_LOCATIONS` lookup fails
- `backend/config/settings.py`: Add `GOOGLE_MAPS_API_KEY` field if not present

**Verify:** `make check`, test geocoding with mocked HTTP response

---

## Phase 2: Smart Clarification (Backend + Frontend)

When ambiguous → ask; when clear → proceed directly.

### 2a. Backend model

- `backend/agents/models.py`: Add `CLARIFY = "clarify"` to `ToolName` enum

### 2b. Planner prompt

- `backend/agents/planner_agent.py`: Add clarification rules to system prompt:
  - Multiple anime title matches → emit `clarify(question, options=[title1, title2, ...])`
  - Route planning with no location context → emit `clarify("你现在在哪里？")`
  - Clear query → never clarify, just proceed
  - A plan has EITHER one clarify step OR tool steps, never both

### 2c. Executor handling

- `backend/agents/executor_agent.py`:
  - Add `_execute_clarify` handler: extract question + options, return as `StepResult`
  - Add `ToolName.CLARIFY: self._execute_clarify` to dispatch dict
  - Add clarify message templates to `_MESSAGES` for ja/zh/en

### 2d. Public API

- `backend/interfaces/public_api.py`: Add `"clarify": "Clarification"` to `_UI_MAP`

### 2e. Frontend

- `frontend/lib/types.ts`: Add `"clarify"` to Intent union
- `frontend/components/generative/registry.ts`: Map `"clarify"` → `"Clarification"`
- `frontend/components/generative/Clarification.tsx`: Render `options` as clickable buttons that send selection back as chat message via `onSuggest(option)`

**Verify:** Test with ambiguous anime title query, test with route planning without location

---

## Phase 3: Cloudflare Image Proxy (Worker + Backend)

### Why
Frontend currently loads images directly from `https://image.anitabi.cn/screenshot/...`. This is slow for users (no CDN edge caching, no compression), and if Anitabi's image server is slow or down, our images break. By proxying through our CF Worker, images get cached at Cloudflare's 300+ edge nodes worldwide.

### 3a. Worker route — `worker/worker.js`

The Worker currently has 3 routing paths (line 162-198):
1. `/healthz` → container (no auth)
2. `/v1/*` → container (with auth)
3. Everything else → `env.ASSETS` (static frontend)

We add a 4th path: `/img/*` → proxy to Anitabi image CDN (no auth, cached).

**Insert before the `/v1/` check (between line 171 and 172):**

```javascript
// ── Image proxy with CF edge caching ───────────────────────────────
if (pathname.startsWith("/img/")) {
  const imagePath = pathname.slice(5); // "/img/screenshot/abc.jpg" → "screenshot/abc.jpg"
  if (!imagePath || imagePath.includes("..")) {
    return new Response("Bad request", { status: 400 });
  }

  const upstreamUrl = `https://image.anitabi.cn/${imagePath}`;

  // 1. Check CF edge cache first
  const cacheKey = new Request(request.url, request);
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 2. Fetch from upstream
  const upstream = await fetch(upstreamUrl, {
    headers: { "User-Agent": "Seichijunrei/1.0" },
  });

  if (!upstream.ok) {
    // Pass through the error (404 etc.) but don't cache it
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg" },
    });
  }

  // 3. Build cacheable response with long TTL
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000"); // browser: 7d, edge: 30d
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie"); // strip upstream cookies

  const response = new Response(upstream.body, {
    status: 200,
    headers,
  });

  // 4. Store in edge cache (non-blocking)
  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
```

**Note:** The `fetch()` handler signature needs `ctx` — currently it only has `(request, env)`. Change to `async fetch(request, env, ctx)` to access `ctx.waitUntil`.

**Also update `shouldProxyToContainer`** (line 68) to exclude `/img/`:
```javascript
function shouldProxyToContainer(pathname) {
  return pathname === "/healthz" || pathname.startsWith("/v1/");
}
// No change needed — /img/ already doesn't match this, so it won't hit the container.
// But the function isn't actually used in the current code, so this is just for clarity.
```

**缓存机制说明 — 边缘缓存 vs 对象存储：**

这里用的是 **CF Cache API（边缘缓存）**，不是对象存储（R2）。区别：

| | CF 边缘缓存 (Cache API) | R2 对象存储 |
|---|---|---|
| **存储位置** | CF 全球 300+ 边缘节点的内存/SSD | CF 的中心化对象存储 |
| **持久性** | 临时的，可能被淘汰（LRU） | 永久的，直到主动删除 |
| **成本** | 免费（Worker 自带） | $0.015/GB/月 存储 + 请求费 |
| **适合** | 热点内容缓存加速 | 需要持久化的文件（用户上传等） |
| **命中率** | 热门图片高，冷门图片可能 miss | 100%（永久存储） |

**我们选边缘缓存的原因：**
- **零成本** — Worker Free plan 就包含 Cache API
- **自动地理分布** — 日本用户命中东京边缘，欧美用户命中当地边缘
- **图片源是 Anitabi** — 他们的服务器还在，只是慢。我们加速而非替代
- **即使缓存失效** — 下次请求会重新从 Anitabi 拉取并缓存，用户无感

**如果将来需要持久化（Anitabi 下线/图片消失），可升级到 R2：**
- 在 Worker 中 miss 时，先查 R2，再查 Anitabi
- 拉到图片后同时写入 R2 + 边缘缓存
- 但目前没必要，边缘缓存足够

**缓存 TTL：**
- `s-maxage=2592000` (30 天): CF 边缘节点缓存 30 天。同一边缘的所有用户直接命中。
- `max-age=604800` (7 天): 用户浏览器本地缓存 7 天。重复访问零网络请求。
- 巡礼截图是不变的（URL 对应固定图片），长 TTL 安全。

### 3b. Backend URL rewriting — `backend/agents/executor_agent.py`

Images are stored in DB as `points.image` column, projected as `screenshot_url` in SQL queries. Current values look like:
- Full URL: `https://image.anitabi.cn/screenshot/12345.jpg`
- Relative path: `screenshot/12345.jpg` (prefixed at gateway level in `anitabi.py:186`)

Add a helper function and call it at every output boundary:

```python
def _rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy."""
    for row in rows:
        url = row.get("screenshot_url")
        if not isinstance(url, str) or not url:
            continue
        if "image.anitabi.cn/" in url:
            row["screenshot_url"] = url.replace("https://image.anitabi.cn/", "/img/")
        elif url.startswith("screenshot/"):
            row["screenshot_url"] = f"/img/{url}"
    return rows
```

**Apply in these locations:**
1. `_build_query_payload()` (~line 458) — after building `retrieval` result, call `_rewrite_image_urls(retrieval["rows"])`
2. `_execute_plan_route()` / `_execute_plan_selected()` — rewrite `ordered_points` before returning

**Why rewrite at executor boundary (not SQL or gateway):**
- DB stores clean upstream URLs — useful for debugging, re-proxying, data exports
- If proxy is ever removed, only this one function changes
- Gateway layer stays pure (just fetches + normalizes data)

### 3c. Frontend — no changes needed

`PilgrimageGrid.tsx` already uses `<img src={point.screenshot_url}>`. Since we're rewriting the URL server-side from `https://image.anitabi.cn/screenshot/abc.jpg` to `/img/screenshot/abc.jpg`, the frontend just works — relative URLs resolve to the same CF Worker origin.

**Verify:**
1. `wrangler dev` locally → visit `/img/screenshot/` path → confirm image loads
2. Check response headers: `CF-Cache-Status: HIT` on second request
3. `make check` passes (backend URL rewriting doesn't break tests)
4. Deploy → verify images load faster from CF edge

---

## Phase 4: shadcn/ui + 京アニ Design (Frontend)

### 4a. Install shadcn/ui

In `frontend/` directory:
```bash
npx shadcn@latest init
```
- Configure: TypeScript, Tailwind v4, `app/globals.css`, `components/ui/`, no dark mode
- Map existing CSS variables (`--color-bg`, `--color-primary`, etc.) to shadcn expected variables in `globals.css`

### 4b. Install core components

```bash
npx shadcn@latest add button card tabs badge input scroll-area tooltip sheet
```

### 4c. Progressive component refactoring

Refactor components as they are touched in Phase 5. Key principle: keep 京吹夏季 palette, just use shadcn primitives for consistency and interaction quality.

**Files:** `frontend/components/ui/` (new), `frontend/components.json` (new), `frontend/app/globals.css`, `frontend/package.json`

**Verify:** `npm run build` succeeds, visual spot-check of refactored components

---

## Phase 5: Frontend Features (depends on Phase 4)

### 5a. Multi-dimensional point grouping (episode + area)

- `frontend/components/generative/PilgrimageGrid.tsx`:
  - Add shadcn `Tabs` at top: "按集数" / "按地区"
  - **By Episode:** Group `rows` by `point.episode`, render under `EP{n}` collapsible sections
  - **By Area:** Group by `point.origin` field (contains city/region from Anitabi data), fallback to lat/lng grid clustering
  - Extract `useGroupedPoints(rows, mode)` hook
  - Use shadcn `Badge` for episode/area labels, `Card` for point cards

### 5b. Route info panel fix

- `frontend/components/generative/RouteVisualization.tsx`:
  - Replace `absolute bottom-4 left-4` overlay with split layout: map (upper) + route list (lower)
  - Use shadcn `ScrollArea` for route list
  - Add collapse/expand toggle
  - Add **"在 Google Maps 中打开"** button that generates deep link:
    ```
    https://www.google.com/maps/dir/{lat1},{lng1}/{lat2},{lng2}/...
    ```

### 5c. ResultPanel click-to-open

- `frontend/components/layout/AppShell.tsx`:
  - Remove auto-open: change `activeMessage` to only set on explicit user click (remove `latestVisualResponseMessage` fallback at line ~114)
  - `const activeMessage = selectedVisualMessage ?? null;`

- `frontend/components/chat/MessageBubble.tsx`:
  - Add inline summary card for visual responses: anime title, point count, 2-3 thumbnail row, "查看详情" button
  - Button triggers `onActivate` to open ResultPanel

**Verify:** Full user flow test: search anime → see summary in chat → click to open panel → group by episode/area → plan route → see info panel → click "open in Google Maps"

---

## Phase Dependency & Execution Order

```
Phase 0 (housekeeping)     ──→  can start immediately
Phase 1 (limit + geocoding) ──→  can start immediately, parallel with 0
Phase 3 (image proxy)       ──→  can start immediately, parallel with 0 & 1
Phase 4 (shadcn/ui)         ──→  can start immediately, parallel with 0, 1, 3
Phase 2 (clarification)     ──→  after Phase 1 (needs geocoding for route clarification)
Phase 5 (frontend features) ──→  after Phase 4 (needs shadcn components)
```

Phases 0, 1, 3, 4 are fully independent — can run in parallel.

---

## Key Architectural Decisions

1. **`CLARIFY` as a ToolName** — reuses existing PlanStep/executor dispatch machinery, no new step types needed
2. **Image URL rewriting at executor boundary** — keeps DB data clean, proxy is opt-in
3. **Episode/area grouping in frontend** — backend already returns all points with episode data, grouping in a React hook is simpler
4. **Keep Leaflet** — zero cost, add "Open in Google Maps" deep link button for navigation handoff
5. **shadcn/ui as progressive enhancement** — install once, refactor components incrementally as touched

## Critical Files

| Area | Files |
|------|-------|
| Point limit | `backend/agents/sql_agent.py`, `backend/agents/retriever.py` |
| Geocoding | New: `backend/infrastructure/gateways/geocoding.py`, `backend/agents/sql_agent.py` |
| Clarification | `backend/agents/models.py`, `backend/agents/planner_agent.py`, `backend/agents/executor_agent.py`, `backend/interfaces/public_api.py`, `frontend/components/generative/Clarification.tsx`, `frontend/components/generative/registry.ts`, `frontend/lib/types.ts` |
| Image proxy | `worker/worker.js`, `backend/agents/executor_agent.py` |
| shadcn/ui | `frontend/app/globals.css`, `frontend/package.json`, new `frontend/components/ui/` |
| Point grouping | `frontend/components/generative/PilgrimageGrid.tsx` |
| Route panel | `frontend/components/generative/RouteVisualization.tsx` |
| ResultPanel | `frontend/components/layout/AppShell.tsx`, `frontend/components/chat/MessageBubble.tsx` |
| Root cleanup | Root directory, `.gitignore` |
