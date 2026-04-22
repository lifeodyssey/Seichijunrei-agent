# Code Quality Review

Date: 2026-04-22
Scope: `frontend/components/`, `frontend/hooks/`
Reviewer: generated from full code quality review

## Summary
- P0: 3
- P1: 12
- P2: 12
- Main themes: unsafe external URL usage, stale hook dependencies, dead props/dead code, file-size violations, duplication, i18n drift

## Critical

### C1. External URLs rendered and opened without validation
- Files: multiple (`Clarification.tsx`, `NearbyBubble.tsx`, `NearbyMap.tsx`, `PhotoCard.tsx`, `PilgrimageGrid.tsx`, `RouteConfirm.tsx`, `RouteTimeline.tsx`, `SpotDetail.tsx`, `WelcomeScreen.tsx`, `BaseMap.tsx`, `RouteVisualization.tsx`, `useRouteExport.ts`)
- Risk: untrusted `screenshot_url` / `cover_url` flows into `<img src>` and `window.open()`
- Recommendation: add `isSafeUrl()` utility and enforce http/https only before rendering/opening.

### C2. Unsafe `as unknown as` cast in `registry.ts`
- File: `frontend/components/generative/registry.ts`
- Recommendation: replace with proper type guard usage (`isClarifyData`).

### C3. Hardcoded user-facing strings still present
- Files: `ResultPanel.tsx`, `ResultPanelToolbar.tsx`, `ConversationDrawer.tsx`, others
- Recommendation: move all UI text to dictionaries and consume via `useDict()`.

## High

### H1. `ChatPanel` has dead `onSuggest` prop
- File: `frontend/components/chat/ChatPanel.tsx`
- Recommendation: remove prop if truly unused.

### H2. `console.error` in hooks with no user surfacing
- Files: `useSessionHydration.ts`, `useConversationHistory.ts`
- Recommendation: route through shared error reporting or user-visible state.

### H3. `useSessionHydration` suppressed exhaustive-deps may hide session-switch bug
- File: `frontend/hooks/useSessionHydration.ts`
- Recommendation: include `sessionId` in deps with a ref guard.

### H4. `i18n-context.tsx` suppressed exhaustive-deps
- File: `frontend/lib/i18n-context.tsx`
- Recommendation: add `locale` to deps with safe guard.

### H5. `useRouteSelection` duplicate logic
- File: `frontend/hooks/useRouteSelection.ts`
- Recommendation: extract shared `executeRouteRequest(ids, origin)`.

### H6. Hardcoded Tailwind whites/blacks in many places
- Files: `WelcomeScreen.tsx`, `PilgrimageGrid.tsx`, `LandingPage.tsx`, `AppShell.tsx`, `SlideOverPanel.tsx`, `ResultSheet.tsx`, `ConversationDrawer.tsx`, `AuthModal.tsx`, `MobileTimelineDrawer.tsx`, `ui/sheet.tsx`
- Recommendation: use CSS variables instead of `text-white`, `bg-black/*`, etc.

### H7. Duplicate bounds logic in `BaseMap`
- File: `frontend/components/map/BaseMap.tsx`
- Recommendation: extract `computeBounds(points)`.

### H8. `SourceBadge` uses inline rgba values
- File: `frontend/components/generative/SourceBadge.tsx`
- Recommendation: replace with tokenized color/shadow variables.

### H9. Stale `eslint-disable` in `map/prewarm.ts`
- File: `frontend/components/map/prewarm.ts`
- Recommendation: remove once typed properly.

## Medium
- `Clarification.tsx` has three near-identical card components — extract shared ActionCard.
- `ResultPanel.tsx`, `LandingPage.tsx`, `RouteConfirm.tsx` exceed file-size guidelines.
- `useMockChat.ts` appears dead in production bundle.
- `BaseMap.tsx` inline marker colors should use tokens.
- `ResultSheet.tsx` has unused `onSuggest` prop.
- `ConversationDrawer.tsx` clickable div should likely be a button.

## eslint-disable Audit
- Removable directives identified across components/hooks/lib: 14
- Generated file exception: `public/mockServiceWorker.js`
- Test-file exceptions: 2

## Recommendation Order
1. Fix URL validation + `window.open()` security
2. Fix stale hook deps and dead props
3. Consolidate duplicated route request logic
4. Extract shared UI cards / bounds helper
5. Split oversized files
