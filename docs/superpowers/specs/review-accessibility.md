# Accessibility Review

Date: 2026-04-22
Scope: frontend/components/

## Summary
- Critical: 3
- Major: 6
- Minor: 5

## Critical

1. RouteConfirm drag handle too narrow
- File: `frontend/components/generative/RouteConfirm.tsx`
- Issue: 44px tall but only 20px wide
- Fix: widen touch target to >= 44px and add `aria-label="Drag handle"`

2. ResultPanelToolbar tabs below 44px
- File: `frontend/components/layout/ResultPanelToolbar.tsx`
- Issue: 28px height
- Fix: increase vertical padding to reach 44px minimum

3. ChatInput location button 32x32px
- File: `frontend/components/chat/ChatInput.tsx`
- Fix: increase to 44x44px

## Major

4. Drag-to-reorder not keyboard accessible
- File: `RouteConfirm.tsx`
- Fix: add instructions / keyboard alternative or dnd-kit a11y support

5. Feedback buttons too small
- File: `FeedbackButtons.tsx`
- Fix: make each >= 44px

6. SelectionBar input missing label
- File: `SelectionBar.tsx`
- Fix: add `aria-label`

7. Feedback comment input missing label
- File: `FeedbackButtons.tsx`

8. PilgrimageGrid section toggle missing `aria-expanded`
- File: `PilgrimageGrid.tsx`

9. Undo toast missing `aria-live`
- File: `RouteConfirm.tsx`

10. Streamed response lacks polite live region
- File: `MessageBubble.tsx`

## Positive Findings
- Reduced motion media query exists
- Focus visible rings exist globally
- Images generally have alt text
- Semantic HTML structure is good
