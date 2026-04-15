# Production Bugfix Spec: 35 Findings from Issue #60

**Status:** LANDED (95% — T03 spot detail + T15-19 nice-to-haves deferred)

> **Update (2026-04-11):** 15 of 20 tasks completed via 20+ commits. Remaining: T03 (spot detail view), T15-T19 (nice-to-have polish). These can be picked up in a future UX iteration.

## Context

Issue #60 documents 35 distinct findings from production testing of seichijunrei.zhenjia.org after 18 PRs merged (frontend redesign iteration). Findings come from three passes:

1. **Initial user test** — 13 bugs across functionality, UX, visuals, and performance
2. **Deep-dive production exploration** — route intent analysis, ReAct retry root cause, session hydration confirmation, Bug #14 (auth token fragment)
3. **Architecture + user journey review** — 7 architecture issues, 18 user journey issues across 5 journeys

This spec consolidates all 35 findings into 20 actionable tasks, ordered by launch priority.

**Source:** `gh issue view 60`

## Goals

1. Unblock new user signup (waitlist auto-approval)
2. Pipeline resilience: ReAct loop recovers from step failures instead of dying
3. Core content explorable: spot detail view, result auto-open
4. Session hydration works (JSON.parse fix)
5. Mobile experience functional (sidebar, login button, CSS conflicts)
6. Route planning end-to-end correct (intent inference, pacing, i18n, export)
7. Loading states visible, error handling surfaced
8. Landing page polished with real photos and preserved user query

## Non-Goals

- **Agent architecture redesign** — separate spec; this spec only patches the existing ReAct loop
- **Performance optimization** (cold start, model swap to Flash) — deferred to infra hardening spec
- **Area label positioning** (Bug #6) — needs specific screenshot to diagnose; deferred
- **Auth token fragment in headless browser** (Bug #14) — headless-only issue, not user-facing
- **Nested vaul drawer gesture conflict** — low severity, requires upstream vaul fix investigation
- **Quick actions on desktop empty state** — cosmetic, low impact
- **Feedback button tap target size** — accessibility pass, separate effort

---

## Findings-to-Task Mapping

| Finding | Source | Task |
|---------|--------|------|
| Waitlist blocks all new users | Journey 1 | T01 |
| ReAct loop aborts on step failure | Bug #5 deep-dive, Arch finding | T02 |
| No individual spot detail view | Journey 2 | T03 |
| Blank bubble while LLM thinks (steps=[]) | Journey 2 | T04 |
| Session hydration JSON.parse (response_data is string) | Bug #11, Arch finding | T05 |
| Route intent inferred wrong (search_bangumi not plan_route) | Bug #5 revised root cause | T06 |
| Duplicate results from guard double-fire | Bug #7 | T06 |
| Pacing selector non-functional (`_pacing` never sent) | Journey 3 | T07 |
| Route timeline hardcoded Japanese | Journey 3 | T08 |
| Mobile sidebar hidden lg:flex conflict | Journey 5, Bug #13 | T09 |
| Result panel auto-open on visual response | Bug #2, Journey 2 | T10 |
| Landing chat input discards user query through auth | Journey 1 | T11 |
| Login button hidden on mobile (hidden sm:block) | Journey 1 | T12 |
| Remove language switchers (browser auto-detect only) | Bug #1 | T13 |
| Conversation error handling swallows errors | Bug #13, Arch finding | T14 |
| Session delete (full stack) | Bug #10, Journey 4 | T15 |
| Follow-up suggestions after results | Bug #8 | T16 |
| Landing page real photos (pin popups + comparison) | Bug #3, Bug #4 | T17 |
| Google Maps export fallback | Journey 3 | T18 |
| Route history items not clickable | Journey 4 | T19 |
| Planner prompt lacks failure recovery + plan_route deps | Arch findings | T02, T06 |
| Session hydration empty deps / stale closure | Arch finding | T05 |
| Hydration error catch is empty (no logging) | Arch finding | T05 |
| Two overlapping guards with no shared state | Arch finding | T06 |
| Mobile header not sticky | Comment 2 observation | T09 |
| Session hydration race on conversation switch | Journey 4 | T05 |

---

## Task Breakdown

### MUST FIX BEFORE LAUNCH

---

### T01: Waitlist Auto-Approval — Unblock New Users

**Findings:** Waitlist gate blocks ALL new users (Journey 1)
**Severity:** CRITICAL
**Files:** `frontend/components/auth/AuthGate.tsx`

**Root cause:** AuthGate.tsx:103-105 — login flow queries `waitlist` table and requires `data.status === "approved"`. New signups insert into `waitlist` but status defaults to `pending`. No admin UI or automation approves them, so every new user is permanently stuck.

**Fix:** Remove the waitlist gate from the login flow. The login handler should send the magic link OTP directly without checking waitlist status. Keep the waitlist table for analytics (track signups) but do not gate authentication on it.

```typescript
// BEFORE (AuthGate.tsx:101-108):
const { data } = await authClient.from("waitlist").select("status").eq("email", normalizedEmail).single();
if (!data) { setStatus(t.not_registered); ... return; }
if (data.status !== "approved") { setStatus(t.pending_review); ... return; }
const { error } = await authClient.auth.signInWithOtp({ email: normalizedEmail, ... });

// AFTER:
const { error } = await authClient.auth.signInWithOtp({ email: normalizedEmail, ... });
```

Also update the tab UI: remove the waitlist/login tab switcher. Single flow: enter email, get magic link.

**AC:**

- [ ] New user enters email on landing page and receives magic link without manual approval
- [ ] No "pending review" or "not registered" error for new emails
- [ ] Waitlist table still receives inserts (for analytics) but does not gate login
- [ ] Tab switcher removed; single auth flow

---

### T02: ReAct Retry Mechanism — Step Failure Kills Conversation

**Findings:** ReAct loop aborts on ANY step failure (Bug #5 deep-dive, Arch findings), no failure recovery instructions in prompt
**Severity:** HIGH
**Files:** `backend/agents/pipeline.py`, `backend/agents/planner_agent.py`

**Root cause:** pipeline.py:232-239 — when a step fails, the loop yields an error event and returns immediately. The planner never sees the failure, so it cannot recover. This is a fundamental violation of ReAct design where observations (including failures) feed back into the reasoning loop.

**Fix:**

1. Replace early return with observation feedback:
```python
# Current (pipeline.py:232-239):
if not step_result.success:
    yield ReactStepEvent(type="error", ...)
    return  # STOPS HERE

# Target:
if not step_result.success:
    fail_obs = ExecutorAgent.format_observation(step_result)
    history.append(fail_obs)
    yield ReactStepEvent(type="step", tool=tool_name, status="failed", observation=fail_obs.summary)
    continue  # planner sees failure and decides next action
```

2. Add `failure_count` tracker: max 2 failures per loop before hard stop (prevent infinite retry).

3. Add failure recovery instructions to planner prompt (planner_agent.py:132-153):
```
If a tool fails, analyze the error. Common recoveries:
- plan_route failed "no points": run search_bangumi first, then retry plan_route
- resolve_anime failed: try alternative title spelling
```

**AC:**

- [ ] "plan a route for Your Name from Shinjuku" where plan_route fails first (no spots loaded) -> planner recovers: resolve -> search -> plan_route
- [ ] Step failure observation visible in debug/streaming output
- [ ] Max 2 failures then hard stop with error message (no infinite loop)
- [ ] `uv run pytest backend/tests/unit -x -q` passes

---

### T03: Spot Detail View — Core Content Unexplorable

**Findings:** PilgrimageGrid card only toggles selection, no detail sheet (Journey 2)
**Severity:** HIGH
**Files:** `frontend/components/generative/PilgrimageGrid.tsx`, `frontend/components/generative/registry.ts`

**Root cause:** Clicking a spot card in PilgrimageGrid only toggles its selection state (for route planning). There is no way to view details about an individual spot — photo, address, anime episode reference, map position.

**Fix:** Add a spot detail sheet/modal that opens on card tap (or a dedicated "info" button to avoid conflicting with selection). The detail view should show:

- Spot photo (via `/img/` proxy)
- Location name + address
- Anime title + episode reference (if available)
- Mini map with pin
- "Add to route" / "Remove from route" toggle

Register as `SpotDetail` component in registry.ts if it needs to be a standalone view, or implement as an inline expansion within PilgrimageGrid.

**AC:**

- [ ] Tapping a spot card opens a detail view with photo, name, address, and map pin
- [ ] Detail view has a close/back action
- [ ] Selection state (for route planning) is not broken by detail view interaction
- [ ] Works on both desktop (panel) and mobile (drawer)

---

### T04: Blank Loading State — Empty Bubble While LLM Thinks

**Findings:** ThinkingProcess returns null when steps=[] (Journey 2)
**Severity:** HIGH
**Files:** `frontend/components/chat/ThinkingProcess.tsx`, `frontend/components/chat/MessageBubble.tsx`

**Root cause:** ThinkingProcess.tsx:30 — `if (steps.length === 0) return null`. When the LLM is processing but no steps have been emitted yet, the bot message bubble renders with no content (blank bubble). The user sees an empty white rectangle for 2-5 seconds.

**Fix:** When `isStreaming === true` and `steps.length === 0`, show a pulsing "Thinking..." indicator instead of returning null:

```typescript
if (steps.length === 0) {
  if (!isStreaming) return null;
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
      <span className="animate-pulse">🧠</span>
      <span>{t.chat?.thinking || "Thinking..."}</span>
    </div>
  );
}
```

**AC:**

- [ ] Sending a message shows "Thinking..." indicator immediately (no blank bubble)
- [ ] Indicator transitions to step-by-step display once first step arrives
- [ ] Indicator disappears when streaming completes with no steps (edge case: greet_user)

---

### T05: Session Hydration — JSON.parse + Error Handling

**Findings:** response_data is string not object (Bug #11), empty deps/stale closure (Arch), hydration catch empty (Arch), race on conversation switch (Journey 4)
**Severity:** HIGH
**Files:** `frontend/lib/api.ts`, `frontend/components/layout/AppShell.tsx`

**Root cause (primary):** api.ts:301 — `data: m.response_data` passes the field as-is. The messages API returns `response_data` as a JSON string (from the database), not a parsed object. When AppShell casts this to `RuntimeResponse`, property checks like `"results" in data` fail because `data` is a string.

**Root cause (secondary):** AppShell.tsx:65-88 — the hydration useEffect captures `sessionId` via closure at mount time. If the user switches conversations before the effect re-runs, stale sessionId is used. The catch block at line ~85 is empty — no logging, no user feedback.

**Fix:**

1. In `api.ts`, parse `response_data`:
```typescript
data: typeof m.response_data === 'string' ? JSON.parse(m.response_data) : m.response_data,
```

2. In AppShell.tsx hydration useEffect:
   - Add `sessionId` to the dependency array (or use a ref for latest value)
   - Add `console.error` and user-visible error state in the catch block
   - Add null/undefined guard: if `response_data` is null, skip that message gracefully

3. Handle pre-migration conversations: if `JSON.parse` throws, show the conversation with text-only messages (no result panel data).

**AC:**

- [ ] Clicking a conversation in sidebar loads its messages with full result data
- [ ] Old conversations (pre-migration or null response_data) show text-only gracefully
- [ ] Console shows diagnostic info on hydration failure
- [ ] Switching conversations rapidly does not show stale data from previous session

---

### SHOULD FIX

---

### T06: Route Intent Inference + Duplicate Guard

**Findings:** plan_route succeeds but intent=search_bangumi (Bug #5 revised), two overlapping guards double-fire (Bug #7, Arch finding)
**Severity:** HIGH
**Files:** `backend/agents/pipeline.py`

**Root cause (intent):** The intent inference at pipeline.py:298-302 iterates `reversed(all_step_results)` and picks the first successful tool not in `(resolve_anime, greet_user)`. When the step order is [resolve_anime, search_bangumi, plan_route] and plan_route was injected by a post-done guard, its result may be appended AFTER the done event is yielded, causing intent to resolve to `search_bangumi`.

**Root cause (duplicates):** Two guards can inject search_bangumi: (1) pre-execution guard (pipeline.py:143-166) injects resolve_anime before search_bangumi, (2) post-done guard (pipeline.py:74-126) injects search_bangumi when planner stops early. The `has_search` check (line 78-81) can miss the guard-injected search if it hasn't been appended to `accumulated_results` yet.

**Fix:**

1. Ensure guard-injected step results are appended to `all_step_results` BEFORE intent inference runs.
2. Add dedup: if `search_bangumi` result already exists in `accumulated_results`, skip post-done injection.
3. Make intent inference deterministic: if `plan_route` succeeded, intent is always `plan_route` regardless of order.

**AC:**

- [ ] "新宿出発で君の名はのルートを教えて" returns intent=plan_route with RoutePlannerWizard UI
- [ ] No duplicate search results for any query
- [ ] Intent inference picks the highest-priority tool: plan_route > plan_selected > search_nearby > search_bangumi

---

### T07: Pacing Selector Non-Functional

**Findings:** `_pacing` state never sent to backend (Journey 3)
**Severity:** MEDIUM
**Files:** `frontend/components/generative/RoutePlannerWizard.tsx`

**Root cause:** RoutePlannerWizard.tsx:201-203 — `_pacing` state is declared with `useState` and updated by `setPacing`, but the value is never read or sent to the backend. The pacing selector UI exists but changing it has no effect on the displayed route.

**Fix:** Either:

- (A) Wire `_pacing` to re-sort/re-time the itinerary client-side (adjust `duration_minutes` per stop based on pacing multiplier), or
- (B) Remove the pacing selector UI until backend supports it (avoid confusing users with non-functional controls)

Recommended: option (A) with client-side multipliers: chill=1.5x, normal=1.0x, packed=0.7x applied to `duration_minutes`.

**AC:**

- [ ] Changing pacing selector visibly adjusts time estimates in the timeline
- [ ] OR pacing selector is removed/disabled with no dead UI

---

### T08: Route Timeline Hardcoded Japanese

**Findings:** No i18n in RoutePlannerWizard timeline (Journey 3)
**Severity:** MEDIUM
**Files:** `frontend/components/generative/RoutePlannerWizard.tsx`

**Root cause:** RoutePlannerWizard.tsx:78-79,126-141 — timeline labels ("出発", time formats, transit descriptions) are hardcoded in Japanese. The `_dict` variable exists but is unused. Non-Japanese users see Japanese-only timeline text.

**Fix:** Use `useDict()` hook and add timeline-specific strings to the i18n dictionaries. Replace all hardcoded Japanese strings with dictionary lookups.

**AC:**

- [ ] Route timeline renders in the user's browser language (en/zh/ja)
- [ ] No hardcoded Japanese strings in RoutePlannerWizard

---

### T09: Mobile Sidebar Hidden Class Conflict

**Findings:** Sidebar hidden lg:flex overrides overlay wrapper (Journey 5, Bug #13), mobile header not sticky
**Severity:** HIGH
**Files:** `frontend/components/layout/Sidebar.tsx`, `frontend/components/layout/AppShell.tsx`

**Root cause:** Sidebar.tsx:219 — the component's root element has `className="hidden ... lg:flex"`. When AppShell renders `<Sidebar>` inside the mobile overlay (z-50), the component's own `hidden` class hides it below the `lg` breakpoint. The overlay wrapper is visible but the sidebar content inside it is not.

**Fix:** Accept a `variant` prop on Sidebar: `"desktop"` (keeps `hidden lg:flex`) vs `"mobile"` (removes `hidden`, renders full-width). AppShell passes `variant="mobile"` when rendering inside the overlay.

```tsx
// Sidebar.tsx
<aside className={cn(
  "w-[240px] shrink-0 flex-col border-r ...",
  variant === "desktop" ? "hidden lg:flex" : "flex"
)}>
```

**AC:**

- [ ] Mobile hamburger opens overlay with visible conversation list
- [ ] Desktop sidebar unchanged (hidden below lg, visible at lg+)
- [ ] Conversations load and display (or show loading state) in mobile overlay

---

### T10: Result Panel Auto-Open on Visual Response

**Findings:** Results need two clicks to view (Bug #2, Journey 2)
**Severity:** MEDIUM
**Files:** `frontend/components/layout/AppShell.tsx`

**Root cause:** AppShell.tsx — `activeMessageId` is only set when the user clicks `handleActivate` (manual anchor card click). No auto-activation when a new visual response arrives. The user must: (1) see the anchor card in chat, (2) click it, to view results.

**Fix:** In the send callback, after a response with visual data arrives, auto-set `activeMessageId`:

```typescript
if (response && isVisualResponse(response)) {
  setActiveMessageId(placeholderId);
  if (isMobile) setDrawerOpen(true);
}
```

Where `isVisualResponse` checks if `response.ui` is in `["PilgrimageGrid", "NearbyMap", "RoutePlannerWizard"]`.

**AC:**

- [ ] Search/route/nearby results auto-open in the result panel
- [ ] On mobile, drawer auto-opens
- [ ] User can still close and re-open manually via anchor card
- [ ] Non-visual responses (greet, answer_question) do NOT auto-open

---

### T11: Landing Chat Preserves User Query Through Auth

**Findings:** Chat input on landing discards text, readOnly input (Journey 1)
**Severity:** MEDIUM
**Files:** `frontend/components/auth/AuthGate.tsx`

**Root cause:** AuthGate.tsx:271-277 — the landing page chat input has `readOnly` and `onFocus` opens the auth modal. Any text the user mentally composed or tried to type is lost. After completing auth, the user starts with a blank chat.

**Fix:** Store the placeholder/intent in sessionStorage before opening auth modal. After auth completes and AppShell mounts, read from sessionStorage and pre-fill the chat input.

```typescript
// AuthGate: on input focus
onFocus={() => {
  sessionStorage.setItem("landing_query", inputRef.current?.value || "");
  setShowAuthModal(true);
}}

// AppShell: on mount
const landingQuery = sessionStorage.getItem("landing_query");
if (landingQuery) {
  setInputValue(landingQuery);
  sessionStorage.removeItem("landing_query");
}
```

**AC:**

- [ ] User's intended query (if typed before auth) is preserved after login
- [ ] Pre-filled input is editable before sending
- [ ] Works for both new signups and returning logins

---

### T12: Login Button Hidden on Mobile

**Findings:** Login button hidden below sm breakpoint (Journey 1)
**Severity:** MEDIUM
**Files:** `frontend/components/auth/AuthGate.tsx`

**Root cause:** AuthGate.tsx:189 — `className="hidden ... sm:block"` hides the login button below the `sm` (640px) breakpoint. Mobile users cannot access the login flow from the header; they must use the chat input focus trigger (which defaults to waitlist tab).

**Fix:** Remove `hidden sm:block` from the login button. Ensure it has `min-h-[44px]` tap target for mobile.

**AC:**

- [ ] Login button visible on all screen sizes
- [ ] Tap target meets 44px minimum on mobile
- [ ] Both "Join beta" and "Login" accessible on mobile header

---

### T13: Remove Language Switchers

**Findings:** Two language switchers redundant (Bug #1), browser auto-detect sufficient
**Severity:** LOW
**Files:** `frontend/components/layout/ChatHeader.tsx`, `frontend/components/layout/Sidebar.tsx`

**Root cause:** Language switcher was added in PR #57 to both ChatHeader and Sidebar bottom. Since i18n uses `detectLocale()` from browser settings and chat responses follow user input language, manual switchers are redundant and confusing.

**Fix:**

- Remove language switcher component from ChatHeader
- Remove language switcher from Sidebar bottom
- Remove `persistLocale()` and associated localStorage key
- Keep `detectLocale()` for browser auto-detect

**AC:**

- [ ] No manual language toggle anywhere in UI
- [ ] UI language follows browser setting
- [ ] Chat responses follow user input language (already handled by locale param)

---

### T14: Conversation Error Handling (Silent Swallow)

**Findings:** useConversationHistory catch blocks swallow errors (Bug #13, Arch finding)
**Severity:** MEDIUM
**Files:** `frontend/hooks/useConversationHistory.ts`

**Root cause:** useConversationHistory.ts:23,44,49 — all `.catch(() => {})` blocks silently discard errors. When `fetchConversations()` fails (auth header missing, network error), the sidebar shows an empty list with no feedback.

**Fix:**

1. Add `error` state to the hook: `const [error, setError] = useState<string | null>(null)`
2. Populate error state in catch blocks: `.catch((e) => { setError(e.message); console.error("fetchConversations failed:", e); })`
3. Return `error` and `isLoading` from the hook
4. Show error/loading state in Sidebar when conversations is empty

**AC:**

- [ ] API failure shows "Could not load conversations" in sidebar (not blank)
- [ ] Loading state visible while fetch is in progress
- [ ] Console logs diagnostic info on failure
- [ ] Successful retry clears error state

---

### NICE TO HAVE

---

### T15: Session Delete (Full Stack)

**Findings:** No delete functionality anywhere (Bug #10, Journey 4)
**Severity:** MEDIUM
**Files:**

- `backend/interfaces/fastapi_service.py` — add `DELETE /v1/conversations/{id}`
- `backend/infrastructure/supabase/repositories/session.py` — add `delete_conversation`
- `frontend/lib/api.ts` — add `deleteConversation()`
- `frontend/hooks/useConversationHistory.ts` — add delete method
- `frontend/components/layout/Sidebar.tsx` — add delete button (trash icon or swipe)

**Root cause:** No delete functionality exists at any layer.

**Fix:** Implement full-stack conversation delete:

1. Backend: `DELETE /v1/conversations/{id}` endpoint that deletes the conversation and its messages from Supabase
2. Frontend hook: `deleteConversation(id)` method that calls the API and removes from local state
3. Sidebar UI: trash icon on hover (desktop) or swipe-to-delete (mobile)
4. If the deleted conversation is currently active, reset to new conversation state

**AC:**

- [ ] User can delete conversations from sidebar
- [ ] `DELETE /v1/conversations/{id}` removes conversation + messages from DB
- [ ] Deleted conversation disappears from sidebar immediately (optimistic update)
- [ ] Deleting the active conversation resets to new conversation state

---

### T16: Follow-Up Suggestions After Results

**Findings:** No follow-up UI after results (Bug #8)
**Severity:** MEDIUM
**Files:** `frontend/components/generative/PilgrimageGrid.tsx`, `frontend/components/generative/RoutePlannerWizard.tsx`, `frontend/components/generative/registry.ts`

**Root cause:** registry.ts has `onSuggest` callback support, but only the Clarification component uses it. PilgrimageGrid and RoutePlannerWizard offer no follow-up actions.

**Fix:** Add suggested follow-up pills below results:

- **PilgrimageGrid:** "Plan a route with these spots", "Show nearby spots", "Tell me more about this anime"
- **RoutePlannerWizard:** "Export to Google Maps", "Search for more spots", "Adjust the route"

Use the existing `onSuggest` callback pattern to send the query to the chat input.

**AC:**

- [ ] 2-3 follow-up pills appear below PilgrimageGrid results
- [ ] 2-3 follow-up pills appear below RoutePlannerWizard
- [ ] Clicking a pill sends the query to the chat input
- [ ] Pills are context-aware (use anime title, location names from results)

---

### T17: Landing Page Real Photos

**Findings:** Pin popups show gray placeholder (Bug #3), no photographic content (Bug #4)
**Severity:** MEDIUM
**Files:** `frontend/components/auth/AuthGate.tsx`

**Root cause:** AuthGate.tsx:240 — pin popup uses `style={{ background: "var(--color-card)" }}` as a placeholder div. No `<img>` tag. The comparison section (Anime x Reality) was in the mockup but not implemented because Unsplash URLs were excluded from production.

**Fix:**

- Replace gray placeholder divs with `<img>` tags using `/img/` proxy URLs for Anitabi photos (already configured in worker.js): `/img/screenshot/xxx.jpg` for Your Name, Euphonium, Violet Evergarden
- Add the Anime x Reality comparison section with real photos via `/img/` proxy or curated photos in `public/landing/`

**AC:**

- [ ] Pin hover popups show real anime location photos
- [ ] Comparison section visible below hero with real photos
- [ ] No external URL dependencies (use `/img/` proxy or `public/`)

---

### T18: Google Maps Export Fallback

**Findings:** Export fails silently when URL array is empty (Journey 3)
**Severity:** LOW
**Files:** `frontend/components/generative/RoutePlannerWizard.tsx`

**Root cause:** RoutePlannerWizard.tsx:45 — when the route has no waypoints or the Google Maps URL construction fails, the export button does nothing. No error message, no toast.

**Fix:** Add validation before export:

- If route has 0 waypoints, show toast: "No waypoints to export"
- If URL exceeds Google Maps character limit (~8192), show toast: "Too many waypoints for Google Maps — try selecting fewer stops"
- On successful export, open in new tab with `target="_blank"`

**AC:**

- [ ] Empty route shows informative error message (not silent fail)
- [ ] Successful export opens Google Maps in new tab
- [ ] Over-limit routes show helpful message

---

### T19: Route History Clickable

**Findings:** Route history items are plain `<li>` with no onClick (Journey 4)
**Severity:** LOW
**Files:** `frontend/components/layout/Sidebar.tsx`

**Root cause:** Sidebar.tsx:279-296 — route history items render as plain `<li>` elements with no click handler. Users expect to click a past route to re-view it.

**Fix:** Add `onClick` handler that loads the conversation containing that route and sets the route result as the active message in the result panel.

**AC:**

- [ ] Clicking a route history item loads the associated conversation
- [ ] Route result displays in the result panel
- [ ] Current conversation state is saved before switching

---

## Iteration Phases

```
Phase 1 — MUST FIX (parallel — different files):
  ├── T01: Waitlist auto-approval        (AuthGate.tsx — auth flow)
  ├── T02: ReAct retry mechanism          (pipeline.py, planner_agent.py)
  ├── T04: Blank loading state            (ThinkingProcess.tsx)
  └── T05: Session hydration JSON.parse   (api.ts, AppShell.tsx)

Phase 2 — MUST FIX + SHOULD FIX (parallel):
  ├── T03: Spot detail view               (PilgrimageGrid.tsx, registry.ts)
  ├── T06: Route intent + dedup guards    (pipeline.py — after T02 merges)
  ├── T09: Mobile sidebar CSS conflict    (Sidebar.tsx)
  ├── T12: Login button mobile            (AuthGate.tsx — after T01 merges)
  └── T14: Conversation error handling    (useConversationHistory.ts)

Phase 3 — SHOULD FIX (parallel):
  ├── T07: Pacing selector                (RoutePlannerWizard.tsx)
  ├── T08: Route timeline i18n            (RoutePlannerWizard.tsx — with T07)
  ├── T10: Result panel auto-open         (AppShell.tsx — after T05 merges)
  ├── T11: Landing chat preserve query    (AuthGate.tsx — after T01 merges)
  └── T13: Remove language switchers      (ChatHeader.tsx, Sidebar.tsx)

Phase 4 — NICE TO HAVE (parallel):
  ├── T15: Session delete (full stack)
  ├── T16: Follow-up suggestions          (PilgrimageGrid, RoutePlannerWizard)
  ├── T17: Landing page real photos       (AuthGate.tsx)
  ├── T18: Google Maps export fallback    (RoutePlannerWizard.tsx)
  └── T19: Route history clickable        (Sidebar.tsx)
```

### Dependency Graph

```
T01 (waitlist) ─────→ T11 (preserve query), T12 (login button mobile)
T02 (ReAct retry) ──→ T06 (intent + dedup guards)
T05 (hydration) ────→ T10 (auto-open results)
T07 (pacing) ───────→ T08 (timeline i18n — same file, do together)
```

## Verification Plan

### Per-Task Verification

Each task PR must pass:

1. `uv run pytest backend/tests/unit -x -q` (if backend changes)
2. `cd frontend && npm run build` (if frontend changes)
3. Manual test of the specific AC items

### End-to-End Verification (after all phases)

1. **New user flow:** Visit landing page -> enter email -> receive magic link -> authenticate -> chat works
2. **Search flow:** "君の名はの聖地巡礼スポット" -> results auto-open in panel -> spot detail viewable -> follow-up suggestions visible
3. **Route flow:** "新宿出発で君の名はのルートを教えて" -> intent=plan_route -> RoutePlannerWizard renders -> timeline in correct language -> export works
4. **Session flow:** Click old conversation -> messages load with result data -> delete a conversation -> gone from sidebar
5. **Mobile flow:** Open on phone -> login button visible -> search -> drawer opens -> hamburger shows conversations
6. **Error recovery:** Send query that triggers step failure -> planner recovers -> final result correct
7. **Full suite:** `make check` passes (lint + typecheck + test)

### Regression Gates

- `make test` — unit tests
- `make test-integration` — integration tests
- `make lint` — ruff check + format
- `make typecheck` — mypy strict
- `cd frontend && npm run build` — static export succeeds
