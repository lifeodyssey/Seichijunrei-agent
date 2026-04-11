# Iteration: QA Bugfix — Production Pipeline & Session Issues

**Status:** LANDED

> **Update (2026-04-11):** All 3 open tasks completed and merged. Session hydration, resolve_anime enforcement, and ui.props cleanup all deployed.

## Context

QA testing of `seichijunrei.zhenjia.org` on 2026-04-07 surfaced 6 issues.
Two critical/high issues were hotfixed immediately (pipeline key mismatch, stale QA URL).
One low issue (Supabase Dashboard URL) was resolved manually.
Three open issues remain, all affecting core user experience.

**Trigger:** User-reported production issues, confirmed by headless browser QA.

**Already fixed (committed on main):**
- `e004977` — `pipeline.py` now wraps search data under `"results"` key, route data under `"route"` key
- `6ab37c2` — `.env.test.example` QA_SITE_URL updated to `seichijunrei.zhenjia.org`
- Supabase Dashboard Site URL manually updated

## Goals

1. Users returning to the app see their last conversation restored (not a blank screen with a stale session)
2. Anime title queries always resolve via `resolve_anime` before `search_bangumi`, eliminating 0-result failures for known anime
3. Remove the dead `ui.props` field or populate it, so the response contract is honest

## Non-Goals

- No new features in this iteration
- No frontend layout changes
- No design system changes
- No changes to the route planner flow

---

## Task Breakdown

### Task 1: Session Hydration on Page Load

**Severity:** HIGH
**Files:**
- `frontend/components/layout/AppShell.tsx`
- `frontend/hooks/useSession.ts` (read-only, for understanding)
- `frontend/hooks/useChat.ts` (read-only, for understanding)

**Problem:**
`useSession()` reads `sessionId` from `localStorage` (`seichi_session_id` key) on mount.
`useChat(sessionId, ...)` receives this stale ID but starts with `messages: []`.
The user sees the welcome screen, but their next message is routed to the old session's backend context.

The hydration logic already exists in `handleConversationSelect` (lines 140-172 of `AppShell.tsx`)
which calls `fetchConversationMessages(selectedSessionId)` and maps results into chat messages.
But this only runs on sidebar click, never on initial mount.

**Root cause path:**
```
Page load
  → useSession() reads localStorage → sessionId = "abc123"
  → useChat("abc123", ...) → messages = [] (never fetched)
  → User sends "search Evangelion"
  → sendMessageStream("search Evangelion", "abc123", ...)
  → Backend appends to session abc123 (which was "Your Name" context)
  → Planner sees session context about Your Name, user sees Evangelion response
  → Session state is now incoherent
```

**Solution:**
Add a `useEffect` in `AppShell` that runs once on mount. If `sessionId` exists:
1. Call `fetchConversationMessages(sessionId)`
2. If messages found → hydrate them into the chat (reuse the hydration logic from `handleConversationSelect`)
3. If empty response → call `clearSession()` so the user starts fresh

**Acceptance Criteria:**
- [ ] Returning user with stored session sees their last conversation messages
- [ ] If stored session has no messages in DB, session is cleared and user starts fresh
- [ ] Sidebar highlights the active conversation on load
- [ ] New chat still works (clears session, shows welcome)
- [ ] No double-fetch when clicking the already-active conversation in sidebar

**Test:**
1. Send a message → reload page → previous messages should appear
2. Clear `conversation_messages` for a session → reload → should show welcome screen, not stale session

---

### Task 2: Enforce resolve_anime-first in ReAct Planner

**Severity:** MEDIUM
**Files:**
- `backend/agents/planner_agent.py`

**Problem:**
The `PLANNER_SYSTEM_PROMPT` (line 14) already states:
```
1. For any anime query: ALWAYS emit resolve_anime first, then search_bangumi.
```

But the ReAct planner (`_step_agent` using `REACT_SYSTEM_PROMPT`) sometimes skips `resolve_anime` and emits `search_bangumi` directly with no `bangumi_id`. This causes the retriever to do a DB lookup with no ID, get a miss, and return 0 results.

**Evidence:**
```
Query: "響け！ユーフォニアムの聖地"
Step results (from include_debug=true):
  1. search_bangumi → success=true, row_count=0 (db_miss, no bangumi_id)
  2. search_bangumi → success=false, "No bangumi_id available"
No resolve_anime step was emitted.
```

**Root cause:**
The ReAct `_step_agent` operates turn-by-turn. It sees the user query and decides what tool to call next. The system prompt says "ALWAYS emit resolve_anime first" but this is a soft instruction — the LLM sometimes skips it, especially for Japanese-language queries where the title is embedded in a longer phrase.

**Solution options (choose one or combine):**

**Option A — Stronger prompt constraint (low risk):**
Add to `REACT_SYSTEM_PROMPT`:
```
CRITICAL: Your FIRST action for any anime-related query MUST be resolve_anime.
If the user's message contains an anime title (in any language), do NOT call
search_bangumi or search_nearby until you have called resolve_anime and received
a bangumi_id. Skipping resolve_anime causes 0 results.
```

**Option B — Deterministic guard in pipeline (medium risk):**
In `pipeline.py`'s `react_loop`, after the first planner step, check:
- If the emitted tool is `search_bangumi` and no `resolve_anime` has been observed yet
- AND no `bangumi_id` is in the step params
- Then inject a synthetic `resolve_anime` step before executing the `search_bangumi`

This acts as a safety net for when the LLM ignores the prompt.

**Option C — Both (recommended):**
Apply Option A for the common case + Option B as a safety net.

**Acceptance Criteria:**
- [ ] "響け！ユーフォニアムの聖地" returns >0 results
- [ ] "Your Name" still works (regression check)
- [ ] "東京タワー周辺の聖地" (location query) does NOT trigger resolve_anime
- [ ] Planner with `include_debug=true` shows resolve_anime as first step for anime queries
- [ ] Unit test: mock planner that skips resolve_anime → pipeline injects it (if Option B chosen)

---

### Task 3: Remove or Populate ui.props

**Severity:** MEDIUM (tech debt)
**Files:**
- `backend/interfaces/public_api.py` (line 571)
- `frontend/components/generative/registry.ts` (read-only, for understanding)

**Problem:**
`_pipeline_result_to_public_response` always sets `ui.props: {}`:
```python
ui = {"component": component, "props": {}} if component else None
```

The frontend's `registry.ts` ignores `ui.props` entirely — each renderer reads from `response.data`:
```typescript
PilgrimageGrid: (response) =>
  isSearchData(response.data) ? createElement(PilgrimageGrid, { data: response.data }) : null,
```

So `ui.props` is dead code in the response. It occupies bytes in every SSE frame but is never read.

**Solution (choose one):**

**Option A — Remove ui.props (simplest, recommended):**
Change line 571 to:
```python
ui = {"component": component} if component else None
```
Update `PublicAPIResponse.ui` type hint to `dict[str, str] | None`.
Frontend already doesn't use `props`, so no frontend change needed.

**Option B — Populate ui.props with response.data:**
```python
ui = {"component": component, "props": data_dict} if component else None
```
Then migrate frontend renderers to read from `response.ui.props` instead of `response.data`.
This is more work and doesn't add value — the data is already in `response.data`.

**Acceptance Criteria:**
- [ ] API response `ui` field either has no `props` key or has populated props
- [ ] Frontend renders search results correctly (no regression from #1 fix)
- [ ] SSE stream `done` event has consistent ui shape

---

## Iteration Phases

### Phase 1 (parallel — no file overlap):
- **Task 1** (frontend: `AppShell.tsx`) — Session hydration
- **Task 2** (backend: `planner_agent.py`, optionally `pipeline.py`) — resolve_anime enforcement

### Phase 2 (after Phase 1 merges):
- **Task 3** (backend: `public_api.py`) — ui.props cleanup
  - Depends on Task 1 being merged so we can verify end-to-end

## Verification Plan

After all tasks merge:
1. Deploy to production (`npx wrangler@4 deploy`)
2. Run `/qa` against `seichijunrei.zhenjia.org`
3. Verify:
   - Search "Your Name" → result panel shows pilgrimage spots
   - Search "響け！ユーフォニアム" → result panel shows Uji/Kyoto spots
   - Reload page → previous conversation is restored
   - Click "New chat" → clean start
   - API response `ui` field is clean

## Dependencies

- Pipeline fix `e004977` must be deployed before Task 1/2 can be fully verified
- Supabase Dashboard Site URL must be updated before auth flow QA

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|------------|
| Task 1 | Race condition if fetch completes after user starts typing | Abort fetch on user interaction |
| Task 2 Option B | Synthetic step injection may confuse planner's observation history | Test with multi-turn queries |
| Task 3 | Frontend might have hidden dependency on `ui.props` | Grep frontend for `ui.props` or `ui?.props` before removing |
