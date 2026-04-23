# Performance Review

Date: 2026-04-22
Scope: frontend bundle, maps, images, SSE parser

## Summary
- High: 2
- Medium: 3
- Low: 2

## High Priority

1. `PilgrimageCard` not memoized
- File: `frontend/components/generative/PilgrimageGrid.tsx`
- Impact: large result sets trigger cascade re-renders
- Fix: wrap `PilgrimageCard` in `React.memo()`

2. Missing width/height on many `<img>` elements
- Files: `BaseMap.tsx`, `PilgrimageGrid.tsx`, `PhotoCard.tsx`, `RouteTimeline.tsx`, `SpotDetail.tsx`
- Impact: layout shift (CLS)
- Fix: add intrinsic width/height or migrate to `next/image` with `unoptimized`

## Medium Priority

3. Inline style objects in loops
- Files: `BaseMap.tsx`, `RouteTimeline.tsx`
- Impact: needless allocations on render
- Fix: move to constants or `useMemo`

4. No virtualization for large point lists
- File: `frontend/components/generative/PilgrimageGrid.tsx`
- Impact: poor perf on 100+ items
- Fix: add virtualization when list size exceeds threshold

5. Inline keyframe injection in `RouteTimeline.tsx`
- Impact: CSS injected on every render
- Fix: move keyframes to `globals.css`

## Positive Findings
- Mapbox GL is lazily loaded and prewarmed correctly
- `reuseMaps` enabled
- Font loading via next/font is configured well
- SSE parser in `frontend/lib/api/runtime.ts` is efficient and safe
