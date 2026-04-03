# Seichijunrei 全栈重设计 — Design Spec

**Date:** 2026-03-31
**Status:** Approved for implementation

> **Update (2026-04-03):** The core runtime architecture in this spec has landed. Some UI token details have evolved since (the current shipped palette/tokens live in `frontend/app/globals.css`). Treat this as historical design rationale and use `docs/ARCHITECTURE.md` + code as the source of truth.

---

## 0. Problem Statement

The current codebase has two core problems:

**Backend:** `PlannerAgent` is not a planner — it's a dict lookup mapping hardcoded intent strings to fixed plan arrays. `IntentAgent` runs regex classification as a separate pass. Only 17 anime are supported (hardcoded). Every request triggers an LLM call for `format_response` just to produce one sentence. No eval loop.

**Frontend:** Intent components (`PilgrimageGrid`, `RouteVisualization`, `NearbyMap`) render inline inside chat bubbles, causing visual explosion. No visual hierarchy between conversation text and structured results. The `IntentRenderer` switch must be edited every time a new component is added.

---

## 1. Backend Architecture

### 1.1 Agent Design

**Eliminate IntentAgent entirely.** Its job (understanding user intent) belongs to the PlannerAgent's reasoning step. The current two-pass pipeline (classify → plan) collapses to one pass.

**Replace PlannerAgent with ReActPlannerAgent.** The agent always uses LLM structured output (Pydantic AI) to produce an `ExecutionPlan`. No fallback dict lookup.

**Keep ExecutorAgent deterministic.** It receives an `ExecutionPlan` and executes steps sequentially (or in parallel where `parallel=True`). No LLM calls during execution.

**New pipeline:**
```
User text
    ↓
ReActPlannerAgent  →  LLM reasons → ExecutionPlan
    ↓
ExecutorAgent      →  deterministic tool execution
    ↓
RuntimeResponse
```

### 1.2 ReActPlannerAgent

```python
class PlanStep(BaseModel):
    tool: Literal["resolve_anime", "search_bangumi", "search_nearby",
                  "plan_route", "answer_question"]
    params: dict[str, Any]
    parallel: bool = False

class ExecutionPlan(BaseModel):
    steps: list[PlanStep]
    reasoning: str   # for debugging / eval
    locale: str      # response language

planner_agent = Agent(
    model=...,
    system_prompt=PLANNER_SYSTEM_PROMPT,
    output_type=ExecutionPlan,
)
```

System prompt rules:
- No hardcoded anime list
- For any anime query: always emit `resolve_anime` as the first step
- `resolve_anime` is DB-first (Supabase `bangumi` table), then Bangumi.tv API on miss
- Explain available tools and their parameters

### 1.3 Self-Evolve via `resolve_anime`

New tool `resolve_anime(title: str) → bangumi_id`:

```
1. Fuzzy match Supabase `bangumi` table (title / title_cn)
   → hit: return bangumi_id
   → miss: continue

2. Query Bangumi.tv search API
   → upsert result into Supabase `bangumi` table
   → return bangumi_id
```

DB is the source of truth. The 17 original anime become seed data in DB; no list in code. Every new query auto-extends the DB.

### 1.4 File Changes

| File | Action |
|---|---|
| `agents/intent_agent.py` | **Delete** |
| `agents/planner_agent.py` | **Rewrite** — ReActPlannerAgent, ExecutionPlan Pydantic models |
| `agents/executor_agent.py` | **Add** `_execute_resolve_anime()` handler |
| `agents/pipeline.py` | **Simplify** — remove `classify_intent`, call `planner.create_plan()` directly |
| `infrastructure/gateways/bangumi.py` | **Add** `search_by_title()` method |
| `agents/retriever.py` | No change |
| `interfaces/public_api.py` | Minimal — adapt `PipelineResult` import if renamed |
| `interfaces/http_service.py` | No change |
| `infrastructure/` | No change |

### 1.5 Response Contract Change (Generative UI)

Add `ui` field to `RuntimeResponse`:

```typescript
interface UIDescriptor {
  component: string   // e.g. "PilgrimageGrid"
  props: Record<string, unknown>
}

interface RuntimeResponse {
  // existing fields unchanged
  intent: string
  message: string
  data: SearchData | RouteData | QAData | null
  // new field
  ui?: UIDescriptor
}
```

Backend sets `ui.component` and `ui.props` based on intent. Frontend uses registry.

---

## 2. Frontend Architecture

### 2.1 Three-Column Layout

```
┌─────────┬─────────────┬──────────────────────────────┐
│ Sidebar │ Chat Panel  │ Result Panel                  │
│ 240px   │ 380px fixed │ flex-1                        │
│         │             │                               │
│ History │ text only:  │ GenerativeUIRenderer renders  │
│ New chat│  user msgs  │ the active result here        │
│         │  bot summary│                               │
│         │  ◈ anchors  │ Empty state: static dark map  │
│         │             │                               │
│         │  [input]    │                               │
└─────────┴─────────────┴──────────────────────────────┘
```

Chat panel rules:
- Bot messages: text summary only (1-2 sentences) + `◈ N results →` anchor card below
- **No intent components render inside chat bubbles**
- Clicking a `◈` anchor activates the corresponding result in the Result Panel

Result Panel rules:
- Always shows the "active" result (defaults to latest)
- Clicking an older `◈` anchor switches it
- Independent scroll area
- Empty state: full-panel dark map background (static, decorative)

This is the **Claude Artifacts / Perplexity** pattern — conversation and results are linked but visually separated.

### 2.2 Generative UI Renderer

Replace `IntentRenderer` (hardcoded switch) with `GenerativeUIRenderer` (registry):

```typescript
// components/generative/registry.ts
export const COMPONENT_REGISTRY: Record<string, ComponentType<any>> = {
  PilgrimageGrid:      PilgrimageGrid,
  RouteVisualization:  RouteVisualization,
  NearbyMap:           NearbyMap,
  GeneralAnswer:       GeneralAnswer,
  Clarification:       Clarification,
}

// components/generative/GenerativeUIRenderer.tsx
export default function GenerativeUIRenderer({ response }) {
  const desc = response.ui
  if (!desc) return <FallbackRenderer response={response} />
  const Component = COMPONENT_REGISTRY[desc.component]
  if (!Component) return <p>Unknown component: {desc.component}</p>
  return <Component {...desc.props} />
}
```

Adding a new component = register it. No routing logic changes.

**Note:** This is NOT a2ui. a2ui was a legacy agent-to-UI protocol layer (from an older architecture). This is a lightweight rendering pattern on top of the existing `RuntimeResponse` JSON — just a new optional field.

### 2.3 Visual Design Tokens (Always Dark, Shinkai x KyoAni)

```css
/* Base (Shinkai twilight) */
--color-bg:          #060815   /* 暮色靛 */
--color-bg-2:        #0b1028   /* 夜空蓝 (用于渐变/雾化) */
--color-fg:          #f4f0ff   /* 淡薰衣草白 */

/* Surfaces (glass) */
--color-card:        rgba(255, 255, 255, 0.04)
--color-muted:       rgba(255, 255, 255, 0.06)
--color-muted-fg:    rgba(244, 240, 255, 0.72)
--color-border:      rgba(255, 255, 255, 0.12)

/* Accents (KyoAni pastel UI) */
--color-primary:     #6ef7d8   /* 薄荷 */
--color-secondary:   #ff79c6   /* 樱花 */
--color-highlight:   #ffe08a   /* 柠檬 */
--color-warm:        #d9a55b   /* 暖金 (重要动作/强调，克制使用) */

/* Typography */
--font-display:      "Shippori Mincho B1", "Hiragino Mincho ProN", "Songti SC", Georgia, serif
--font-body:         "Zen Kaku Gothic New", "Hiragino Sans", "PingFang SC", system-ui, sans-serif
```

- Remove `@media (prefers-color-scheme: dark)` — always dark
- Add Shippori Mincho B1 (Google Fonts) for display text
- Add Zen Kaku Gothic New (Google Fonts) for body text (rounded, anime-friendly)
- Background uses subtle twilight haze (radial gradients) + optional grain, never flat single-color
- `@keyframes breathe` for loading dots

### 2.4 Component Changes

| Component | Change |
|---|---|
| `globals.css` | Replace tokens, always-dark, add Shippori Mincho import |
| `AppShell.tsx` | Three-column flex layout; `activeResultId` state; pass to ResultPanel |
| `ResultPanel.tsx` | **New file** — renders active result via GenerativeUIRenderer |
| `GenerativeUIRenderer.tsx` | **New file** — registry lookup (replaces IntentRenderer) |
| `MessageBubble.tsx` | Remove IntentRenderer call; add `◈` anchor card for bot messages |
| `PilgrimageGrid.tsx` | 4-column grid for result panel; remove raw intent badge |
| `RouteVisualization.tsx` | Map fills panel height; route list as overlay (absolute, bottom-left) |
| `NearbyMap.tsx` | Map 60% / list 40% split; remove raw intent badge |
| `IntentRenderer.tsx` | **Delete** (replaced by GenerativeUIRenderer) |

### 2.5 Mobile (Deferred to Iter 3)

Decision: **Bottom Sheet** (Google Maps / Airbnb pattern). On mobile:
- Chat panel takes full screen
- Result panel slides up as a draggable bottom sheet when a `◈` anchor is tapped
- Uses a gesture library (e.g. `@radix-ui/react-dialog` or `vaul`)

Not implemented until Iter 3.

---

## 3. Multilingual Support

**Scope:**
- A (query/response language): ja / zh / en — backend locale parameter, already partially implemented
- B (UI text translation): all UI strings in `dictionaries/{ja,zh,en}.json`
- C (SEO routing `/en/`, `/ja/`, `/zh/`): already in place via `[lang]` route

**Iter 1:** Backend `locale` expansion (en support in PlannerAgent system prompt + response)
**Iter 2:** Frontend `en.json` dictionary + locale routing
C (SEO) is already implemented — no additional work needed.

---

## 4. Eval-Driven Iteration Plan

### Principle: "Eval first, development after"

Every iteration: write eval → develop → verify eval passes.

### Iter 0 — Infrastructure (no feature changes)
- Write eval dataset: 50 queries × 3 locales × expected plan structure
- Add request logging: every request writes `{plan, result, latency}` to DB
- Add 👍👎 feedback endpoint writing to DB with session context
- **No changes to PlannerAgent or any agent**

### Iter 1 — Backend
- Eval first: run Iter 0 dataset against current baseline, record pass rate
- Rewrite PlannerAgent → ReActPlannerAgent
- Add `resolve_anime` tool + `search_by_title` to BangumiGateway
- Delete IntentAgent; simplify pipeline.py
- Add en locale to planner system prompt
- Verify: eval pass rate ≥ baseline; new English eval cases pass

### Iter 2 — Frontend
- Eval first: E2E smoke test (send query → result panel has content)
- Three-column layout + ResultPanel + GenerativeUIRenderer
- Dark theme token replacement
- Update PilgrimageGrid / RouteVisualization / NearbyMap for result panel
- Add `en.json` dictionary
- Verify: smoke test passes; no visual regression

### Iter 3 — Eval Loop Closure
- Expand dataset with real negative-feedback cases from Iter 0 collection
- LLM auto-scoring for plan quality (online monitoring)
- Negative feedback → auto-suggest prompt improvements
- Mobile bottom sheet implementation
- Verify: previously-failing cases now pass

---

## 5. What Does NOT Change

- `agents/retriever.py` — no touch
- `agents/sql_agent.py` — no touch
- `infrastructure/` — no touch
- `interfaces/http_service.py` — no touch
- Route structure (`app/[lang]/`) — no touch
- Existing dictionary keys in `ja.json`, `zh.json` — additive only
- `RuntimeResponse` base fields (`intent`, `message`, `data`, `session`, `route_history`) — unchanged; `ui` field is additive

---

## 6. Verification

```bash
# Backend
make test              # unit tests must pass
make test-integration  # acceptance baseline must pass

# Frontend
cd frontend && npm run dev
# /ja/ → chat sends "吹響の聖地" → left: text summary + ◈ anchor; right: 4-col grid
# /ja/ → chat sends "ルート計画" → left: text summary + ◈ anchor; right: fullscreen map + overlay list
# /en/ → English UI text and English response
make lint
```
