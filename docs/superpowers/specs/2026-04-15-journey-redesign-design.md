# Journey-Based Frontend Redesign + API Endpoints

**Status:** READY (harness format)

## Context

User journey walkthrough on 2026-04-15 revealed the current frontend is designed around components, not user journeys. Five bugs found (waitlist remnants, language switcher, English placeholders, login modal, all-caps button). Rather than patching, we are redesigning from user journeys outward.

Three design directions explored: Gallery First (A), Map Explorer (B), Companion Chat (C). User approved **Hybrid (A+B)**: gallery grid as default, map as toggle, chat as persistent panel (desktop) / full-screen with bottom sheet (mobile).

API audit (ADR 2026-04-15) identified three backend additions needed to support the redesign:
- `GET /v1/bangumi/popular` for welcome screen anime chips
- `GET /v1/bangumi/nearby` for nearby anime grouping after geolocation
- `origin_lat`/`origin_lng` on `PublicAPIRequest` for coordinate-based routing

**Approved mockups:**
- Landing page: `.superpowers/journey-redesign/01-landing.html`
- Desktop hybrid (grid+map): `.superpowers/journey-redesign/variant-D-hybrid.html`
- Desktop responsive + mobile: `.superpowers/journey-redesign/variant-F-responsive.html`
- Clarification + nearby + mobile sheets: `.superpowers/journey-redesign/variant-E-clarify-mobile.html`
- Empty states (desktop + mobile): `.superpowers/journey-redesign/variant-G-empty-states.html`

## User Journeys

| # | Journey | Trigger | Result UI | Component |
|---|---------|---------|-----------|-----------|
| A | Discovery | First visit | Landing page | `LandingPage` |
| B | Search by Anime | "ユーフォニアムの聖地" | Photo grid | `PilgrimageGrid` |
| C | Search Nearby | "宇治駅の近くの聖地" | Map + distance list | `NearbyMap` |
| D | Route Planning | "ルートを作って" | Timeline + map | `RoutePlannerWizard` |
| E | Conversation History | sidebar click | Chat restore | `ConversationDrawer` |
| F | Clarification | "ハルヒ" (ambiguous) | Option cards | `Clarification` |

## Goals

1. Layout follows Hybrid direction: icon sidebar (56px) + chat (360px) + result panel (flex)
2. Result panel supports grid/map toggle with shared selection state
3. Mobile: chat full-screen, results as bottom sheet (vaul), conversation history as left drawer
4. Empty state: welcome screen with 3 quick-action cards + popular anime chips
5. Chat input has location button for geolocation
6. Location prompt appears inline in chat (not a modal), offering "現在地を使う" or "駅名を入力"
7. Clarification shows tappable option cards with anime cover art, spot count, and "all series" option
8. Nearby search: after geolocation, show colored anime chips with spot counts before results
9. Source badges: screenshot/user photo, detected by `/user/` in image URL
10. Episode badges shown only when `ep` field is present, omitted for movies
11. Missing city handled gracefully: show area name from LLM enrichment, or "---" as fallback
12. Remove language switcher, use `navigator.language` auto-detect only
13. Remove "Join beta" / "Internal beta" / waitlist remnants
14. Landing page: hero with real Anitabi photos, search input, stats, "3 steps" section, anime gallery
15. Login modal: clean copy ("ログインリンクを送信"), no all-caps, no "Internal beta"
16. `GET /v1/bangumi/popular` endpoint returns top anime for welcome screen
17. `GET /v1/bangumi/nearby` endpoint returns anime grouped by proximity to user coordinates
18. `PublicAPIRequest` accepts `origin_lat`/`origin_lng` for coordinate-based route origins

## Non-Goals

- No dark mode
- No changes to backend pipeline (planner/executor ReAct loop)
- No changes to generative UI registry pattern (components still register in `registry.ts`)
- No route planner redesign in this spec (separate iteration)
- No Anitabi API changes (data enrichment is a backend task, tracked separately)
- No CN name LLM enrichment (deferred)
- No city reverse-geocode batch enrichment (deferred; frontend handles missing city gracefully)

## Design Decisions

### Layout: Hybrid (Gallery + Map Toggle)

**Reference mockups:**
- Desktop grid+map+chat: `.superpowers/journey-redesign/variant-F-responsive.html`
- Desktop grid standalone: `.superpowers/journey-redesign/variant-D-hybrid.html`
- Empty state: `.superpowers/journey-redesign/variant-G-empty-states.html`
- Mobile clarify+nearby+sheet: `.superpowers/journey-redesign/variant-E-clarify-mobile.html`

Desktop (>=1024px):
```
┌──────┬──────────────┬──────────────────────────┐
│ Icon │ Chat Panel   │ Result Panel             │
│ Side │ 360px        │ flex-1                   │
│ bar  │              │                          │
│ 56px │ Messages     │ [グリッド | マップ]       │
│      │ + Anchor     │                          │
│      │ cards        │ Photo grid / Leaflet map │
│      │              │ + side list              │
│      │──────────────│                          │
│      │ Input [📍][↑]│ [Selection bar]          │
└──────┴──────────────┴──────────────────────────┘
```

Mobile (<1024px):
```
┌────────────────────┐
│ ☰  聖地巡礼     + │  <- header
│                    │
│ Chat messages      │  <- full screen
│ + anchor cards     │
│ (tap anchor ->     │
│  sheet slides up)  │
│                    │
│ [📍] Input    [↑] │  <- safe-area padding
└────────────────────┘

Sheet (slides up from bottom):
┌────────────────────┐
│    -- handle --    │
│ Title    156 spots │
│ [すべて][EP1-4]... │
│ [グリッド | マップ] │
│ ┌──────┬──────┐   │
│ │ card │ card │   │
│ │      │      │   │
│ ├──────┼──────┤   │
│ │ card │ card │   │
│ └──────┴──────┘   │
│ [2 選択中] [ルート]│
└────────────────────┘
```

### Chat: Persistent panel (desktop) / full-screen (mobile)

Chat is not a popover or FAB on desktop. It is a fixed 360px panel, always visible. This is the right call because:
- The product is conversational. Users refine queries ("宇治エリアだけ見せて").
- Anchor cards in chat connect to results. Hiding chat breaks this connection.
- On mobile, screen is too small for split view, so chat is full-screen and results are a sheet.

### Empty state: Quick actions + anime chips

When no results exist, the chat panel shows:
- 聖地巡礼 logo (Shippori Mincho B1, 40px)
- Tagline: "アニメの舞台を探して、巡礼ルートを作ろう"
- 3 quick-action cards: 作品で探す / 近くの聖地 / ルートを作成
- 人気の作品 row: anime cover chips (fetched from `GET /v1/bangumi/popular`)

Desktop result panel shows: soft radial gradient, pulsing decorative pins, "聖地を探してみよう" hint.

### Location acquisition: Three layers

1. **Chat-inferred**: LLM extracts location from message ("宇治駅から" -> geocode "宇治駅")
2. **Location button**: In input bar, triggers browser geolocation API
3. **Smart prompt**: When route requested without origin, bot asks inline: "現在地を使う | 駅名を入力"

### Clarification: Tappable option cards

When ambiguous (e.g., "ハルヒ"), bot shows:
- Card per match: anime cover thumbnail + title + spot count + city
- "全作品まとめて検索" card at bottom
- Cards are full-width, tappable, with hover state

### Nearby search: Anime chips

After geolocation, bot shows colored chips per anime found nearby:
- `響け！ユーフォニアム (89)` / `たまこまーけっと (12)` / `氷菓 (3)`
- Each chip has a colored dot for map pin differentiation
- Tap a chip -> results for that anime

### Data handling

| Field | Present | Missing | UI behavior |
|-------|---------|---------|-------------|
| `ep` | Show "EP {n}" badge | Omit badge entirely | Movies have no episodes |
| `name` | Show as-is | Use `cn` name | Always show something |
| `cn` | Show for zh locale | Fallback to `name` | 80% of points lack cn |
| `city` | Show in card meta | Show "---" or LLM-enriched area | Backend enrichment needed |
| `image` URL | Check for `/user/` | --- | User photo or screenshot badge |
| `screenshot_url` | Show image | Show placeholder bg | Rare, most have images |

### API additions

**D1: `GET /v1/bangumi/popular`** -- Reuses existing `BangumiRepository.list_bangumi(limit=N)`. Only needs HTTP wiring + response schema.

**D2: `GET /v1/bangumi/nearby`** -- Extends existing `BangumiRepository.get_bangumi_by_area(lat, lng, radius_m)`. Needs to add `cover_url`, `title_cn`, `points_count` to the query + HTTP wiring + response schema.

**D3: `origin_lat`/`origin_lng` on request** -- Two optional float fields on `PublicAPIRequest`. When present, skip text-based location resolution in `plan_route` handler, use coordinates directly. Saves 1 LLM call.

### Design tokens (unchanged)

```css
--bg:         oklch(98% 0.008 218)
--fg:         oklch(20% 0.025 238)
--card:       oklch(95% 0.012 215)
--muted:      oklch(91% 0.016 218)
--muted-fg:   oklch(54% 0.032 228)
--border:     oklch(85% 0.022 222)
--primary:    oklch(60% 0.148 240)
--primary-fg: #fff
--font-display: "Shippori Mincho B1", Georgia, serif
--font-body:    "Outfit", system-ui, sans-serif
```

## Architecture

### Component changes

| Component | Action | Description |
|-----------|--------|-------------|
| `AuthGate.tsx` | Rewrite | Landing page: hero + quick actions + anime chips. Remove language switcher, "Join beta", "Internal beta" |
| `AppShell.tsx` | Rewrite | Three-column hybrid layout. Icon sidebar + chat + result panel. Responsive breakpoint at 1024px |
| `Sidebar.tsx` | Rewrite -> `IconSidebar.tsx` | 56px icon rail: logo, search, routes, history, settings |
| `ChatPanel.tsx` | New | 360px chat panel with welcome state, messages, anchor cards, input with location button |
| `ResultPanel.tsx` | Rewrite | Grid/map toggle, shared selection state, filter chips, selection bar |
| `ResultSheet.tsx` | New | Mobile bottom sheet (vaul) wrapping ResultPanel content |
| `ConversationDrawer.tsx` | New | Mobile left drawer for conversation history |
| `WelcomeScreen.tsx` | New | Empty state: quick-action cards + anime chips |
| `LocationPrompt.tsx` | New | Inline chat component: "現在地を使う" / "駅名を入力" |
| `SourceBadge.tsx` | New | Screenshot/user photo badge based on image URL pattern |
| `Clarification.tsx` | Update | Tappable option cards with cover art instead of plain buttons |
| `PilgrimageGrid.tsx` | Update | Add source badges, handle missing ep/city gracefully |
| `NearbyMap.tsx` | Update | Integrate into result panel map view |
| `ChatInput.tsx` | Update | Add location button for geolocation |

### Data model changes (frontend)

```typescript
// Add to PilgrimagePoint or derive at render time
interface PointDisplayMeta {
  imageSource: "screenshot" | "user_photo";  // derived from URL pattern
  hasEpisode: boolean;
  cityDisplay: string;  // city || LLM-enriched area || "---"
}
```

### i18n changes

- Remove `landing_hero.join_beta` from all dictionaries
- Remove `auth.subtitle` ("Internal beta") from all dictionaries
- Remove `auth.tab_waitlist` from all dictionaries
- Remove language switcher code from `AuthGate.tsx`
- Keep `LOCALES` and `useLocale()` -- they still work via browser auto-detect

### Backend changes

- `backend/interfaces/schemas.py` -- add `origin_lat`, `origin_lng` optional float fields to `PublicAPIRequest`
- `backend/interfaces/fastapi_service.py` -- add `GET /v1/bangumi/popular` and `GET /v1/bangumi/nearby` routes
- `backend/infrastructure/supabase/repositories/bangumi.py` -- extend `get_bangumi_by_area` query to include `cover_url`, `title_cn`, `points_count`; add `list_popular` method
- `backend/interfaces/public_api.py` -- propagate `origin_lat`/`origin_lng` to pipeline context
- `backend/agents/handlers/plan_route.py` -- accept coordinate origin, skip text resolution when coords present

---

## File-Overlap Analysis

Cards sharing the same file CANNOT be in the same wave.

| File | Cards touching it | Conflict? |
|------|-------------------|-----------|
| `frontend/components/layout/AppShell.tsx` | Card 1 only | No |
| `frontend/components/layout/Sidebar.tsx` | Card 1 (delete) | No |
| `frontend/components/chat/ChatInput.tsx` | Card 6 only | No (Card 2 does NOT touch ChatInput) |
| `frontend/components/layout/ResultPanel.tsx` | Card 3 only | No |
| `frontend/components/generative/Clarification.tsx` | Card 7 only | No |
| `frontend/components/generative/PilgrimageGrid.tsx` | Card 5 only | No |
| `frontend/components/generative/NearbyMap.tsx` | Card 8 only | No |
| `frontend/components/generative/registry.ts` | Card 7, Card 8 | Yes -- same wave OK if registry changes are additive |
| `frontend/components/auth/AuthGate.tsx` | Card 9, Card 10, Card 11 | Yes -- must be same wave or sequential |
| `frontend/lib/dictionaries/ja.json` | Card 2, Card 9, Card 11 | Yes -- Wave 1 vs Wave 3 |
| `frontend/lib/dictionaries/zh.json` | Card 2, Card 11 | Yes -- Wave 1 vs Wave 3 |
| `frontend/lib/dictionaries/en.json` | Card 2, Card 11 | Yes -- Wave 1 vs Wave 3 |
| `frontend/lib/api.ts` | Card 2, Card 6 | Yes -- Wave 1 vs Wave 2 |
| `backend/interfaces/schemas.py` | Card 13 only | No |
| `backend/interfaces/fastapi_service.py` | Card 12, Card 13 | Yes -- same wave OK if additive |
| `backend/infrastructure/supabase/repositories/bangumi.py` | Card 12, Card 13 | Yes -- same wave, additive (different methods) |
| `backend/agents/handlers/plan_route.py` | Card 13 only | No |

---

## Task Breakdown

### Wave 1: Layout + Empty State (no backend changes, no auth changes)

#### Card 1: AppShell + IconSidebar rewrite
- **Scope:** Replace existing three-column layout with new hybrid design. Create 56px icon sidebar replacing the 240px text sidebar. Responsive breakpoint at 1024px hides sidebar on mobile.
- **Files changed:**
  - `frontend/components/layout/AppShell.tsx` (modify -- rewrite)
  - `frontend/components/layout/IconSidebar.tsx` (create)
  - `frontend/components/layout/Sidebar.tsx` (delete)
- **AC:**
  - [ ] Happy path: Desktop viewport shows three columns (56px icon sidebar + 360px chat + flex result panel) -> browser
  - [ ] Happy path: Mobile viewport (<1024px) hides icon sidebar, shows chat full-screen -> browser
  - [ ] Happy path: Icon sidebar renders logo, search, routes, history, settings icons -> unit
  - [ ] Null/empty: No session or conversations loaded -- sidebar icons still render without active state -> unit
  - [ ] Error path: Window resize from desktop to mobile collapses layout without JS error -> browser
  - [ ] Responsive: Breakpoint at 1024px transitions between layouts without layout shift -> browser
- **Dependencies:** None
- **Review mode:** full

#### Card 2: ChatPanel + WelcomeScreen + popular anime fetch
- **Scope:** Extract chat into a dedicated 360px panel component. Create empty-state WelcomeScreen with quick-action cards and anime chips fetched from `/v1/bangumi/popular`. Add i18n keys for welcome screen text.
- **Files changed:**
  - `frontend/components/chat/ChatPanel.tsx` (create)
  - `frontend/components/chat/WelcomeScreen.tsx` (create)
  - `frontend/lib/api.ts` (modify -- add `fetchPopularBangumi()`)
  - `frontend/lib/dictionaries/ja.json` (modify -- add welcome keys)
  - `frontend/lib/dictionaries/zh.json` (modify -- add welcome keys)
  - `frontend/lib/dictionaries/en.json` (modify -- add welcome keys)
- **AC:**
  - [ ] Happy path: Empty state shows WelcomeScreen with logo, tagline, 3 quick-action cards, and popular anime chips -> browser
  - [ ] Happy path: After first message sent, WelcomeScreen is replaced by message list -> unit
  - [ ] Happy path: Quick-action card tap sends the corresponding query to chat -> unit
  - [ ] Null/empty: `/v1/bangumi/popular` returns empty array -- anime chips section hidden, quick actions still visible -> unit
  - [ ] Error path: `/v1/bangumi/popular` network failure -- WelcomeScreen renders without anime chips, no crash -> unit
  - [ ] i18n: Welcome tagline and quick-action labels render correctly in ja, zh, en -> unit
- **Dependencies:** Card 12 (popular endpoint). Mock fetch during dev if Card 12 not yet merged; wire real endpoint after Wave 4 lands
- **Review mode:** full

#### Card 3: ResultPanel grid/map toggle + selection bar
- **Scope:** Rewrite ResultPanel to support grid/map view toggle with shared selection state. Add filter chips for episode ranges. Selection bar slides up when points are selected.
- **Files changed:**
  - `frontend/components/layout/ResultPanel.tsx` (modify -- rewrite)
  - `frontend/components/generative/SelectionBar.tsx` (modify -- move into ResultPanel)
- **AC:**
  - [ ] Happy path: Grid/map toggle switches view, selection state persists across switches -> browser
  - [ ] Happy path: Filter chips appear for episode ranges when results have episode data -> unit
  - [ ] Happy path: Selection bar slides up when 1+ points selected, shows count and route button -> browser
  - [ ] Null/empty: No active response -- result panel shows empty state with gradient background and hint text -> unit
  - [ ] Null/empty: Zero results returned -- result panel shows "no results" message -> unit
  - [ ] Error path: Map tile load failure -- grid view remains functional, map shows error state -> browser
  - [ ] Responsive: Grid columns adjust from 3 on wide screens to 2 on narrower result panels -> browser
  - [ ] Happy path: Leaflet map is lazy-loaded via `dynamic(() => import(...), { ssr: false })` -- not included in initial JS bundle -> unit
- **Dependencies:** None
- **Review mode:** full

#### Card 4: Mobile bottom sheet + conversation drawer
- **Scope:** Create ResultSheet (vaul bottom sheet with drag handle) for mobile result viewing. Create ConversationDrawer (left drawer triggered by hamburger) for mobile conversation history.
- **Files changed:**
  - `frontend/components/layout/ResultSheet.tsx` (create)
  - `frontend/components/layout/ConversationDrawer.tsx` (create)
  - `frontend/components/layout/ResultDrawer.tsx` (delete -- replaced by ResultSheet)
- **AC:**
  - [ ] Happy path: Anchor card tap in mobile chat opens bottom sheet with results -> browser
  - [ ] Happy path: Hamburger icon tap opens left drawer with conversation history list -> browser
  - [ ] Happy path: Sheet drag handle allows resize between peek (40%) and full (90%) heights -> browser
  - [ ] Null/empty: No conversations in history -- drawer shows empty state message -> unit
  - [ ] Null/empty: No active result -- sheet is not rendered (no trigger) -> unit
  - [ ] Error path: Sheet dismissed by swipe down, chat returns to foreground without layout break -> browser
  - [ ] Responsive: Sheet and drawer only render on mobile (<1024px) viewport -> browser
- **Dependencies:** Card 1 (AppShell provides mobile layout skeleton)
- **Review mode:** full

---

### Wave 2: Data Handling + Interactions (depends on Wave 1 layout)

#### Card 5: Source badges + missing data handling
- **Scope:** Create SourceBadge component for screenshot/user-photo distinction. Update PilgrimageGrid to handle missing `ep` (omit badge), missing `city` (show "---"), and show source badge.
- **Files changed:**
  - `frontend/components/generative/SourceBadge.tsx` (create)
  - `frontend/components/generative/PilgrimageGrid.tsx` (modify -- add badge, handle missing fields)
- **AC:**
  - [ ] Happy path: Image URL containing `/user/` renders user-photo badge; other URLs render screenshot badge -> unit
  - [ ] Happy path: Points with episode > 0 show "EP {n}" badge -> unit
  - [ ] Null/empty: Points with episode = 0 or null omit episode badge entirely -> unit
  - [ ] Null/empty: Points with null/empty city display "---" -> unit
  - [ ] Null/empty: Points with null screenshot_url render placeholder background -> unit
  - [ ] Error path: Malformed image URL does not crash badge component -> unit
  - [ ] i18n: Episode badge label follows locale (EP vs number format) -> unit
- **Dependencies:** None within wave
- **Review mode:** light

#### Card 6: LocationPrompt + geolocation wiring
- **Scope:** Create LocationPrompt inline chat component for location acquisition. Wire the location button in ChatInput to browser geolocation API. Send coordinates with next message via `origin_lat`/`origin_lng`.
- **Files changed:**
  - `frontend/components/chat/LocationPrompt.tsx` (create)
  - `frontend/components/chat/ChatInput.tsx` (modify -- add location button, geolocation handler)
  - `frontend/lib/api.ts` (modify -- pass `origin_lat`/`origin_lng` in request)
- **AC:**
  - [ ] Happy path: Location button tap triggers browser geolocation prompt; on success, coordinates stored in state -> browser
  - [ ] Happy path: LocationPrompt shows "現在地を使う" and "駅名を入力" options inline in chat -> unit
  - [ ] Happy path: After geolocation acquired, next route request includes `origin_lat`/`origin_lng` in API payload -> unit
  - [ ] Null/empty: Geolocation denied by user -- LocationPrompt shows text input fallback -> unit
  - [ ] Error path: Geolocation API timeout -- shows error message, allows manual input -> unit
  - [ ] Error path: Browser does not support geolocation -- location button hidden -> unit
  - [ ] i18n: Location prompt text rendered in current locale -> unit
- **Dependencies:** Card 13 (origin_lat/origin_lng schema) must land first
- **Review mode:** full

#### Card 7: Clarification redesign
- **Scope:** Update Clarification component from plain text buttons to tappable cards with anime cover art thumbnails, spot count, city, and "all series" option.
- **Files changed:**
  - `frontend/components/generative/Clarification.tsx` (modify -- redesign to card layout)
  - `frontend/components/generative/registry.ts` (modify -- pass additional data to Clarification renderer)
- **AC:**
  - [ ] Happy path: Ambiguous query shows card per candidate with cover thumbnail, title, spot count, city -> browser
  - [ ] Happy path: "全作品まとめて検索" option card appears at bottom of options list -> unit
  - [ ] Happy path: Tapping a card sends the selected anime title as a chat message -> unit
  - [ ] Null/empty: No cover_url for a candidate -- shows placeholder thumbnail -> unit
  - [ ] Null/empty: Zero options array -- falls back to existing suggestion buttons -> unit
  - [ ] Error path: Cover image CDN failure -- placeholder renders, card still tappable -> unit
  - [ ] i18n: "全作品まとめて検索" text follows locale -> unit
- **Dependencies:** None within wave
- **Review mode:** full

#### Card 8: Nearby anime chips
- **Scope:** After nearby search returns results from multiple anime, show colored chips grouped by anime. Tap a chip to filter results to that anime.
- **Files changed:**
  - `frontend/components/generative/NearbyChips.tsx` (create)
  - `frontend/components/generative/NearbyMap.tsx` (modify -- integrate NearbyChips above map)
  - `frontend/components/generative/registry.ts` (modify -- pass grouped data to NearbyMap)
- **AC:**
  - [ ] Happy path: Nearby results with 3 anime show 3 colored chips with correct spot counts -> unit
  - [ ] Happy path: Tapping a chip filters the map and list to that anime only -> browser
  - [ ] Happy path: Each chip has a distinct colored dot matching map pin color -> unit
  - [ ] Null/empty: Only 1 anime in nearby results -- no chips rendered, results shown directly -> unit
  - [ ] Null/empty: Zero nearby results -- shows NearbyMap empty state -> unit
  - [ ] Error path: Chip with 0 points_count is excluded from chip list -> unit
- **Dependencies:** None within wave
- **Review mode:** light

---

### Wave 3: Landing + Auth + i18n Cleanup (depends on Wave 1 for layout patterns)

#### Card 9: Landing page rewrite
- **Scope:** Rewrite the landing section of AuthGate with hero using real Anitabi photos (floating cards), search input, stats counter, 3-step explanation section, and anime gallery. Remove "Join beta" and language switcher.
- **Files changed:**
  - `frontend/components/auth/AuthGate.tsx` (modify -- rewrite landing section)
  - `frontend/lib/dictionaries/ja.json` (modify -- remove `landing_hero.join_beta`, add new landing keys)
  - `frontend/lib/dictionaries/zh.json` (modify -- remove `landing_hero.join_beta`, add new landing keys)
  - `frontend/lib/dictionaries/en.json` (modify -- remove `landing_hero.join_beta`, add new landing keys)
- **AC:**
  - [ ] Happy path: Landing page shows hero with floating photo cards, search input, stats, 3-step section -> browser
  - [ ] Happy path: Search input on landing submits query and transitions to authenticated app -> browser
  - [ ] Happy path: Stats section shows spot count, anime count, prefecture count -> browser
  - [ ] Null/empty: No session / first visit -- landing page renders with all sections visible -> browser
  - [ ] Error path: Anitabi image CDN unreachable -- hero shows gradient fallback, no broken images -> browser
  - [ ] i18n: Landing page hero text, stats labels, 3-step labels render in all 3 locales -> unit
- **Dependencies:** Card 11 (i18n cleanup) should land in same wave or after
- **Review mode:** full

#### Card 10: Login modal cleanup
- **Scope:** Clean up the login modal: "ログイン" title, clear subtitle ("メールアドレスを入力すると、ログインリンクをお送りします"), button text "ログインリンクを送信" (not all-caps), remove "Internal beta" text.
- **Files changed:**
  - `frontend/components/auth/AuthGate.tsx` (modify -- login modal section only)
  - `frontend/lib/dictionaries/ja.json` (modify -- update `auth.subtitle`, `auth.btn_login`)
  - `frontend/lib/dictionaries/zh.json` (modify -- update `auth.subtitle`, `auth.btn_login`)
  - `frontend/lib/dictionaries/en.json` (modify -- update `auth.subtitle`, `auth.btn_login`)
- **AC:**
  - [ ] Happy path: Login modal shows "ログイン" title, descriptive subtitle, "ログインリンクを送信" button -> browser
  - [ ] Happy path: Button text is sentence-case, not ALL-CAPS -> browser
  - [ ] Happy path: No "Internal beta" text anywhere in modal -> browser
  - [ ] Null/empty: Auth not configured -- modal shows configuration error message -> unit
  - [ ] Error path: Magic link send failure -- error message displayed in modal -> unit
  - [ ] i18n: Modal title, subtitle, button text render correctly in ja, zh, en -> unit
- **Dependencies:** Card 9 (landing rewrite) -- both touch AuthGate.tsx, must be same wave or sequential. Recommendation: Card 9 first, Card 10 second within Wave 3.
- **Review mode:** light

#### Card 11: i18n auto-detect + dictionary cleanup
- **Scope:** Remove language switcher UI code from AuthGate. Remove dead dictionary keys (`join_beta`, `tab_waitlist`, `auth.subtitle` with "Internal beta" text). Verify `navigator.language` auto-detect works for ja/zh/en.
- **Files changed:**
  - `frontend/components/auth/AuthGate.tsx` (modify -- remove language switcher JSX and state)
  - `frontend/lib/dictionaries/ja.json` (modify -- remove dead keys)
  - `frontend/lib/dictionaries/zh.json` (modify -- remove dead keys)
  - `frontend/lib/dictionaries/en.json` (modify -- remove dead keys)
  - `frontend/lib/i18n.ts` (no change -- `detectLocale()` already uses `navigator.languages`)
- **AC:**
  - [ ] Happy path: No language switcher dropdown rendered anywhere in the app -> browser
  - [ ] Happy path: `navigator.language = "ja"` -> locale resolves to "ja" -> unit
  - [ ] Happy path: `navigator.language = "zh-CN"` -> locale resolves to "zh" -> unit
  - [ ] Null/empty: `navigator.languages` is empty array -> defaults to "ja" -> unit
  - [ ] Null/empty: Dictionary files have no `join_beta`, `tab_waitlist`, or old `auth.subtitle` keys -> unit
  - [ ] Error path: Unknown locale prefix "fr" -> falls back to "ja" default -> unit
  - [ ] i18n: English locale auto-detected when `navigator.language = "en-US"` -> unit
- **Dependencies:** Card 9 and Card 10 (both touch AuthGate and dictionaries)
- **Review mode:** light

---

### Wave 4: Backend API endpoints (independent of frontend waves)

#### Card 12: GET /v1/bangumi/popular endpoint
- **Scope:** Add HTTP endpoint returning popular bangumi for the welcome screen. Reuses existing `BangumiRepository.list_bangumi()`. Adds a slim `list_popular()` method that selects only the fields the frontend needs and adds a `WHERE points_count > 0` filter.
- **Files changed:**
  - `backend/infrastructure/supabase/repositories/bangumi.py` (modify -- add `list_popular(limit)` method)
  - `backend/interfaces/fastapi_service.py` (modify -- add `GET /v1/bangumi/popular` route handler)
  - `backend/tests/unit/repositories/test_bangumi_repo.py` (modify -- add tests for `list_popular`)
  - `backend/tests/unit/test_fastapi_service_helpers.py` (modify -- add test for popular route)
- **AC:**
  - [ ] Happy path: `GET /v1/bangumi/popular?limit=8` returns JSON array of bangumi with id, title, title_cn, cover_url, city, points_count, rating -> api
  - [ ] Happy path: Results ordered by rating DESC, limited to `limit` param -> unit
  - [ ] Happy path: Only bangumi with `points_count > 0` included -> unit
  - [ ] Null/empty: No bangumi in DB -- returns empty array `{ "bangumi": [] }` -> unit
  - [ ] Null/empty: `limit` param omitted -- defaults to 8 -> unit
  - [ ] Error path: `limit` param is negative or non-integer -- returns 422 validation error -> api
  - [ ] Error path: Database connection failure -- returns 500 with structured error -> api
  - [ ] Happy path: Endpoint requires auth (Worker enforces on `/v1/*`) -- unauthenticated request returns 401 -> api
- **Dependencies:** None
- **Review mode:** full

#### Card 13: GET /v1/bangumi/nearby + origin_lat/origin_lng schema change
- **Scope:** Add HTTP endpoint returning anime grouped by proximity. Extend existing `get_bangumi_by_area()` to include `cover_url`, `title_cn`, `points_count`. Add `origin_lat`/`origin_lng` optional fields to `PublicAPIRequest`. Update `plan_route` handler to use coordinate origin when available.
- **Files changed:**
  - `backend/interfaces/schemas.py` (modify -- add `origin_lat: float | None`, `origin_lng: float | None` fields + validator)
  - `backend/infrastructure/supabase/repositories/bangumi.py` (modify -- extend `get_bangumi_by_area` query to include `cover_url`, `title_cn`, `COUNT(p.id) AS points_count`)
  - `backend/interfaces/fastapi_service.py` (modify -- add `GET /v1/bangumi/nearby` route handler)
  - `backend/interfaces/public_api.py` (modify -- propagate `origin_lat`/`origin_lng` to pipeline context)
  - `backend/agents/handlers/plan_route.py` (modify -- accept coordinate tuple, skip text resolution)
  - `backend/tests/unit/test_public_api.py` (modify -- add tests for origin_lat/origin_lng)
  - `backend/tests/unit/repositories/test_bangumi_repo.py` (modify -- add tests for extended get_bangumi_by_area)
  - `backend/tests/unit/test_handlers.py` (modify -- add test for coordinate-based plan_route)
- **AC:**
  - [ ] Happy path: `GET /v1/bangumi/nearby?lat=34.9&lng=135.8&radius_m=50000` returns grouped bangumi with points_count -> api
  - [ ] Happy path: `PublicAPIRequest` with `origin_lat=34.9, origin_lng=135.8` passes validation -> unit
  - [ ] Happy path: `plan_route` with `origin_lat`/`origin_lng` in context skips `resolve_location()`, uses coords directly -> unit
  - [ ] Happy path: Both text `origin` and coordinate origin provided -- coordinates take precedence -> unit
  - [ ] Null/empty: No points within radius -- returns empty array `{ "bangumi": [] }` -> unit
  - [ ] Null/empty: `origin_lat` provided without `origin_lng` -- validator rejects with 422 -> unit
  - [ ] Error path: `lat` outside valid range (-90 to 90) -- returns 422 validation error -> api
  - [ ] Error path: `lng` outside valid range (-180 to 180) -- returns 422 validation error -> api
  - [ ] Error path: `radius_m` is 0 or negative -- returns 422 validation error -> api
  - [ ] Error path: Database connection failure on nearby query -- returns 500 with structured error -> api
  - [ ] Happy path: Endpoint requires auth (Worker enforces on `/v1/*`) -- unauthenticated request returns 401 -> api
  - [ ] Happy path: PostGIS GIST index on `points.location` is used (no seq scan) for ST_DWithin query -> unit
- **Dependencies:** None
- **Review mode:** full

---

## Wave Assignment Summary

| Wave | Cards | Parallelism | Rationale |
|------|-------|-------------|-----------|
| **Wave 1** | 1, 2, 3, 4 | All 4 parallel | No file overlap. Layout skeleton, chat panel, result panel, mobile shell. |
| **Wave 2** | 5, 6, 7, 8 | All 4 parallel | No file overlap within wave. Depends on Wave 1 layout. Card 6 depends on Card 13 (schema). |
| **Wave 3** | 9, 10, 11 | Sequential (9 -> 10 -> 11) | All touch AuthGate.tsx and dictionary files. Must be ordered. |
| **Wave 4** | 12, 13 | Both parallel | No file overlap. Backend only. Can execute in parallel with Wave 1. |

**Cross-wave dependency note:** Wave 4 (backend) can start in parallel with Wave 1 (frontend layout). Wave 2 Card 6 (LocationPrompt) depends on Wave 4 Card 13 (origin_lat/origin_lng schema). Wave 2 Card 2 (WelcomeScreen) depends on Wave 4 Card 12 (popular endpoint) for the fetch call, but can mock it during development.

Recommended execution order:
```
Wave 4 (backend, start first)
  +
Wave 1 (frontend layout, parallel with Wave 4)
    |
    ├─ Wave 2 (after Wave 1 + Wave 4 both land)
    |
    └─ Wave 3 (after Wave 1 lands, sequential cards 9→10→11)
```

**Note:** Card 2 (WelcomeScreen) calls `fetchPopularBangumi()` which depends on Card 12's endpoint. During dev, Card 2 should mock this fetch. After Wave 4 merges, wire the real endpoint. Card 6 (LocationPrompt) sends `origin_lat`/`origin_lng` which depends on Card 13's schema change. Wave 4 must land before Wave 2 starts.

---

## Verification Plan

1. **Per-card:** Each PR must pass `make check` (lint + typecheck + test). Frontend PRs must pass `npm run build` (static export). Backend PRs must pass `make test`.
2. **Wave gate:** After each wave merges, Tester agent runs browser QA on deployed preview:
   - Wave 1: Verify three-column layout, mobile breakpoint, empty state
   - Wave 2: Verify source badges, geolocation flow, clarification cards, nearby chips
   - Wave 3: Verify landing page, login modal, no language switcher
   - Wave 4: Verify API endpoints via `curl` or API tests
3. **Integration:** After all waves, full QA pass covering all 6 user journeys (A-F)
4. **Regression:** Existing frontend Vitest tests (`frontend/tests/`) must continue passing
5. **Coverage:** Reviewer verifies Codecov patch coverage >= 95% on each PR

## Dependencies

- Wave 1 cards are independent of each other (parallel execution)
- Wave 2 depends on Wave 1 layout being in place
- Wave 2 Card 6 depends on Wave 4 Card 13 (schema change)
- Wave 3 depends on Wave 1 (landing page uses new layout patterns)
- Wave 4 is independent of all frontend waves
- Backend data enrichment (LLM reverse-geocode for missing city) is out of scope, tracked separately

## Risk Assessment

1. **Anitabi image CDN**: Designs rely on `image.anitabi.cn` images loading. If CDN is slow or blocks, need placeholder strategy. Mitigated by SourceBadge placeholder in Card 5.
2. **Leaflet bundle size**: Adding Leaflet to the result panel increases JS bundle. Mitigated by existing `dynamic(() => import(...), { ssr: false })` pattern in NearbyMap.
3. **Vaul dependency**: Bottom sheet uses vaul (already in project). If vaul API changes, sheet behavior may break. Low risk -- pinned dependency.
4. **Selection state across views**: Grid and map must share selection context. Mitigated by existing `PointSelectionContext` used in both PilgrimageGrid and NearbyMap.
5. **Wave 3 AuthGate sequencing**: Three cards (9, 10, 11) all modify AuthGate.tsx and dictionary files. Must be sequential within Wave 3 to avoid merge conflicts.
6. **PostGIS availability**: `GET /v1/bangumi/nearby` requires PostGIS `ST_DWithin`. Already used by `search_nearby` handler -- confirmed available.
7. **Browser geolocation permission**: Card 6 depends on user granting geolocation. Must handle denial gracefully (AC covers this).
8. **Popular bangumi query assumes `rating` column populated**: Existing `list_bangumi` uses `ORDER BY rating DESC NULLS LAST`, which handles nulls. Low risk.
