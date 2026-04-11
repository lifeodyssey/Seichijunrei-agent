# Frontend Redesign: Landing Page + Mobile + Interaction Polish

**Status:** LANDED (95% — minor landing page photo polish remaining)

> **Update (2026-04-11):** All 6 tasks completed: landing page map hero, touch targets, mobile layout, sidebar history, loading states, language switcher removal. Only landing page real photos remain as polish item.

## Context

Design review on 2026-04-08 scored the site C+ (design) / A (no AI slop). Typography and color are strong. The problems: landing page doesn't convert, mobile is stacked desktop, interaction states are missing, sidebar is cluttered.

**Approved mockups:**
- Landing page: `.superpowers/brainstorm/68620-1775618015/content/variant-final-map-hero.html`
- Mobile: `.superpowers/brainstorm/68620-1775618015/content/mobile-redesign.html`
- Desktop app: `.superpowers/brainstorm/68620-1775618015/content/desktop-app-redesign.html`

**Design decisions:**
- Anchor icon: 📍 (map pin) replaces 📍 (diamond). More intuitive, matches product concept.
- Landing uses chat input (not search bar). Product is conversational.
- i18n: browser auto-detect, all text follows locale (ja/zh/en).

## Goals

1. Landing page converts visitors with map hero + chat input + i18n
2. Mobile is designed for mobile, not stacked desktop
3. All touch targets >= 44px
4. Scroll-reveal animations on landing, transitions in app
5. Sidebar shows timestamps + result counts, not duplicate titles
6. Chat-to-result connection is obvious (bigger anchor card)
7. Loading states with skeletons
8. Language switcher in header

## Non-Goals

- No dark mode
- No new backend features
- No changes to the generative UI registry pattern
- No changes to the search/route pipeline

## Approved Design Direction

### Landing Page (Map Discovery Hero)

From approved mockup `variant-final-map-hero.html`:

- **Hero:** Full-viewport map with abstract Japan shape, pulsing pin markers, photo popups on hover
- **Center content:** 聖地巡礼 heading (Shippori Mincho B1, 80px), tagline, chat input (not search bar), suggested anime
- **Stats:** 2,400+ spots / 180+ anime / 47 prefectures
- **Below fold:** Anime × Reality comparison (side-by-side photos), feature cards
- **Header:** Sticky, blur backdrop, language switcher (ja/zh/en), Join beta CTA
- **i18n:** Browser auto-detect, all text follows locale, search placeholder changes
- **Animation:** fadeUp on hero content, scroll-reveal on sections, pin pulse, focus glow on chat input

### Mobile (3 Screens)

From approved mockup `mobile-redesign.html`:

**Screen 1 — Mobile Landing:**
- Compact map hero with mini pins
- Chat input with ↑ send button (48px height)
- Horizontal scroll quick actions (ロケ地検索 / ルートプランナー / 作品別)
- Stats row below chat

**Screen 2 — Chat + Bottom Sheet:**
- Chat messages with user bubble (right, primary color) and bot message (left, white card)
- Anchor card redesign: 36px icon + "タップして結果を表示" subtitle + › arrow
- Vaul bottom sheet with drag handle, tabs (話数別 / エリア別), photo grid
- Sticky bottom input with safe-area padding

**Screen 3 — Conversation History:**
- Overlay card (not sidebar) triggered by ☰ hamburger
- Each conversation: title (truncated first query) + relative time + spot/stop count
- Active conversation highlighted
- Route planning conversations use 📍 icon vs 🗾 for search

## Task Breakdown

### Task 1: Landing Page — Map Hero Component

**Files:** `frontend/components/auth/AuthGate.tsx` (rewrite)

Replace current sparse landing with map hero layout:
- Abstract Japan SVG shape with CSS gradient
- Pin markers (CSS-only, pulsing animation)
- Photo popup on pin hover
- Chat input that triggers auth flow on submit
- Stats row
- Sticky header with language switcher
- Scroll-reveal comparison section
- Feature cards

**AC:**
- [ ] Map hero renders with pins and popups
- [ ] Chat input placeholder follows locale
- [ ] Language switcher in header works (ja/zh/en)
- [ ] Browser auto-detect sets initial locale
- [ ] Scroll animations trigger on intersection
- [ ] All touch targets >= 44px
- [ ] Mobile responsive (see Task 3)
- [ ] `npm run build` succeeds

### Task 2: Touch Targets + Interaction States

**Files:** `frontend/app/globals.css`, various components

Global CSS fixes:
- Minimum 44px on all buttons, links, inputs: `min-height: 44px; min-width: 44px;`
- Focus-visible ring on all interactive elements
- Hover states on all buttons and cards
- Chat input focus glow (border-color + box-shadow transition)
- Feature cards hover lift (translateY -2px + shadow)

**AC:**
- [ ] No interactive element < 44px in any viewport
- [ ] Focus ring visible on keyboard navigation
- [ ] Hover state on every button and card

### Task 3: Mobile Layout

**Files:** `frontend/components/layout/AppShell.tsx`, `frontend/components/layout/ResultDrawer.tsx`, `frontend/components/chat/MessageBubble.tsx`

Mobile-specific changes:
- Sidebar becomes overlay (triggered by hamburger, not permanent)
- Bottom input fixed with `env(safe-area-inset-bottom)`
- Anchor card redesigned: larger icon, subtitle hint, arrow
- Quick action horizontal scroll below chat input
- No horizontal scroll anywhere

**AC:**
- [ ] Sidebar is overlay on mobile, not stacked column
- [ ] Bottom input respects notch/home indicator
- [ ] Anchor card has "タップして結果を表示" hint
- [ ] No horizontal scroll on 375px viewport

### Task 4: Sidebar Conversation History

**Files:** `frontend/components/layout/Sidebar.tsx`, `frontend/hooks/useConversationHistory.ts`

Redesign sidebar entries:
- Title: truncated first query (not LLM-generated title)
- Subtitle: relative time ("2分前") + result count ("111 spots")
- Icon: 🗾 for search, 📍 for route planning
- Active conversation highlighted
- Remove duplicate-looking entries

**AC:**
- [ ] Each conversation shows relative time
- [ ] Result count visible per conversation
- [ ] Active conversation visually distinct
- [ ] No visually duplicate entries

### Task 5: Loading States + Animations

**Files:** `frontend/components/chat/MessageBubble.tsx`, `frontend/components/generative/PilgrimageGrid.tsx`, `frontend/app/globals.css`

Add:
- Skeleton shimmer in result panel while search is running
- Chat message entrance animation (fadeUp, 150ms)
- Result panel slide-in transition
- Bot typing indicator (three dots pulse)

**AC:**
- [ ] Skeleton visible during search in result panel
- [ ] Messages animate in, not just appear
- [ ] Result panel slides in smoothly

### Task 6: Language Switcher Position

**Files:** `frontend/components/layout/AppShell.tsx` or `frontend/components/layout/ChatHeader.tsx`

Move language switcher from sidebar bottom to:
- Landing page: header (part of Task 1)
- Authenticated app: chat header area (near the title)

**AC:**
- [ ] Language switcher visible without opening sidebar
- [ ] Switching language updates all visible text

## Iteration Phases

### Phase 1 (parallel — no file overlap):
- **Task 1** (AuthGate.tsx rewrite) — Landing page
- **Task 4** (Sidebar.tsx) — Conversation history

### Phase 2 (parallel — minimal overlap):
- **Task 2** (globals.css + components) — Touch targets
- **Task 5** (MessageBubble + PilgrimageGrid) — Loading states + animations

### Phase 3 (depends on Phase 1):
- **Task 3** (AppShell + ResultDrawer) — Mobile layout
- **Task 6** (ChatHeader) — Language switcher

## Verification Plan

After all tasks merge:
1. Run `npm run build` — static export succeeds
2. Run `/qa` — browser test all pages
3. Run `/design-review` — score should be B+ or higher
4. Mobile check: 375px viewport, no horizontal scroll, all targets >= 44px
5. i18n check: switch ja/zh/en, all text follows

## Risk Assessment

| Task | Risk | Mitigation |
|------|------|------------|
| Task 1 | AuthGate rewrite breaks auth flow | Test magic link login before/after |
| Task 3 | Mobile sidebar overlay conflicts with vaul | Test bottom sheet + sidebar interaction |
| Task 5 | Animations cause CLS | Use transform/opacity only, no layout animation |
