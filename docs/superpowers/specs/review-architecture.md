# Architecture & DRY Review

Date: 2026-04-22
Scope: frontend architecture, duplication, file sizes, tests

## Summary
- Components reviewed: 53
- Dedicated tests: 24 (~46%)
- Files exceeding 300 lines: 4 hard violations + 1 borderline
- No circular dependencies detected

## File Size Violations
- `frontend/lib/mock-data.ts` — 593 lines
- `frontend/components/auth/LandingPage.tsx` — 462 lines
- `frontend/components/layout/ResultPanel.tsx` — 402 lines
- `frontend/components/generative/RouteConfirm.tsx` — 375 lines
- `frontend/components/layout/AppShell.tsx` — 298 lines (watch)

## DRY Violations
1. Color helper duplication (`colorValue`) across NearbyBubble / NearbyChips / RouteConfirm
2. API error handling boilerplate repeated in `lib/api/*`
3. Chat message construction duplicated in `useChat` and `useRouteSelection`
4. Bounds computation duplicated in `BaseMap`
5. Several nearly-identical card components in `Clarification.tsx`

## Positive Findings
- Strong module boundaries: components → hooks → lib → types
- No circular imports found
- Type exports/barrel pattern in `lib/types/` is solid
- Context usage (SuggestContext, PointSelectionContext, i18n) reduces prop drilling well

## Test Coverage Gaps
Missing direct tests for:
- `BaseMap.tsx`
- `PilgrimageMap.tsx`
- `GeneralAnswer.tsx`
- `FallbackList.tsx`
- `MessageList.tsx`
- `NearbyBubbleWrapper.tsx`
- `ResultAnchor.tsx`
- `AuthCallbackPage.tsx`
- `LandingPage.tsx`
- several hooks (`useLayoutMode`, `useSession`, `usePointSelection`, etc.)

## Dependency Graph (ASCII)

Components -> Hooks -> API/Lib -> Types
         \-> Contexts (orthogonal)

AppShell
 ├─ ChatPanel
 │   └─ MessageBubble
 │       └─ ClarificationBubble / NearbyBubbleWrapper
 ├─ ResultPanel
 │   ├─ Grid / Map / RouteConfirm / SpotDetail
 │   └─ GenerativeUIRenderer -> registry -> feature components
 └─ Drawers / Sheets / Popup

## Recommended Refactors
1. Split `mock-data.ts`
2. Extract shared API error handler
3. Extract shared chat message factory
4. Split `ResultPanel` into filters/states/main
5. Split `LandingPage` sections
