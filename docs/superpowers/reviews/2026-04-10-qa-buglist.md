# QA Bug List — 2026-04-10

Date: 2026-04-10
Branch: main (067f4d3)
Tested: local dev (localhost:3000 + localhost:8080) + production (seichijunrei.zhenjia.org)
Tester: Claude + user manual verification
Total bugs: 27 (4 fixed locally, 23 not fixed)

## Summary

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 5 | 2 | 3 |
| High | 10 | 1 | 9 |
| Medium | 8 | 1 | 7 |
| Low | 4 | 0 | 4 |

### Features tested
| Feature | Backend | Frontend | Verdict |
|---------|---------|----------|---------|
| Anime search | Works | Renders with issues | Partial |
| Nearby search | Works | Renders with issues | Partial |
| Route planning | Clarify works, context lost | Empty response shown | Broken |
| History switch | API works | Wrong session loaded | Broken |
| New chat | N/A | Doesn't clear | Broken |
| Login | Works | Works | OK |

## Critical (app crash / feature broken)

### BUG-01: type guard null crash → "This page couldn't load"
- **File**: `frontend/lib/types.ts:217-234`
- **Symptom**: Next.js error boundary triggers on page load when historical messages have `data: undefined`
- **Root cause**: `isSearchData()`, `isRouteData()`, `isQAData()`, `isTimedRouteData()` use `"X" in data` without null check
- **Status**: FIXED locally (added `data != null` guards)

### BUG-02: MessageBubble null crash
- **File**: `frontend/components/chat/MessageBubble.tsx:137,158`
- **Symptom**: `getResultCount()` and `InlineSummaryCard` crash on `data.length` when data is undefined
- **Root cause**: No null guard before accessing response.data
- **Status**: FIXED locally (added early return)

### BUG-03: Route planning silently fails — empty response
- **File**: `backend/agents/pipeline.py:56-58`, `backend/agents/handlers/plan_route.py:20-23`, `backend/agents/planner_agent.py:264-271`
- **Symptom**: "京吹の聖地巡礼ルートを作って" returns empty bot message, no error, no thinking process
- **Root cause**: 5-layer cascading failure:
  1. `pipeline.py:56` — `executor_context` is freshly initialized each request; session search results NOT injected
  2. `planner_agent.py:264` — validator only checks current turn's `history`, rejects `plan_route` because `search_bangumi` not in current observations
  3. Planner can't call `search_bangumi` without `bangumi_id` → chicken-and-egg loop
  4. `handlers/plan_route.py:20` — `context.get("search_bangumi")` returns None → `rows = []` → failure
  5. `pipeline.py:249` — returns empty message with `success=False`, no error surfaced to user
- **Fix needed**: Inject session context (`search_bangumi`, `search_nearby`) into `executor_context` at pipeline startup; update validator to consider session context as satisfied prerequisites
- **Status**: NOT FIXED

### BUG-03b: Route planning returns clarify but frontend shows empty
- **File**: `frontend/hooks/useChat.ts`, `frontend/components/chat/MessageBubble.tsx`
- **Symptom**: Backend correctly sends clarify step ("どこから回り始めますか？") but frontend shows empty bot message
- **Root cause**: Frontend doesn't handle `needs_clarification` status or `clarify` event type from SSE. The done event has status `needs_clarification` but frontend only renders `success` responses with `data`.
- **Status**: NOT FIXED

### BUG-04: Pipeline intermittent crash → "The runtime failed before producing a pipeline result"
- **File**: `backend/agents/pipeline.py`
- **Symptom**: Some queries (e.g. ヴァイオレットエヴァーガーデン) cause pipeline to not converge within 8 steps
- **Root cause**: Planner doesn't converge; max_steps reached or LLM produces invalid output
- **Status**: NOT FIXED

## High (core functionality broken)

### BUG-05: "📍 0 results" for hydrated messages despite data existing
- **File**: `frontend/lib/api.ts`, `frontend/components/layout/AppShell.tsx:80,207`
- **Symptom**: Historical messages show "0 results" even when bot text says "111 spots found"
- **Root cause**: DB stores `response_data` as `{intent, success, final_output: {results}}` but frontend expects `{data: {results}}`. The `final_output` nesting is not unwrapped during hydration.
- **Status**: FIXED locally (added `hydrateResponseData()` helper)

### BUG-06: "+ New chat" button doesn't clear current conversation
- **File**: `frontend/components/layout/AppShell.tsx` or `frontend/hooks/useChat.ts`
- **Symptom**: Clicking "+ New chat" keeps previous messages visible in chat panel
- **Root cause**: TBD
- **Status**: NOT FIXED

### BUG-07: Response language doesn't match input language
- **File**: `backend/agents/planner_agent.py`, `backend/agents/executor_agent.py`
- **Symptom**: User asks in Japanese → bot replies in English ("I've completed my analysis")
- **Root cause**: The `done` message in `react_loop` max-steps fallback is hardcoded English. Executor static templates have locale variants but the planner's LLM thought and done messages are not locale-constrained.
- **Status**: NOT FIXED

### BUG-08: Thinking process displays raw English planner thought to user
- **File**: `frontend/components/chat/ThinkingProcess.tsx`
- **Symptom**: User sees internal reasoning like "The user asks in Japanese about pilgrimage spots..."
- **Root cause**: `thought` field from planner is rendered directly. It should be hidden or summarized in user's locale.
- **Status**: NOT FIXED

### BUG-09: Massive point duplication in nearby search results
- **File**: `backend/agents/retriever.py` or DB data
- **Symptom**: "宇治駅の近く" returns 200 results but サイゼリヤ appears 30+ times, 久美子椅 appears 40+ times
- **Root cause**: Each anime screenshot at the same physical location is a separate point. No deduplication by geographic proximity.
- **Status**: NOT FIXED

### BUG-10: "Other" group absorbs 95% of points in By Episode tab
- **File**: `frontend/components/generative/PilgrimageGrid.tsx`
- **Symptom**: Violet Evergarden results show "Other (22)" out of 23 total — almost all points lack episode data
- **Root cause**: Anitabi data for this anime doesn't have episode numbers. GroupBy falls through to "Other".
- **Status**: NOT FIXED (data quality issue + fallback UX needed)

### BUG-11: Empty results don't diagnose cause — blind retry
- **File**: `backend/agents/pipeline.py`, `backend/agents/planner_agent.py`
- **Symptom**: When search returns 0 results, system returns "status: empty" without explaining why or asking for clarification
- **Root cause**: ReAct loop treats 0-result search as success (not failure), so no retry or clarify step is triggered
- **Status**: NOT FIXED

## Medium

### BUG-12: Local dev missing X-User-Id header → 400 on conversations/routes
- **File**: `frontend/lib/api.ts:36-48`
- **Symptom**: API calls return 400 "X-User-Id header required" in local dev
- **Root cause**: Cloudflare Worker injects X-User-Id in production but local dev has no Worker
- **Status**: FIXED locally (inject from session.user.id)

### BUG-13: Failed messages persisted to DB, shown on hydration
- **File**: `backend/interfaces/public_api.py:314-326`
- **Symptom**: "The runtime failed" message appears alongside successful retry message
- **Root cause**: `_persist_messages` saves bot messages even on pipeline failure
- **Status**: NOT FIXED

### BUG-14: Result panel tab labels not localized
- **File**: `frontend/components/generative/PilgrimageGrid.tsx`
- **Symptom**: "By Episode" / "By Area" shown in English regardless of locale
- **Status**: NOT FIXED

### BUG-15: "View details →" button label not localized
- **File**: `frontend/components/chat/MessageBubble.tsx`
- **Symptom**: English button text regardless of user locale
- **Status**: NOT FIXED

### BUG-16: Map markers show default blue pins, not anime screenshots
- **File**: `frontend/components/map/MapView.tsx` or equivalent
- **Symptom**: Leaflet map uses default markers instead of thumbnail images
- **Status**: NOT FIXED (feature gap from route optimization spec)

### BUG-17: Map doesn't show route path lines
- **File**: route visualization components
- **Symptom**: No polyline connecting route points
- **Status**: NOT FIXED (feature gap)

### BUG-18: Map not fullscreen
- **File**: route visualization components
- **Symptom**: Map is constrained to result panel width
- **Status**: NOT FIXED (feature gap from spec)

### BUG-19: Nearby search doesn't group results by anime title
- **File**: `frontend/components/generative/` or `backend/agents/retriever.py`
- **Symptom**: 200 results all from one anime listed flat, not grouped by title
- **Status**: NOT FIXED

## Low

### BUG-20: Image 404 in local dev (missing /img/ proxy)
- **File**: Next.js dev server config
- **Symptom**: All point images return 404 locally
- **Root cause**: Production uses Cloudflare Worker to proxy /img/ to Anitabi CDN; local has no proxy
- **Status**: NOT FIXED (dev-only, production works)

### BUG-21: DialogContent missing DialogTitle (a11y warning)
- **File**: result panel dialog component
- **Symptom**: Radix UI accessibility warning in console
- **Status**: NOT FIXED

### BUG-22: Sidebar label "RECENT SEARCHES" is hardcoded English, not localized
- **File**: `frontend/components/layout/Sidebar.tsx` or equivalent
- **Symptom**: Sidebar shows "RECENT SEARCHES" regardless of browser locale or user language
- **Root cause**: Label not pulled from i18n dictionary
- **Status**: NOT FIXED

### BUG-23: Sidebar should say "Recent Chats" not "Recent Searches"
- **File**: same as BUG-22
- **Symptom**: Product is a chat-based app with multi-turn conversations, but sidebar implies one-shot search
- **Root cause**: Naming decision from early iteration, not updated after multi-turn was added
- **Status**: NOT FIXED

### BUG-24: Sidebar clicks load wrong session — off-by-one or ID mismatch
- **File**: `frontend/components/layout/Sidebar.tsx`, `frontend/components/layout/AppShell.tsx`
- **Symptom**: Clicking "灌篮高手巡礼" in sidebar loads "涼宮ハルヒ" conversation instead
- **Root cause**: TBD — likely sidebar list index doesn't match session ID, or conversation list ordering differs from rendered order
- **Status**: NOT FIXED

### BUG-25: Send button stays disabled after route planning completes (or fails)
- **File**: `frontend/hooks/useChat.ts` or `frontend/components/chat/InputArea.tsx`
- **Symptom**: After route planning request returns empty response, Send button remains disabled
- **Root cause**: Loading state not properly reset on empty/failed pipeline response
- **Status**: NOT FIXED

### BUG-25: waitlist table upsert returns 401 on production
- **File**: `frontend/components/auth/AuthGate.tsx:85`
- **Symptom**: Console 401 error on login attempt
- **Root cause**: Supabase RLS doesn't allow anon insert to waitlist table
- **Status**: NOT FIXED
