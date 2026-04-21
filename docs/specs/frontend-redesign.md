# Frontend Redesign Spec

Status: Confirmed
Date: 2026-04-20
Updated: 2026-04-20 (v2 — chat-first flow, tags/favorites, dual accent)

## Feature Summary

Redesign the Seichijunrei frontend from a rigid 3-column layout to an adaptive chat-first layout. Users start with a chat interface (like Claude/ChatGPT), then the UI progressively reveals richer content (photo grid, map, route timeline) as results arrive. Chat is always visible as a panel, not hidden behind a floating bar. New features: route saving with tags, spot favorites, expanded sidebar.

## Target Users

- Anime fans planning a seichi junrei trip (desktop, at home)
- Travelers already near a station deciding whether to detour (mobile, outdoors)
- Languages: ja, zh, en

## Design Context

Brand: cinematic, editorial, dependable — "pilgrimage planning studio"
Theme: light only
Logo: Torii gate + film frame corners (SVG, option A confirmed)
Brand color: 鸟居朱色 `oklch(58% 0.19 28)` — used for logo/branding only
Interactive color: 矢车菊蓝 `oklch(60% 0.148 240)` — buttons, selections, active states
Display font: Shippori Mincho B1
Body font: Noto Sans SC / Outfit + system fallbacks
Type scale: 28 → 20 → 14 → 11px (~1.4× ratio)
Reference feel: Claude/ChatGPT chat experience + 携程 trip planning
Anti-references: generic SaaS, "AI chat assistant" with glowing purple gradients

---

## Core Interaction Flow

```
State 1: CHAT MODE (no results yet)
┌──────────────────────────────────────┐
│ [Sidebar]  [    Chat Panel ~640px   ]│
│            Welcome message           │
│            Quick action chips        │
│            Chat input at bottom      │
└──────────────────────────────────────┘

    User sends message → AI responds → results arrive...
    → Directly transition to State 2 (skip split, go full content)

State 2: CONTENT MODE (results visible, chat hidden)
┌──────────────────────────────────────┐
│ [Sidebar] [      Content full      ]│
│            Photo grid / Map / Route  │
│            [💬 Chat toggle button]   │
└──────────────────────────────────────┘

    User taps 💬 → chat panel slides in from left (State 3)

State 3: SPLIT MODE (chat + content side by side)
┌──────────────────────────────────────┐
│ [Sidebar] [Chat 320px] [Content    ]│
│           Conversation   Photo grid  │
│           Input bottom   or Map      │
└──────────────────────────────────────┘

    User can close chat → back to State 2
    User can tap on new chat → back to State 1
```

**Key principle: Chat starts as hero, then steps aside for content.
User can always bring chat back with one tap.**

---

## User Journeys

### Journey 1: Welcome & First Message

**Layout**: Sidebar (expanded, 200px) + Chat panel (centered, max 640px)

**Chat panel content** (chat style, NOT search bar style):
- Top: Welcome message with torii logo (brand vermillion) + "聖地巡礼" title
- Welcome text: "I can help you find anime filming locations and plan your pilgrimage route. What anime would you like to explore?"
- Quick action suggestion chips: "響け！ユーフォニアム", "君の名は。", "附近的圣地"
- Below suggestions: Popular anime cover row (horizontal scroll, 8 covers)
- Bottom: Chat input bar with send button

**This IS a chat**. The welcome content appears as a "first message" from the assistant. When the user types, their message appears as a user bubble, and the AI responds as a bot bubble.

**Sidebar (expanded state)**:
- Top: Torii logo (vermillion) + "聖地巡礼" wordmark
- Nav items with icons + labels (44px height):
  - New Chat (pencil icon)
  - Search (magnifying glass)
  - My Routes (compass) — NEW
  - Favorites (heart) — NEW
  - History (clock)
  - Bottom: Settings (gear)
- Collapse button (chevron) to switch to icon-only mode (56px)

**Key states**:
- First visit: welcome message with tutorial hint
- Returning user: "Welcome back" + recent conversation list
- Mobile: no sidebar, chat full width

---

### Journey 2: Search Results (Browse & Select)

**Trigger**: AI responds with search results (intent: search_bangumi)

**Layout transition**: Chat panel animates from centered (640px) to narrow sidebar (320px). Content area slides in from right.

**Chat panel (narrow, 320px)**:
- Shows conversation history (user query + AI response)
- AI response shows text summary + ◈ anchor to results
- Chat input at bottom — user can keep asking follow-ups
- "Show only EP 8" → AI responds, grid updates in-place

**Content area (flex-1)**:
- Header: anime title (20px Shippori) + spot count + city + Grid|Map toggle
- Filter: episode range chips
- **Grid view (default)**: Photo cards with Anitabi screenshots
  - Hero card (2-column span) for first result
  - Standard cards: 4:3 aspect, rounded 8px, image cover
  - Bottom overlay: location name + EP badge
  - Selectable: checkmark toggle (interactive blue)
  - Hover: lift + shadow
- **Map view**: Leaflet map with numbered pins, tap for popup
- Selection bar (appears when items selected): count + origin input + "Plan Route" + "Clear"
  - NEW: "Save selection" button → add to favorites

**Key states**:
- Loading: skeleton grid in content area, chat shows "Searching..." with dots
- Empty results: "No spots found" + suggestion chips in content area
- Error: error message in chat bubble with retry button
- Follow-up query: chat stays, content area updates (no full page change)

---

### Journey 3: Route Planning

**Trigger**: User taps "Plan Route" or AI generates a route (intent: plan_route)

**Layout**: Sidebar + Chat (320px) + Content (map + timeline)

**Content area (split vertically)**:
- **Map (top ~55%)**: Leaflet with numbered pins + polyline route
  - Active stop highlighted (brand vermillion pin)
  - Tap pin → timeline scrolls to that stop
- **Route header**: title + stats (stops/time/distance) + pacing tabs (Leisurely/Normal/Packed, i18n)
- **Timeline (bottom ~45%, scrollable)**:
  - Vertical: time column + dot-line column + content column
  - Stops: name (14px Shippori) + EP + spot count + photo thumbnail
  - Walk legs: dashed line + green pill ("🚶 10min · 700m")
  - Active stop: background tint (not border-left stripe)
  - Tap stop → map centers on that pin

**Chat panel**: Shows route summary. User can say "skip station 3" or "add a stop near Byodo-in" → route updates.

**NEW — Route actions**:
- "Save route" button → saves to My Routes
- Tag input: user can add labels ("Day 1 Kyoto", "半日コース", "Rain plan")
- "Share" → generate shareable URL
- "Export" → Google Maps URL + .ics calendar download

**Key states**:
- Loading: "Planning your route..." in chat + map skeleton
- Single stop: no timeline, just map + info card
- Route saved: success toast "Route saved to My Routes"

---

### Journey 4: Nearby Discovery

**Trigger**: User taps "附近的圣地" or shares location

**Layout**: Sidebar + Chat (320px) + Content (full map + right panel)

**Content area**:
- **Map (primary)**: centered on user location (blue pulsing dot)
  - Nearby pins: colored by anime (blue=Euphonium, green=K-On!, orange=Tamako)
  - Top floating chips: anime filters with counts
- **Right panel (260px)**: scrollable spot list
  - Each: photo + name + anime + EP + distance
  - Selectable (for route planning)
  - NEW: heart button → add to favorites

**Chat panel**: "Found 8 anime spots within 1km" + can refine ("show only Euphonium" or "expand to 2km")

**Key states**:
- Location pending: chat asks "Share your location?"
- Location denied: "Enter a station name or address" input in chat
- No spots: "No anime spots within 1km. Try expanding the radius." in chat
- Loading: map skeleton + "Looking around you..." in chat

---

### Journey 5: Clarification

**Trigger**: AI needs disambiguation (intent: clarify)

**Layout**: Same as current state (chat + content if already in split mode, or chat-only if in chat mode)

**In chat panel**: AI message with inline candidate cards:
- Each card: cover image + title + spot count + city
- "Search this" button per card (interactive blue outline)
- "Search all" link below

**NOT a modal, NOT in the content area**. Clarification happens in the chat as part of the conversation flow.

**Key states**:
- 2 candidates: cards side by side in chat bubble
- 3+ candidates: scrollable row in chat bubble
- User picks one → normal search results flow (Journey 2)

---

## New Features

### My Routes (sidebar section)

**Trigger**: Click "My Routes" in sidebar

**Layout**: Sidebar + full content area (no chat)

**Content**:
- Title: "My Routes" 28px Shippori
- Route cards in a list:
  - Each: anime cover + title + stop count + date saved + tags
  - Tags displayed as colored pills
  - Click → opens route in Journey 3 view
  - Swipe/button to delete
- Empty state: "No saved routes yet. Search for an anime and plan a route to get started."

---

### Favorites (sidebar section)

**Trigger**: Click "Favorites" in sidebar

**Layout**: Sidebar + full content area (no chat)

**Content**:
- Title: "Favorites" 28px Shippori
- Tabs: "All" | by anime title (auto-grouped)
- Spot grid: same PhotoCard style as search results, but with remove (×) button
- Empty state: "No favorites yet. Tap ❤️ on any spot to save it."

---

### Tags System

- Tags are free-text labels users create
- Applied to: routes (required), optionally to individual spots
- Display: colored pills, max 3 per route card
- Predefined suggestions: "Day 1", "Day 2", "Must visit", "Rain plan", "半日", "1日"
- Storage: new backend endpoint (future) or localStorage for MVP

---

## Sidebar States

### Expanded (220px) — Default on desktop
- Logo: torii SVG (36px) in 44px rounded square (brand-soft bg) + "聖地巡礼" wordmark (16px Shippori bold)
- Nav items: icon (18px) + label (14px) + count badge, 40px height
- Active: interactive-soft bg + interactive color
- Collapse chevron at bottom

**NEW — Anime context panel (when browsing a specific anime):**
When the user is viewing search results, route, or nearby for a specific anime, the sidebar shows:
- Anime cover image (full width, 120px height, rounded)
- Title + spot count + city
- Episode progress: "visited 0 / 156 spots" with progress bar
- Quick link: "View all spots" / "Plan route"
This replaces the generic nav when in anime context; nav items move to a bottom section.

### Collapsed (60px) — Auto-collapse in route/nearby journeys
- Logo: torii SVG (32px) in 44px rounded square (brand-soft bg)
- Nav icons only (18px) in 44px touch target
- Tooltip on hover (dark bg, white text, 200ms delay)
- Expand chevron at bottom
- Auto-collapses when in focused tasks (route planning, nearby) to maximize content space

### Mobile/Tablet
- Hidden by default
- Hamburger button in chat header opens as overlay
- Same expanded layout in overlay

---

## Chat Panel States

### Chat Mode (no results)
- Width: flex-1, content max-width 640px centered
- Shows: welcome / conversation history / input
- Full conversational experience

### Popup Mode (results visible) — CONFIRMED
- Floating popup window anchored to bottom-right of content area
- Size: 320px wide × 380px tall, border-radius 12px, shadow
- Has pointer arrow pointing to the chat toggle button
- Header: "对话" title + close (×) button
- Body: scrollable conversation history
- Footer: input bar + send button
- User can interact with content behind the popup (no backdrop dimming)
- Desktop: popup as described. Mobile: expands to full-screen overlay

### Minimized (popup closed)
- Chat toggle pill: bottom-right, "💬 对话" with icon
- Click → popup opens above the button

---

## Design Tokens

```css
/* Brand (logo, torii, branding elements only) */
--color-brand: oklch(58% 0.19 28);
--color-brand-soft: oklch(94% 0.02 25);

/* Interactive (buttons, selections, active states, links, focus rings) */
--color-primary: oklch(60% 0.148 240);
--color-primary-fg: oklch(99% 0.004 220);
--color-primary-soft: oklch(93% 0.025 240);

/* Neutrals (blue-tinted, keeping 京吹夏季 base) */
--color-bg: oklch(98% 0.008 218);
--color-fg: oklch(20% 0.025 238);
--color-card: oklch(95% 0.012 215);
--color-muted: oklch(91% 0.016 218);
--color-muted-fg: oklch(45% 0.032 228);
--color-border: oklch(85% 0.022 222);

/* Semantic */
--color-success: oklch(88% 0.035 145);
--color-success-fg: oklch(28% 0.09 145);
--color-warning: oklch(90% 0.06 75);
--color-warning-fg: oklch(28% 0.09 75);
--color-error: oklch(90% 0.04 20);
--color-error-fg: oklch(28% 0.09 20);

/* Walk legs */
--color-walk-bg: oklch(92% 0.02 145);
--color-walk-fg: oklch(35% 0.06 145);

/* Typography */
--app-font-display: "Shippori Mincho B1", Georgia, serif;
--app-font-body: "Outfit", "Noto Sans SC", system-ui, sans-serif;

/* Motion */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
--duration-fast: 150ms;
--duration-base: 250ms;
--duration-slow: 400ms;
```

Type scale: 28px → 20px → 14px → 11px (~1.4× ratio)
Touch targets: minimum 44px
Spacing: 4pt base (4, 8, 12, 16, 24, 32, 48, 64px)

---

## Acceptance Criteria

### AC1: Chat-first welcome
- [ ] Chat-style welcome with AI message, quick chips, anime covers
- [ ] Chat input at bottom accepts natural language
- [ ] Sidebar expanded by default on desktop
- [ ] test: unit

### AC2: Adaptive layout transition
- [ ] Chat centered (max 640px) when no results
- [ ] Chat narrows to 320px when results arrive (animated)
- [ ] Content area slides in from right
- [ ] User can collapse content → back to chat mode
- [ ] User can expand content → full content mode with chat toggle
- [ ] test: unit

### AC3: Search results grid + map
- [ ] Photo grid with real screenshots, hero card 2-col span
- [ ] Episode filter chips, grid/map toggle
- [ ] Selectable cards with checkmarks
- [ ] Selection bar with "Plan Route" + "Save selection"
- [ ] Map view with numbered Leaflet pins
- [ ] test: unit

### AC4: Route planning map + timeline
- [ ] Map (top) with pins + polyline
- [ ] Timeline (bottom) with stops, walk legs, photos
- [ ] Pacing tabs (i18n)
- [ ] Map-timeline sync (tap pin ↔ scroll timeline)
- [ ] Export: Google Maps + .ics
- [ ] test: unit

### AC5: Nearby discovery
- [ ] Map with user location + anime pins by color
- [ ] Anime filter chips with counts
- [ ] Right panel spot list with distance + favorites heart
- [ ] test: unit

### AC6: Clarification
- [ ] Inline candidate cards in chat bubble (not modal, not content area)
- [ ] Cover image + title + spot count + city per candidate
- [ ] "Search all" option
- [ ] test: unit

### AC7: My Routes (new)
- [ ] Sidebar nav item opens route list
- [ ] Route cards: cover + title + stops + date + tags
- [ ] Click opens saved route in route planning view
- [ ] Empty state with guidance
- [ ] test: unit

### AC8: Favorites (new)
- [ ] Sidebar nav item opens favorites grid
- [ ] Heart button on spots (search results, nearby)
- [ ] Grouped by anime with tabs
- [ ] Remove from favorites
- [ ] Empty state with guidance
- [ ] test: unit

### AC9: Tags (new)
- [ ] Tag input on route save
- [ ] Predefined suggestions + free text
- [ ] Tags displayed as pills on route cards
- [ ] test: unit

### AC10: Sidebar expand/collapse
- [ ] Expanded: logo + wordmark + icon + label per nav item
- [ ] Collapsed: logo + icon only + tooltips on hover
- [ ] Toggle button at bottom
- [ ] Mobile: overlay with hamburger trigger
- [ ] test: unit

### AC11: Responsive
- [ ] Desktop (≥1024px): expanded sidebar + adaptive content
- [ ] Tablet (768-1023px): hamburger + overlay sidebar + adaptive content
- [ ] Mobile (<768px): hamburger + full-width chat + bottom sheet results
- [ ] test: unit

### AC12: Accessibility + Design system
- [ ] WCAG AA contrast on all text (muted-fg at 45%)
- [ ] Touch targets ≥ 44px
- [ ] prefers-reduced-motion disables all animations
- [ ] All icon buttons have aria-label
- [ ] Zero hardcoded bg-white, text-red-*, Tailwind grays
- [ ] All colors via CSS variables
- [ ] Brand vermillion for logo only, interactive blue for all UI controls
- [ ] test: unit

---

## Implementation Notes

### Architecture changes
- `useLayoutMode` hook: already built (chat/split/full-result), extend with sidebar state
- `AppShell`: already refactored for adaptive layout, add sidebar expand/collapse
- `ChatPanel`: already accepts layoutMode, refine centering and width transitions
- `ResultPanel`: already has collapse/expand controls, wire to layout mode
- **NEW**: `RoutesPage` component for My Routes view
- **NEW**: `FavoritesPage` component for Favorites view
- **NEW**: `useFavorites` hook (localStorage for MVP, backend later)
- **NEW**: `useRouteHistory` hook (wrap existing GET /v1/routes)
- **NEW**: Tag input component

### What stays the same
- Backend API (all endpoints unchanged)
- Generative UI registry (registry.ts)
- i18n system (ja/zh/en dictionaries)
- Auth flow (Supabase)
- SSE streaming

### What changes
- Color tokens in globals.css (add --color-brand)
- Sidebar component (add expanded state + new nav items)
- ChatPanel width behavior (320px in split, centered in chat mode)
- Logo SVG (new torii + film frame design)
- Welcome screen content (chat-style, not search-bar-style)
- NEW pages: My Routes, Favorites

---

## Open Questions

1. Tags backend: store in Supabase or localStorage for MVP?
2. Favorites backend: new table or localStorage for MVP?
3. Route sharing: generate URL with route data? (needs backend endpoint)
4. Voice input: add microphone button to chat? (future)
5. Drag-to-reorder stops in route planning? (complex, consider v2)
