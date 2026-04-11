# Frontend Engineering Architecture Review

**Date:** 2026-04-09
**Reviewer:** Claude Opus 4.6 (1M context)
**Scope:** All TypeScript/TSX files under `frontend/` (48 source files, ~5.2K lines excl. node_modules/out)
**Review type:** /plan-eng-review (architecture, code quality, test coverage, performance, accessibility, i18n)

---

## Table of Contents

1. [Architecture Review](#1-architecture-review)
2. [Code Quality Review](#2-code-quality-review)
3. [Test Coverage Review](#3-test-coverage-review)
4. [Performance Review](#4-performance-review)
5. [Accessibility & i18n Review](#5-accessibility--i18n-review)
6. [Issue Registry](#6-issue-registry)
7. [Action Items](#7-action-items)
8. [Scorecard](#8-scorecard)

---

## 1. Architecture Review

### Component Tree Diagram

```
RootLayout (app/layout.tsx)
  LocaleProvider (i18n-context.tsx)
    Home (app/page.tsx)
      AuthGate (auth/AuthGate.tsx) ............. 466 lines [!]
        [unauthenticated] Landing Page (inline)
        [authenticated] AppShell (layout/AppShell.tsx) ... 467 lines [!]
          PointSelectionContext.Provider
            Sidebar (layout/Sidebar.tsx) ........... 295 lines
            ChatHeader (layout/ChatHeader.tsx) ...... 46 lines
            MessageList (chat/MessageList.tsx) ...... 107 lines
              MessageBubble (chat/MessageBubble.tsx)  368 lines [!]
                ThinkingProcess (chat/ThinkingProcess.tsx)
                InlineSummaryCard (inline)
                ResultAnchor (inline)
                FeedbackButtons (inline)
            ChatInput (chat/ChatInput.tsx) ......... 129 lines
            ResultDrawer (layout/ResultDrawer.tsx) .. 74 lines  [mobile]
            SlideOverPanel (layout/SlideOverPanel.tsx) 64 lines [desktop]
            FullscreenOverlay (layout/FullscreenOverlay.tsx) 39 lines [desktop]
              GenerativeUIRenderer (generative/GenerativeUIRenderer.tsx)
                PilgrimageGrid (generative/PilgrimageGrid.tsx) .. 263 lines
                NearbyMap (generative/NearbyMap.tsx) ............ 89 lines
                RouteVisualization (generative/RouteVisualization.tsx) 89 lines
                RoutePlannerWizard (generative/RoutePlannerWizard.tsx) 445 lines [!]
                GeneralAnswer (generative/GeneralAnswer.tsx) .... 18 lines
                Clarification (generative/Clarification.tsx) .... 50 lines
                SelectionBar (generative/SelectionBar.tsx) ...... 70 lines
    SettingsPage (app/settings/page.tsx)
      ApiKeysPage (settings/ApiKeysPage.tsx) ....... 122 lines
    AuthCallbackPage (app/auth/callback/page.tsx)
      AuthCallbackPage (auth/AuthCallbackPage.tsx) . 94 lines

Map components (dynamic import, SSR: false):
  PilgrimageMap (map/PilgrimageMap.tsx) ............ 100 lines
```

### Data Flow Diagram

```
                           State Sources
                     ┌─────────────────────────┐
                     │  useSession (localStorage)│
                     │  useChat (useState)       │
                     │  usePointSelection (Set)  │
                     │  useConversationHistory   │
                     │  useMediaQuery            │
                     └───────────┬───────────────┘
                                 │
              AppShell (orchestrates all state)
              ┌──────────────────┼────────────────────┐
              │                  │                     │
     ┌────────▼──────┐  ┌───────▼────────┐  ┌────────▼──────────┐
     │   Sidebar     │  │  Chat Column   │  │  Result Display   │
     │ conversations │  │  messages[]    │  │  activeResponse   │
     │ routes[]      │  │  send()        │  │                   │
     └───────────────┘  │  ChatInput     │  │ Mobile: Drawer    │
                        └────────────────┘  │ Desktop: SlideOver│
                                            │  or Fullscreen    │
                                            └───────────────────┘
              Context: PointSelectionContext
              ┌──────────────────────────────────────────┐
              │  selectedIds: Set<string>                 │
              │  toggle(id)  clear()                      │
              │  Consumed by: PilgrimageGrid, NearbyMap,  │
              │    SelectionBar, ResultPanel, ResultDrawer │
              └──────────────────────────────────────────┘

              API Layer (lib/api.ts)
              ┌──────────────────────────────────────────┐
              │  sendMessageStream() -> SSE -> RuntimeResp│
              │  sendSelectedRoute() -> POST -> RuntimeResp│
              │  fetchConversations() -> GET              │
              │  fetchConversationMessages() -> GET       │
              │  submitFeedback() -> POST                 │
              │  Auth: Supabase JWT via getAuthHeaders()  │
              └──────────────────────────────────────────┘

              i18n Layer (lib/i18n-context.tsx)
              ┌──────────────────────────────────────────┐
              │  LocaleProvider -> React.Context          │
              │  useDict(), useLocale(), useSetLocale()   │
              │  3 dictionaries: ja.json, zh.json, en.json│
              │  Lazy-loaded via dynamic import()         │
              └──────────────────────────────────────────┘
```

### Architecture Evaluation

**Strengths:**
- Clean registry pattern for generative UI components (add new component = register in `registry.ts`)
- Proper SSE streaming with abort controller support
- Centralized API layer with consistent auth header injection
- Smart responsive strategy: mobile Drawer vs desktop SlideOver/Fullscreen
- Good separation of domain types mirroring backend contracts
- `PointSelectionContext` avoids prop drilling for cross-cutting selection state
- Static export (`output: 'export'`) is correct for CF Worker deployment

**Weaknesses:**
- AppShell is a god component (467 lines, 11 `useState`, 5 `useEffect`, 8 `useCallback`)
- AuthGate mixes landing page, auth modal, and scroll-reveal logic in one 466-line file
- No error boundary anywhere in the tree
- No suspense boundaries for lazy-loaded components
- State is fully client-side with no URL sync (no deep linking to conversations or results)

---

## 2. Code Quality Review

### Issue #1 — P0 — AppShell god component
**File:** `frontend/components/layout/AppShell.tsx`
**Confidence:** 10/10

AppShell has 11 `useState` calls, 5 `useEffect` calls, and 8 `useCallback` wrappers totaling 467 lines. It orchestrates chat, session, conversations, point selection, route sending, sidebar, drawers, slide-over, and fullscreen overlays. This is the single biggest risk for bugs and re-render cascading.

### Issue #2 — P0 — AuthGate god component
**File:** `frontend/components/auth/AuthGate.tsx`
**Confidence:** 10/10

466 lines combining: landing hero section, comparison section, features section, footer, auth modal with magic link, scroll-reveal IntersectionObserver, and locale switcher. Should be decomposed into `LandingPage`, `AuthModal`, and `ScrollReveal` components.

### Issue #3 — P1 — MessageBubble oversized with inline sub-components
**File:** `frontend/components/chat/MessageBubble.tsx`
**Confidence:** 9/10

368 lines. Contains 5 sub-functions (`ErrorDisplay`, `canShowAnchor`, `getResultCount`, `InlineSummaryCard`, `ResultAnchor`, `FeedbackButtons`). The inline sub-components should be extracted to separate files.

### Issue #4 — P1 — RoutePlannerWizard oversized with duplicated timeline UI
**File:** `frontend/components/generative/RoutePlannerWizard.tsx`
**Confidence:** 9/10

445 lines. The timeline rendering is duplicated between `TimelineSidebar` (desktop) and the Drawer content (mobile) at lines 84-122 and 352-392 respectively. Extract a shared `TimelineStopList` component.

### Issue #5 — P1 — 6 `as unknown as` casts bypass type safety
**Files:** `lib/api.ts:228,230`, `MessageBubble.tsx:208`, `AppShell.tsx:80,207`, `registry.ts:38`
**Confidence:** 8/10

These casts occur at trust boundaries (SSE parse, hydration, registry). Most are acceptable but the hydration casts in AppShell (lines 80 and 207) deserve runtime validation to prevent silent data corruption.

### Issue #6 — P2 — Module-level mutable state in useChat
**File:** `frontend/hooks/useChat.ts:7`
**Confidence:** 7/10

`let msgCounter = 0` is a module-level mutable variable used for ID generation. In a static export this is fine, but it could cause ID collisions in SSR or concurrent rendering scenarios. Use `crypto.randomUUID()` or similar.

### Issue #7 — P2 — Hardcoded strings in several components
**Files:** `RouteVisualization.tsx:58` ("在 Google Maps 中打开"), `RoutePlannerWizard.tsx:79,103,127-143,248,327,349,375-409`
**Confidence:** 9/10

Multiple Japanese strings are hardcoded instead of using i18n dictionary keys. This makes zh/en locales show Japanese text.

### Issue #8 — P2 — Inconsistent CSS approach
**Confidence:** 7/10

Three CSS strategies coexist:
1. CSS custom properties via `var()` (primary approach, correct per AGENTS.md)
2. Tailwind utility classes (via shadcn primitives)
3. Hardcoded `bg-gray-200` in `ResultDrawer.tsx:63` and `SlideOverPanel.tsx:51-54`

The `bg-gray-200` instances break the palette consistency.

### Issue #9 — P2 — Unused `_pacing` and `_dict` variables
**File:** `frontend/components/generative/RoutePlannerWizard.tsx:199,201`
**Confidence:** 10/10

`_dict` and `_pacing` are assigned but never used (prefixed with underscore to suppress lint, but the pacing Tabs UI changes are never propagated to any API call or re-render).

### Issue #10 — P2 — `parseResponseData` is defined but only used internally
**File:** `frontend/lib/api.ts:27-34`
**Confidence:** 6/10

The function handles string-or-object parsing but the `as Record<string, unknown>` return means callers still need their own type narrowing. Consider using a Zod schema at this boundary.

---

## 3. Test Coverage Review

### Test Files Found

```
frontend/tests/
  conversation-history.test.ts  — 5 tests (pure functions)
  conversation-api.test.ts      — 7 tests (API + SSE mocks)
  supabase-config.test.ts       — 1 test (env var fallback)
```

### Coverage Map

```
TESTED                              │  UNTESTED
────────────────────────────────────┼──────────────────────────────────────
lib/conversation-history.ts    [5]  │  components/auth/AuthGate.tsx
lib/api.ts (partial)           [7]  │  components/auth/AuthCallbackPage.tsx
lib/supabase.ts (partial)      [1]  │  components/layout/AppShell.tsx
                                    │  components/layout/Sidebar.tsx
                                    │  components/layout/ChatHeader.tsx
                                    │  components/layout/ResultPanel.tsx
                                    │  components/layout/ResultDrawer.tsx
                                    │  components/layout/SlideOverPanel.tsx
                                    │  components/layout/FullscreenOverlay.tsx
                                    │  components/chat/MessageList.tsx
                                    │  components/chat/MessageBubble.tsx
                                    │  components/chat/ChatInput.tsx
                                    │  components/chat/ThinkingProcess.tsx
                                    │  components/generative/GenerativeUIRenderer.tsx
                                    │  components/generative/registry.ts
                                    │  components/generative/PilgrimageGrid.tsx
                                    │  components/generative/NearbyMap.tsx
                                    │  components/generative/RouteVisualization.tsx
                                    │  components/generative/RoutePlannerWizard.tsx
                                    │  components/generative/GeneralAnswer.tsx
                                    │  components/generative/Clarification.tsx
                                    │  components/generative/SelectionBar.tsx
                                    │  components/map/PilgrimageMap.tsx
                                    │  components/settings/ApiKeysPage.tsx
                                    │  hooks/useChat.ts
                                    │  hooks/useSession.ts
                                    │  hooks/usePointSelection.ts
                                    │  hooks/useMediaQuery.ts
                                    │  hooks/useConversationHistory.ts
                                    │  contexts/PointSelectionContext.tsx
                                    │  lib/i18n.ts
                                    │  lib/i18n-context.tsx
                                    │  lib/api-keys.ts
                                    │  lib/japanRegions.ts
                                    │  lib/types.ts (type guards)
                                    │  lib/utils.ts
```

### ASCII Coverage Diagram

```
 Component Coverage (48 source files)

 Tested  ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3/48  (~6%)
 Partial ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 None    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  45/48 (~94%)

 By category:
   lib/ pure functions     ████████████████░░░░  3/8   (38%)
   hooks/                  ░░░░░░░░░░░░░░░░░░░░  0/5   (0%)
   components/ (27 files)  ░░░░░░░░░░░░░░░░░░░░  0/27  (0%)
   contexts/               ░░░░░░░░░░░░░░░░░░░░  0/1   (0%)
   app/ pages              ░░░░░░░░░░░░░░░░░░░░  0/4   (0%)

 E2E / Integration tests:   NONE
 Accessibility tests:       NONE
 Visual regression tests:   NONE
```

### Issue #11 — P0 — Near-zero component test coverage
**Confidence:** 10/10

Zero component tests exist. All 27 component files and all 5 hooks are untested. The existing 13 tests cover only pure utility functions and API mocking. No React Testing Library, no `@testing-library/react`, no jsdom setup.

### Issue #12 — P1 — No E2E test infrastructure
**Confidence:** 10/10

No Playwright, Cypress, or similar E2E framework. Critical user flows (login, send message, view results, select points, create route) have no automated testing.

### Issue #13 — P1 — No test for type guards
**File:** `frontend/lib/types.ts:217-235`
**Confidence:** 8/10

`isSearchData`, `isRouteData`, `isQAData`, `isTimedRouteData` are critical branching functions used throughout the UI. They have zero tests.

---

## 4. Performance Review

### Issue #14 — P1 — AppShell re-renders cascade to entire tree
**File:** `frontend/components/layout/AppShell.tsx`
**Confidence:** 8/10

AppShell has 11 `useState` hooks. Any state change (e.g., `setActiveMessageId`, `setDrawerOpen`, `setSidebarOpen`) triggers a full re-render of: Sidebar, MessageList (all MessageBubbles), ChatInput, ResultDrawer, SlideOverPanel, and FullscreenOverlay. None of these child components are wrapped in `React.memo()`.

### Issue #15 — P1 — Messages list re-renders all bubbles on every state change
**File:** `frontend/components/chat/MessageList.tsx`
**Confidence:** 8/10

`MessageBubble` is not memoized. During SSE streaming, `setMessages` is called for every step event, causing the entire message list to re-render. With many messages, this creates visible jank.

### Issue #16 — P2 — Leaflet map re-initialization
**File:** `frontend/components/map/PilgrimageMap.tsx`
**Confidence:** 7/10

`PilgrimageMap` is dynamically imported but not memoized. Each render creates a new `MapContainer`. When the parent re-renders (e.g., AppShell state change), the map may re-initialize. The `FitBounds` effect depends on `[map, points]` which is stable, but the map container itself re-mounts if the parent unmounts/remounts.

### Issue #17 — P2 — External font loaded via CSS @import blocks rendering
**File:** `frontend/app/globals.css:1`
**Confidence:** 7/10

Google Fonts are loaded via `@import url(...)` in CSS, which is render-blocking. Additionally, the Geist font is loaded via `next/font/google` in layout.tsx. This creates two separate font loading strategies, potentially causing FOIT/FOUT.

### Issue #18 — P2 — No image optimization
**Confidence:** 8/10

All images use raw `<img>` tags with `loading="lazy"` (e.g., PilgrimageGrid screenshots). `next/image` is not used anywhere. Given `output: 'export'`, the Next.js Image Optimization API is unavailable, so this is expected — but width/height attributes are missing, causing layout shifts (CLS).

### Issue #19 — P2 — Large Leaflet CSS imported globally
**File:** `frontend/components/map/PilgrimageMap.tsx:7`
**Confidence:** 6/10

`import "leaflet/dist/leaflet.css"` is imported in a dynamically-loaded component. This is acceptable since the map is code-split, but the CSS still gets bundled into a separate chunk that loads eagerly once any map view is triggered.

---

## 5. Accessibility & i18n Review

### Accessibility

#### Issue #20 — P1 — No skip-to-content link
**Confidence:** 9/10

No skip navigation link exists. Keyboard users must tab through the entire sidebar and header to reach the chat input.

#### Issue #21 — P1 — Chat message list has no ARIA live region
**File:** `frontend/components/chat/MessageList.tsx`
**Confidence:** 9/10

New assistant messages are appended to the DOM without `aria-live` or `role="log"` attributes. Screen readers will not announce new messages.

#### Issue #22 — P1 — PilgrimageGrid cards use button without accessible label
**File:** `frontend/components/generative/PilgrimageGrid.tsx:27-94`
**Confidence:** 8/10

Each pilgrimage card is a `<button>` with `aria-pressed` but no `aria-label`. The accessible name comes from child text content, which may be truncated or in a language the screen reader doesn't support.

#### Issue #23 — P2 — Sidebar conversation items are not keyboard-navigable list
**File:** `frontend/components/layout/Sidebar.tsx:143-184`
**Confidence:** 7/10

Conversation items are `<div>` elements with `onClick` handlers but no `role="button"`, `tabIndex`, or keyboard event handlers. They are not focusable via Tab.

#### Issue #24 — P2 — Auth modal has no focus trap
**File:** `frontend/components/auth/AuthGate.tsx:372-450`
**Confidence:** 8/10

The auth modal overlay is a plain `<div>` with no focus trap. Tab can escape to the background content. Should use a dialog element or focus-trap library.

#### Issue #25 — P2 — Color contrast potentially insufficient for muted text
**File:** `frontend/app/globals.css`
**Confidence:** 6/10

`--color-muted-fg: oklch(54% 0.032 228)` against `--color-bg: oklch(98% 0.008 218)` — the 54% lightness may be below 4.5:1 contrast for small text. Needs manual verification with a contrast checker.

### i18n

#### Issue #26 — P1 — Hardcoded Japanese strings in RoutePlannerWizard
**File:** `frontend/components/generative/RoutePlannerWizard.tsx`
**Confidence:** 10/10

At least 12 hardcoded Japanese strings: "タイムライン", "サマリー", "スポット", "所要時間", "移動距離", "ゆっくり", "普通", "詰め込み", "徒歩", "滞在", "スポット一覧", "タイムラインを開く". These bypass the i18n system and show Japanese for all locales.

#### Issue #27 — P1 — Hardcoded Chinese string in RouteVisualization
**File:** `frontend/components/generative/RouteVisualization.tsx:58`
**Confidence:** 10/10

`"在 Google Maps 中打开"` is hardcoded Chinese, visible to ja/en users.

#### Issue #28 — P2 — ApiKeysPage is entirely in English
**File:** `frontend/components/settings/ApiKeysPage.tsx`
**Confidence:** 9/10

All strings ("API Keys", "Create key", "Revoke", etc.) are hardcoded English. No i18n dictionary keys are used.

#### Issue #29 — P2 — No RTL support consideration
**Confidence:** 5/10

Not critical currently (ja/zh/en are all LTR), but the architecture has no `dir` attribute or logical CSS properties for future RTL locales. Low priority.

#### Issue #30 — P2 — Dictionary load race on initial mount
**File:** `frontend/lib/i18n-context.tsx:24-29`
**Confidence:** 7/10

If `detectLocale()` returns `"zh"` or `"en"`, the `useEffect` calls `loadDict()` asynchronously. Between mount and dict load completion, the UI shows Japanese (`defaultDict`). This causes a brief flash of Japanese content for non-Japanese users.

---

## 6. Issue Registry

| # | Sev | Confidence | Category | File | Summary |
|---|-----|-----------|----------|------|---------|
| 1 | P0 | 10 | Quality | AppShell.tsx | God component: 11 useState, 467 lines |
| 2 | P0 | 10 | Quality | AuthGate.tsx | God component: 466 lines, mixing concerns |
| 3 | P1 | 9 | Quality | MessageBubble.tsx | 368 lines, 5 inline sub-components |
| 4 | P1 | 9 | Quality | RoutePlannerWizard.tsx | 445 lines, duplicated timeline UI |
| 5 | P1 | 8 | Quality | Multiple | 6 `as unknown as` casts at boundaries |
| 6 | P2 | 7 | Quality | useChat.ts:7 | Module-level mutable counter |
| 7 | P2 | 9 | i18n | Multiple | Hardcoded strings bypass i18n |
| 8 | P2 | 7 | Quality | Multiple | Inconsistent CSS (bg-gray-200) |
| 9 | P2 | 10 | Quality | RoutePlannerWizard.tsx:199,201 | Unused variables |
| 10 | P2 | 6 | Quality | api.ts:27-34 | Unvalidated JSON parse at boundary |
| 11 | P0 | 10 | Testing | - | Zero component/hook tests (94% untested) |
| 12 | P1 | 10 | Testing | - | No E2E test infrastructure |
| 13 | P1 | 8 | Testing | types.ts | Type guard functions untested |
| 14 | P1 | 8 | Perf | AppShell.tsx | Re-render cascade from 11 state vars |
| 15 | P1 | 8 | Perf | MessageList.tsx | MessageBubble not memoized |
| 16 | P2 | 7 | Perf | PilgrimageMap.tsx | Potential map re-initialization |
| 17 | P2 | 7 | Perf | globals.css:1 | Render-blocking font @import |
| 18 | P2 | 8 | Perf | Multiple | No width/height on images (CLS) |
| 19 | P2 | 6 | Perf | PilgrimageMap.tsx:7 | Leaflet CSS bundle size |
| 20 | P1 | 9 | A11y | layout.tsx | No skip-to-content link |
| 21 | P1 | 9 | A11y | MessageList.tsx | No aria-live for chat messages |
| 22 | P1 | 8 | A11y | PilgrimageGrid.tsx | Card buttons lack accessible labels |
| 23 | P2 | 7 | A11y | Sidebar.tsx | Conversation items not focusable |
| 24 | P2 | 8 | A11y | AuthGate.tsx | Modal has no focus trap |
| 25 | P2 | 6 | A11y | globals.css | Muted text contrast may fail WCAG |
| 26 | P1 | 10 | i18n | RoutePlannerWizard.tsx | 12+ hardcoded Japanese strings |
| 27 | P1 | 10 | i18n | RouteVisualization.tsx:58 | Hardcoded Chinese string |
| 28 | P2 | 9 | i18n | ApiKeysPage.tsx | All English, no i18n |
| 29 | P2 | 5 | i18n | - | No RTL support |
| 30 | P2 | 7 | i18n | i18n-context.tsx | Flash of Japanese for non-ja users |

---

## 7. Action Items (Priority-Ordered)

### P0 — Must fix before next release

1. **Add component test infrastructure.** Install `@testing-library/react`, `vitest` (or extend existing Node test runner with jsdom), and write tests for: `useChat`, `useSession`, `usePointSelection`, `MessageBubble`, `GenerativeUIRenderer`, `registry.ts` (intentToComponent + isVisualResponse), and type guards in `types.ts`. Target: 40% coverage.

2. **Break up AppShell.** Extract: `useAppShellState()` custom hook for the 11 state variables + effects, `ConversationSwitcher` for conversation selection logic, `ResultOverlay` for the slide-over/fullscreen/drawer routing logic.

3. **Break up AuthGate.** Extract: `LandingPage` (hero + comparison + features + footer), `AuthModal` (form + state), `ScrollRevealSection` (IntersectionObserver wrapper).

### P1 — Should fix within 2 iterations

4. **Add error boundaries.** Wrap `GenerativeUIRenderer` and `PilgrimageMap` in React error boundaries to prevent crashes from propagating to the entire app.

5. **Memoize MessageBubble and child components.** Wrap `MessageBubble` in `React.memo()` with a stable comparator. Extract `InlineSummaryCard`, `ResultAnchor`, `FeedbackButtons` to separate files.

6. **Extract shared TimelineStopList.** Deduplicate timeline rendering in `RoutePlannerWizard.tsx` between desktop sidebar and mobile drawer.

7. **Move all hardcoded strings to i18n dictionaries.** `RoutePlannerWizard.tsx` (12+ strings), `RouteVisualization.tsx:58`, `ApiKeysPage.tsx` (all strings).

8. **Add aria-live region to MessageList.** Add `role="log"` and `aria-live="polite"` to the message container.

9. **Add skip-to-content link** in `layout.tsx` targeting the chat input.

10. **Add E2E test framework.** Set up Playwright with at least 3 smoke tests: login flow, send message + view result, select points + create route.

### P2 — Nice to have

11. Fix `bg-gray-200` instances in `ResultDrawer.tsx` and `SlideOverPanel.tsx` to use `var(--color-muted)`.
12. Add `width` and `height` attributes to `<img>` tags in PilgrimageGrid to prevent CLS.
13. Replace `@import url(...)` font loading with `next/font/google` for Shippori Mincho.
14. Add focus trap to auth modal (use `@base-ui/react` Dialog or equivalent).
15. Make sidebar conversation items keyboard-focusable with `tabIndex={0}` and `role="button"`.
16. Add runtime validation for hydrated message data in AppShell.
17. Address `_pacing`/`_dict` unused variables in RoutePlannerWizard.
18. Replace module-level `msgCounter` with `crypto.randomUUID()`.

---

## 8. Scorecard

```
 Category        Grade  Notes
 ─────────────── ────── ──────────────────────────────────────
 Architecture      B    Clean registry pattern, good data flow,
                        but AppShell/AuthGate are god components
                        and no error boundaries exist.

 Code Quality      B-   No `any` types (good), consistent naming,
                        but 4 oversized components and hardcoded
                        strings. 6 type-unsafe casts at boundaries.

 Test Coverage     F    6% file coverage. Zero component tests,
                        zero hook tests, zero E2E tests. Only
                        pure utility functions are tested.

 Performance       C+   Correct code-splitting for maps. SSE
                        streaming is well-implemented. But no
                        memoization, render cascades from AppShell,
                        and render-blocking font loading.

 Accessibility     D+   Focus-visible styles exist (good). Touch
                        targets are considered. But no skip link,
                        no aria-live, no focus trap, and non-
                        focusable interactive elements.

 i18n              C    3-locale dictionary system works well.
                        But 15+ hardcoded strings in components
                        and one entire page (ApiKeys) with no
                        i18n. Flash-of-wrong-locale on mount.

 ─────────────── ────── ──────────────────────────────────────
 Overall           C+   Solid foundation with clear architectural
                        intent. Main gaps: test coverage (F),
                        component decomposition, and i18n
                        completeness. Priority: tests first.
```

---

*Review generated 2026-04-09 by Claude Opus 4.6 (1M context)*
