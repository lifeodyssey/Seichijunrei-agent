# Frontend Redesign + Eval Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the landing page (map hero + i18n), mobile layout, sidebar, anchor card, and interaction polish. Fix the ReAct eval harness.

**Architecture:** Landing page rewrites AuthGate.tsx. Mobile changes AppShell responsive behavior. Sidebar/anchor/animation are component-level CSS+JSX changes. Eval fix is backend-only Python.

**Tech Stack:** Next.js (static export), React, Tailwind + CSS variables, vaul (bottom sheet), IntersectionObserver (scroll reveal), Pydantic evals (Python)

---

## Bug Coverage Map

| Bug # | Description | Task |
|-------|-------------|------|
| 9 | Landing page 60% empty | Task 1 |
| 10 | Mobile is stacked desktop | Task 3 |
| 11 | All touch targets < 44px | Task 2 |
| 12 | Sidebar duplicate titles, no timestamps | Task 4 |
| 13 | Anchor card not discoverable | Task 3 + Task 5 |
| 14 | No loading states | Task 5 |
| 15 | No entrance animations | Task 5 |
| 16 | Language switcher buried | Task 6 |
| 17 | SEICHIJUNREI label redundant | Task 5 |
| 18 | ReAct eval reads plan.steps | Task 7 |

## Execution Phases

```
Phase 1 (parallel — no file overlap):
  ├── Task 1: Landing page (AuthGate.tsx)
  ├── Task 4: Sidebar history (Sidebar.tsx)
  └── Task 7: Eval harness fix (test_plan_quality.py)

Phase 2 (parallel — minimal overlap):
  ├── Task 2: Touch targets (globals.css)
  └── Task 5: Loading states + animations (MessageBubble, PilgrimageGrid)

Phase 3 (after Phase 1):
  ├── Task 3: Mobile layout (AppShell, ResultDrawer)
  └── Task 6: Language switcher position (ChatHeader)
```

---

### Task 1: Landing Page — Map Hero

**Files:**
- Rewrite: `frontend/components/auth/AuthGate.tsx`
- Modify: `frontend/lib/dictionaries/ja.json`, `zh.json`, `en.json` (add landing keys)
- Reference mockup: `.superpowers/brainstorm/68620-1775618015/content/variant-final-map-hero.html`

- [ ] **Step 1: Read the approved mockup HTML**

Read `.superpowers/brainstorm/68620-1775618015/content/variant-final-map-hero.html` to understand the exact layout, CSS, and i18n structure. This is the source of truth.

- [ ] **Step 2: Add i18n keys to dictionaries**

Add to `frontend/lib/dictionaries/ja.json`:
```json
"landing_hero": {
  "tagline": "あの名シーンの、その場所へ。",
  "chat_placeholder": "アニメの聖地を教えて...",
  "chat_submit": "聞く",
  "hint": "君の名は、響け！ユーフォニアム、ヴァイオレット を検索",
  "stat_locations": "スポット",
  "stat_anime": "作品",
  "stat_prefectures": "都道府県",
  "scroll_hint": "スクロールして探索",
  "comparison_title": "アニメと現実",
  "comparison_sub": "すべてのスポットを原作カットと照合。",
  "feat_search": "ロケ地検索",
  "feat_search_desc": "作品名・話数・シーンで聖地を検索。",
  "feat_route": "ルートプランナー",
  "feat_route_desc": "聖地間のルートを自動作成。Google Maps連携。",
  "feat_series": "作品別",
  "feat_series_desc": "作品ごとに聖地を一覧。"
}
```

Add equivalent keys to `zh.json` and `en.json` using text from the mockup.

- [ ] **Step 3: Rewrite AuthGate.tsx**

Replace the current sparse layout with the map hero from the mockup. Key elements:
- Sticky header with logo, language switcher, Join beta CTA
- Full-viewport hero with abstract Japan shape (CSS gradient + border-radius)
- Pulsing pin markers (CSS-only `@keyframes pulse`)
- Photo popup on pin hover (absolute positioned, opacity transition)
- Chat input (not search bar) with locale-aware placeholder
- Stats row (2,400+ / 180+ / 47)
- Scroll-reveal comparison section (IntersectionObserver)
- Feature cards with hover lift

Preserve existing auth logic: `getSupabaseClient()`, `onAuthStateChange`, session check, magic link send. Only replace the JSX layout.

- [ ] **Step 4: Add CSS animations to globals.css**

```css
@keyframes seichi-fade-up {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes seichi-pin-pulse {
  0%, 100% { box-shadow: 0 0 0 3px oklch(60% 0.148 240 / 0.25); }
  50% { box-shadow: 0 0 0 10px oklch(60% 0.148 240 / 0.05); }
}
.animate-fade-up { animation: seichi-fade-up 0.7s ease-out forwards; }
.animate-pin-pulse { animation: seichi-pin-pulse 2.5s ease-in-out infinite; }
```

- [ ] **Step 5: Verify**

```bash
cd frontend && npm run build
```
Expected: static export succeeds with new AuthGate.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/auth/AuthGate.tsx frontend/lib/dictionaries/ frontend/app/globals.css
git commit -m "feat(landing): map hero with chat input, i18n, scroll animations"
```

---

### Task 2: Touch Targets + Interaction States

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add global touch target and interaction rules**

Append to `frontend/app/globals.css`:

```css
/* ── Touch targets ── */
button, a, input, select, textarea, [role="button"], [role="tab"] {
  min-height: 44px;
}
button, a, [role="button"], [role="tab"] {
  min-width: 44px;
}

/* ── Focus visible ── */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ── Hover lift for cards ── */
.hover-lift {
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.hover-lift:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px oklch(20% 0.025 238 / 0.06);
}

/* ── Input focus glow ── */
input:focus, textarea:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px oklch(60% 0.148 240 / 0.1);
}
```

- [ ] **Step 2: Verify no horizontal overflow**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "style: global 44px touch targets, focus-visible, hover-lift"
```

---

### Task 3: Mobile Layout

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx`
- Modify: `frontend/components/layout/ResultDrawer.tsx`
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Read current AppShell responsive behavior**

Read `frontend/components/layout/AppShell.tsx` fully. Understand how `isMobile` controls sidebar visibility and `ResultDrawer` activation.

- [ ] **Step 2: Change sidebar to overlay on mobile**

Currently the sidebar is hidden on mobile with `{!isMobile && sidebarOpen && <Sidebar ... />}`. Change to: render `Sidebar` as a slide-in overlay (absolute positioned, z-index above chat) when `isMobile && sidebarOpen`, triggered by hamburger button.

- [ ] **Step 3: Add safe-area padding to bottom input**

In `AppShell.tsx`, add to the chat input container:
```tsx
style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
```

- [ ] **Step 4: Redesign anchor card in MessageBubble**

Replace the current `◈` anchor with a larger card matching the mobile mockup:
- 📍 icon in 36px blue rounded square
- Title: "君の名は。 → 111 spots"
- Subtitle: "タップして結果を表示" (use i18n key `chat.tap_to_view`)
- `›` arrow on the right
- Hover: border-color change + slight lift

- [ ] **Step 5: Add horizontal scroll quick actions**

Below the chat input on mobile, add a scrollable row of quick action pills:
```tsx
{isMobile && messages.length === 0 && (
  <div className="flex gap-2 px-4 overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: "touch" }}>
    <button className="flex-shrink-0 rounded-full border ...">✦ {dict.landing.feat_search}</button>
    <button className="flex-shrink-0 rounded-full border ...">◎ {dict.landing.feat_route}</button>
    <button className="flex-shrink-0 rounded-full border ...">↗ {dict.landing.feat_series}</button>
  </div>
)}
```

- [ ] **Step 6: Verify on 375px viewport**

```bash
cd frontend && npm run build
```

Open in browser dev tools at 375×812. Check: no horizontal scroll, sidebar is overlay, bottom input has safe-area padding.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/layout/AppShell.tsx frontend/components/layout/ResultDrawer.tsx frontend/components/chat/MessageBubble.tsx
git commit -m "feat(mobile): overlay sidebar, safe-area input, anchor card redesign"
```

---

### Task 4: Sidebar Conversation History

**Files:**
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/hooks/useConversationHistory.ts`

- [ ] **Step 1: Read Sidebar.tsx fully**

Understand how `ConversationRecord` is rendered. Current: `getConversationDisplayTitle()` returns the title.

- [ ] **Step 2: Add relative time helper**

Create a helper or use inline logic:
```typescript
function relativeTime(dateStr: string, locale: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === "ja" ? "たった今" : locale === "zh" ? "刚刚" : "just now";
  if (mins < 60) return locale === "ja" ? `${mins}分前` : locale === "zh" ? `${mins}分钟前` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return locale === "ja" ? `${hours}時間前` : locale === "zh" ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "ja" ? `${days}日前` : locale === "zh" ? `${days}天前` : `${days}d ago`;
}
```

- [ ] **Step 3: Redesign conversation list item**

Each item shows:
- Icon: `🗾` (default) or `📍` (if `first_query` contains route/ルート/路线)
- Title: `first_query` truncated to 25 chars (not `title`)
- Meta line: `relativeTime(updated_at)` · `N spots` (from session data if available)
- Active item: `bg-[oklch(92% 0.022 228)]`

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/layout/Sidebar.tsx frontend/hooks/useConversationHistory.ts
git commit -m "feat(sidebar): relative time, first_query title, route icon"
```

---

### Task 5: Loading States + Animations

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`
- Modify: `frontend/components/generative/PilgrimageGrid.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add skeleton shimmer CSS**

In `globals.css`:
```css
@keyframes seichi-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--color-card) 25%, var(--color-muted) 50%, var(--color-card) 75%);
  background-size: 200% 100%;
  animation: seichi-shimmer 1.5s ease-in-out infinite;
  border-radius: 8px;
}
```

- [ ] **Step 2: Add skeleton to PilgrimageGrid empty state**

When `data.results.rows` is empty or loading, show 6 skeleton cards:
```tsx
{rows.length === 0 && (
  <div className="grid grid-cols-2 gap-2 p-4">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="skeleton aspect-[4/3]" />
    ))}
  </div>
)}
```

- [ ] **Step 3: Add message entrance animation**

Messages already have `animation: slide-up-fade 300ms`. Verify this works for bot messages too. If not, add the same animation wrapper.

- [ ] **Step 4: Remove redundant SEICHIJUNREI label**

In `MessageBubble.tsx`, remove or reduce the `SEICHIJUNREI` label above bot messages. Replace with a small bot icon or remove entirely — the visual style already distinguishes bot from user.

- [ ] **Step 5: Add result panel slide-in**

In `ResultPanel.tsx` or `SlideOverPanel.tsx`, add entrance animation:
```tsx
style={{ animation: "slide-in-right 0.3s ease-out" }}
```

Add to globals.css:
```css
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
```

- [ ] **Step 6: Verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/components/chat/MessageBubble.tsx frontend/components/generative/PilgrimageGrid.tsx frontend/app/globals.css frontend/components/layout/ResultPanel.tsx
git commit -m "feat(polish): skeleton loading, message animation, result slide-in"
```

---

### Task 6: Language Switcher Position

**Files:**
- Modify: `frontend/components/layout/ChatHeader.tsx`

- [ ] **Step 1: Read ChatHeader.tsx**

Understand the header layout. Add language switcher next to the title.

- [ ] **Step 2: Add language switcher to chat header**

Import `useLocale`, `useSetLocale` from i18n-context. Add compact switcher:
```tsx
<div className="flex gap-1 rounded-md border border-[var(--color-border)] p-0.5">
  {LOCALES.map((loc) => (
    <button
      key={loc}
      onClick={() => setLocale(loc)}
      className={`rounded px-2 py-1 text-xs ${
        locale === loc ? "bg-white font-semibold text-[var(--color-fg)]" : "text-[var(--color-muted-fg)]"
      }`}
    >
      {loc === "ja" ? "日本語" : loc === "zh" ? "中文" : "EN"}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/layout/ChatHeader.tsx
git commit -m "feat(i18n): language switcher in chat header"
```

---

### Task 7: Fix ReAct Eval Harness

**Files:**
- Modify: `backend/tests/eval/test_plan_quality.py`

- [ ] **Step 1: Fix step extraction to read step_results**

Replace lines 100-114 in `evaluate_plan()`:

```python
# OLD (broken for ReAct):
steps: list[str] = []
if hasattr(result, "plan") and result.plan is not None:
    for step in getattr(result.plan, "steps", []) or []:
        ...

# NEW (works for ReAct):
steps: list[str] = []
for sr in getattr(result, "step_results", []) or []:
    tool = getattr(sr, "tool", None)
    if tool is not None and sr.success:
        steps.append(tool if isinstance(tool, str) else str(tool))
```

- [ ] **Step 2: Add OutcomeEvaluator**

```python
class OutcomeEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score 1.0 if search queries produced results (row_count > 0)."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_intent = ctx.expected_output.expected_intent
        if expected_intent not in ("search_bangumi", "search_nearby"):
            return 1.0  # Non-search queries always pass outcome
        row_count = getattr(ctx.output, "row_count", 0) or 0
        return 1.0 if row_count > 0 else 0.0
```

Update `PlanOutput` dataclass to include `row_count`:
```python
@dataclass
class PlanOutput:
    steps: list[str]
    intent: str | None
    row_count: int = 0
```

Update `evaluate_plan()` to capture row_count from `result.final_output`:
```python
row_count = int(result.final_output.get("results", {}).get("row_count", 0) if isinstance(result.final_output.get("results"), dict) else 0)
return PlanOutput(steps=steps, intent=getattr(result, "intent", None), row_count=row_count)
```

- [ ] **Step 3: Add EfficiencyEvaluator**

```python
class EfficiencyEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score 1.0 if steps <= expected + 1, 0.5 if within +3, 0.0 if more."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_count = len(ctx.expected_output.expected_steps)
        actual_count = len(ctx.output.steps) if ctx.output else 0
        if actual_count <= expected_count + 1:
            return 1.0
        if actual_count <= expected_count + 3:
            return 0.5
        return 0.0
```

- [ ] **Step 4: Register new evaluators**

```python
plan_dataset = Dataset(
    name="plan_quality_v1",
    cases=CASES,
    evaluators=[
        StepsMatchEvaluator(),
        IntentMatchEvaluator(),
        OutcomeEvaluator(),
        EfficiencyEvaluator(),
    ],
)
```

- [ ] **Step 5: Add Gemini as eval model option**

Update the model selection to support Gemini:
```python
_DEFAULT_MODEL = os.environ.get("EVAL_MODEL", "openai:qwen3.5-9b@http://localhost:1234/v1")

# In make_model(), add Gemini support:
def make_model(model_id: str | None = None) -> Any:
    mid = model_id or _DEFAULT_MODEL
    if mid.startswith("gemini"):
        # pydantic-ai resolves "gemini-2.0-flash" natively
        return mid
    if "@" in mid:
        name, base_url = mid.split("@", 1)
        name = name.removeprefix("openai:")
        return OpenAIModel(name, provider=OpenAIProvider(base_url=base_url))
    return mid
```

Usage:
```bash
# Local LM Studio (default)
uv run python -m pytest backend/tests/eval/ -v -m integration

# Gemini
EVAL_MODEL=gemini-2.0-flash uv run python -m pytest backend/tests/eval/ -v -m integration
```

- [ ] **Step 6: Verify eval runs**

```bash
EVAL_MODEL=gemini-2.0-flash uv run python backend/tests/eval/test_plan_quality.py
```

Expected: all 49 cases evaluated, scores printed for Steps/Intent/Outcome/Efficiency.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/eval/test_plan_quality.py
git commit -m "fix(eval): read step_results, add outcome + efficiency evaluators, Gemini support"
```

---

## Verification Gates

| Gate | After | Command |
|------|-------|---------|
| Frontend build | Each task | `cd frontend && npm run build` |
| Backend tests | Task 7 | `uv run pytest backend/tests/unit -x -q` |
| Eval run | Task 7 | `EVAL_MODEL=gemini-2.0-flash uv run python backend/tests/eval/test_plan_quality.py` |
| Mobile check | Task 3 | 375px viewport, no horizontal scroll |

## Final Verification (after all tasks merge and deploy)

Run `/qa` skill against production to verify everything end-to-end:

```
/qa https://seichijunrei.zhenjia.org --regression .gstack/qa-reports/baseline.json
```

This will:
1. Phase 3.5 API smoke test (healthz + runtime + SSE)
2. Browser test: landing page renders with map hero, pins, chat input
3. Auth flow: magic link → authenticated app
4. Search flow: anime search → results in grid → detail panel
5. Mobile: 375px viewport check (no horizontal scroll, touch targets >= 44px)
6. Regression comparison against baseline (health score 90)
7. Console error check

Then run `/design-review` to verify design score improved:

```
/design-review https://seichijunrei.zhenjia.org
```

Target: Design score B+ or higher (up from C+). AI slop score stays A.
