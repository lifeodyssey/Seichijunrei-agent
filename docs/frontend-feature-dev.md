# Frontend Feature Dev Plan

## Scope

Chat-first generative UI frontend for the Seichijunrei runtime.
Backend: `POST /v1/runtime` → `{ intent, data, session_id, message }`
Frontend: renders a different React component for each intent value (A2UI pattern).

All source lives under `frontend/` — nothing under this root changes.

---

## File Naming Convention

```
frontend/
├── app/                        # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       └── chat/
│           └── route.ts        # optional: CORS proxy for backend
├── components/
│   ├── layout/                 # shell, sidebar, header
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   └── ChatHeader.tsx
│   ├── chat/                   # message loop primitives
│   │   ├── ChatInput.tsx
│   │   ├── MessageList.tsx
│   │   └── MessageBubble.tsx
│   ├── generative/             # one component per intent
│   │   ├── IntentRenderer.tsx  # dispatch switch
│   │   ├── PilgrimageGrid.tsx  # search_by_bangumi
│   │   ├── NearbyMap.tsx       # search_by_location
│   │   ├── RouteVisualization.tsx  # plan_route
│   │   ├── GeneralAnswer.tsx   # general_qa
│   │   └── Clarification.tsx   # unclear
│   └── map/
│       └── PilgrimageMap.tsx   # shared Leaflet wrapper
├── hooks/
│   ├── useChat.ts              # message state + send()
│   └── useSession.ts           # localStorage session_id
├── lib/
│   ├── api.ts                  # fetch wrapper → POST /v1/runtime
│   └── types.ts                # TypeScript types mirroring backend contract
└── public/
    └── map-marker.svg          # custom Leaflet marker icon
```

**Rules:**
- Component file names: `PascalCase.tsx`
- Hook file names: `camelCase.ts` prefixed with `use`
- Utility file names: `camelCase.ts`
- No barrel `index.ts` files — import from full path

---

## Features

### FEAT-01 · Project Bootstrap

**Goal:** Scaffold the Next.js project with all dependencies.

**Creates:**
```
frontend/package.json
frontend/tsconfig.json
frontend/next.config.ts
frontend/tailwind.config.ts
frontend/postcss.config.mjs
frontend/.env.local.example
```

**Tasks:**
- [ ] `npx create-next-app@latest frontend --typescript --tailwind --app --no-src-dir`
- [ ] Install deps: `react-leaflet leaflet @types/leaflet`
- [ ] Add `.env.local.example` with `NEXT_PUBLIC_RUNTIME_URL=http://localhost:8080`
- [ ] Verify `npm run dev` starts with empty page

**Acceptance:** `npm run dev` serves `localhost:3000` with no errors.

---

### FEAT-02 · Type Contract

**Goal:** Mirror the backend API contract in TypeScript so all components are type-safe.

**Creates:**
```
frontend/lib/types.ts
```

**Key types to define:**
```typescript
// Mirrors PublicAPIRequest
interface RuntimeRequest { text: string; session_id?: string; include_debug?: boolean }

// Mirrors each intent's data shape
interface PilgrimagePoint {
  id: string; name: string; cn_name: string
  episode: number; time_seconds: number
  screenshot_url: string; address: string | null
  latitude: number; longitude: number
  title: string; title_cn: string; distance_m?: number
}

interface SearchResultData { results: { rows: PilgrimagePoint[]; row_count: number; strategy: string }; message: string }
interface RouteData { results: { rows: PilgrimagePoint[] }; route: { ordered_points: PilgrimagePoint[]; point_count: number } }
interface QAData { message: string }

// Top-level response
type Intent = "search_by_bangumi" | "search_by_location" | "plan_route" | "general_qa" | "unclear"
interface RuntimeResponse {
  success: boolean; status: string; intent: Intent
  session_id: string; message: string
  data: SearchResultData | RouteData | QAData
  session: { interaction_count: number; route_history_count: number }
  route_history: RouteHistoryRecord[]
}
```

**Tasks:**
- [ ] Write all types matching `interfaces/public_api.py` models exactly
- [ ] Export a `ChatMessage` type for the frontend message list state

**Acceptance:** No `any` types in the file; compiles with `tsc --noEmit`.

---

### FEAT-03 · API Client + Session Hook

**Goal:** Single fetch wrapper that manages `session_id` across turns.

**Creates:**
```
frontend/lib/api.ts
frontend/hooks/useSession.ts
```

**`lib/api.ts`:**
```typescript
// sendMessage(text, sessionId?) → RuntimeResponse
// Throws on HTTP error; caller handles display
export async function sendMessage(text: string, sessionId?: string): Promise<RuntimeResponse>
```

**`hooks/useSession.ts`:**
```typescript
// Reads/writes session_id in localStorage
// Returns { sessionId, setSessionId, clearSession }
export function useSession()
```

**Tasks:**
- [ ] `sendMessage`: POST to `process.env.NEXT_PUBLIC_RUNTIME_URL + /v1/runtime`
- [ ] Include `session_id` in body when present
- [ ] `useSession`: initialize from `localStorage.getItem("seichi_session_id")`
- [ ] Persist new `session_id` from each response

**Acceptance:** `sendMessage("吹響の聖地")` returns typed `RuntimeResponse` with no cast.

---

### FEAT-04 · Chat Core

**Goal:** Message input bar, message history list, and per-message bubble.

**Creates:**
```
frontend/hooks/useChat.ts
frontend/components/chat/ChatInput.tsx
frontend/components/chat/MessageList.tsx
frontend/components/chat/MessageBubble.tsx
```

**`hooks/useChat.ts` state shape:**
```typescript
interface ChatMessage {
  id: string; role: "user" | "assistant"
  text: string               // user text or AI summary message
  response?: RuntimeResponse // full response, drives IntentRenderer
  loading?: boolean
}
```

**Tasks:**
- [ ] `useChat`: `messages[]`, `send(text)` → appends user msg, calls `api.sendMessage`, appends assistant msg
- [ ] `ChatInput`: textarea + send button; `Enter` submits, `Shift+Enter` newlines
- [ ] `MessageBubble`: right-aligned orange for user, left-aligned card for assistant
- [ ] `MessageList`: scrollable column, auto-scrolls to bottom on new message

**Acceptance:** User types a query, sees orange bubble, then assistant response text appears.

---

### FEAT-05 · Layout Shell

**Goal:** Sidebar + main chat area + collapsible map panel.

**Creates:**
```
frontend/app/layout.tsx      (replaces scaffold — new project, no override)
frontend/app/page.tsx        (replaces scaffold — new project, no override)
frontend/components/layout/AppShell.tsx
frontend/components/layout/Sidebar.tsx
frontend/components/layout/ChatHeader.tsx
```

**Layout breakpoints:**
- Mobile (< 768px): sidebar hidden, full-width chat
- Desktop (≥ 1024px): 260px sidebar + fill chat + optional 280px map panel

**Sidebar contents:**
- App logo + "聖地巡礼 AI"
- Session history list from `route_history` (links to re-open context)
- User profile placeholder at bottom

**Tasks:**
- [ ] `AppShell`: horizontal flex, renders `<Sidebar>` + `<main>` + optional `<MapPanel>`
- [ ] `Sidebar`: reads `route_history` from last response; each item shows `bangumi_id` + `point_count`
- [ ] `ChatHeader`: title + "地図を表示" toggle button
- [ ] `page.tsx`: composes `AppShell` + `ChatInput` + `MessageList`

**Acceptance:** Opens in browser, sidebar visible on desktop, hidden on mobile.

---

### FEAT-06 · Generative UI Router

**Goal:** Single component that dispatches to the correct UI based on `intent`.

**Creates:**
```
frontend/components/generative/IntentRenderer.tsx
```

**Logic:**
```typescript
// receives RuntimeResponse, renders the matching component
switch (response.intent) {
  case "search_by_bangumi": return <PilgrimageGrid data={response.data as SearchResultData} />
  case "search_by_location": return <NearbyMap data={response.data as SearchResultData} />
  case "plan_route":         return <RouteVisualization data={response.data as RouteData} />
  case "general_qa":         return <GeneralAnswer data={response.data as QAData} />
  case "unclear":            return <Clarification message={response.message} />
}
```

**Tasks:**
- [ ] Write switch with exhaustive check (`default: never`)
- [ ] Pass `intent` badge color as prop to each child component

**Acceptance:** Changing mock `intent` value renders a different component.

---

### FEAT-07 · PilgrimageGrid

**Goal:** Render `search_by_bangumi` results as a photo grid with episode badges.

**Creates:**
```
frontend/components/generative/PilgrimageGrid.tsx
```

**Data source:** `data.results.rows[]` → `screenshot_url`, `name`, `cn_name`, `episode`, `title`

**Layout:**
- Intent badge (orange) + title (anime name) + result count
- Responsive grid: 1 col mobile / 2 col tablet / 3 col desktop
- Each card: `<img src={screenshot_url}>` + location name + episode badge
- Empty state when `results.row_count === 0`

**Tasks:**
- [ ] Render grid of cards using `results.rows`
- [ ] Episode badge: `第{episode}話`
- [ ] Handle `data.status === "empty"` with a "見つかりませんでした" message
- [ ] Show `data.results.strategy` as a subtle metadata line

**Acceptance:** Mock `search_by_bangumi` response renders photo grid correctly.

---

### FEAT-08 · Map Core

**Goal:** Shared Leaflet wrapper component used by NearbyMap and RouteVisualization.

**Creates:**
```
frontend/components/map/PilgrimageMap.tsx
frontend/public/map-marker.svg
```

**Props:**
```typescript
interface PilgrimageMapProps {
  points: PilgrimagePoint[]
  route?: PilgrimagePoint[]   // if provided, draws Polyline
  height?: number             // default 300
}
```

**Tasks:**
- [ ] Dynamic import (`next/dynamic`, `ssr: false`) — Leaflet requires browser
- [ ] OpenStreetMap tiles: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- [ ] Auto-fit map bounds to all points (`map.fitBounds`)
- [ ] Custom orange SVG marker for points
- [ ] When `route` prop provided: draw `Polyline` + number each marker

**Acceptance:** Renders a map with 3 mock points; no SSR errors.

---

### FEAT-09 · NearbyMap

**Goal:** Render `search_by_location` results as map + distance-sorted list.

**Creates:**
```
frontend/components/generative/NearbyMap.tsx
```

**Data source:** `data.results.rows[]` → sorted by `distance_m`

**Layout:**
- Intent badge (blue/info) + title (location name) + radius info
- `<PilgrimageMap points={rows}>` at top
- List below: location name + anime title + distance badge (e.g. `320m`)

**Tasks:**
- [ ] Sort rows by `distance_m` ascending
- [ ] Format distance: `< 1000` → `{n}m`, `≥ 1000` → `{n/1000:.1f}km`
- [ ] Click list item → pan map to that marker

**Acceptance:** Mock geo response renders map + scrollable list with distances.

---

### FEAT-10 · RouteVisualization

**Goal:** Render `plan_route` results as a map with route polyline + numbered stop list.

**Creates:**
```
frontend/components/generative/RouteVisualization.tsx
```

**Data source:** `data.route.ordered_points[]` — already in travel order

**Layout:**
- Intent badge (green/success) + title + point count + estimated distance
- `<PilgrimageMap points={ordered_points} route={ordered_points}>` (draws polyline)
- Right panel: numbered list, stop name + anime + episode

**Tasks:**
- [ ] Pass `route` prop to `PilgrimageMap` so polyline is drawn
- [ ] Number badges: `①` orange for first, dark for rest
- [ ] Show `route.point_count` in header
- [ ] Handle `route.summary.without_coordinates > 0` → show warning

**Acceptance:** Mock `plan_route` response renders map with polyline + 4-stop list.

---

### FEAT-11 · Clarification + GeneralAnswer

**Goal:** Simple non-map response components.

**Creates:**
```
frontend/components/generative/Clarification.tsx
frontend/components/generative/GeneralAnswer.tsx
```

**Clarification:**
- Info icon + question text + 3 suggestion buttons
- Buttons: "作品名で探す" / "場所で探す" / "ルートを作る"
- Clicking a button pre-fills ChatInput with a template query

**GeneralAnswer:**
- Renders `data.message` as plain text in a card
- No special UI chrome

**Tasks:**
- [ ] `Clarification`: 3 `<button>` components that call `onSuggest(text)` prop
- [ ] Wire `onSuggest` up through `useChat` to pre-fill and submit input
- [ ] `GeneralAnswer`: simple `<p>` in a muted card

**Acceptance:** Mock `unclear` response shows suggestion buttons; clicking one sends a query.

---

## Implementation Order

```
FEAT-01 → FEAT-02 → FEAT-03 → FEAT-04 → FEAT-05
                                              ↓
                        FEAT-06 (router wires all below)
                         ↓        ↓          ↓
                    FEAT-07   FEAT-08 →  FEAT-09
                                   ↓
                              FEAT-10
                    FEAT-11 (independent, can run in parallel with 07-10)
```

**Milestone gates:**
- After FEAT-05: basic chat loop works against the live backend
- After FEAT-07: bangumi search shows real anime screenshots on screen
- After FEAT-10: route planning shows map + stops end to end
- After FEAT-11: all intents handled, no unrendered states

---

## Environment Variables

```bash
# frontend/.env.local.example
NEXT_PUBLIC_RUNTIME_URL=http://localhost:8080
```

Backend runs via `make serve` on port 8080. No other env vars needed.

---

## What This Frontend Does NOT Need

| Concern | Reason |
|---------|--------|
| Vercel AI SDK | Backend is Python, not a streaming LLM endpoint |
| GPS / geolocation API | Backend resolves location from place names in the query text |
| Image hosting | `screenshot_url` from Anitabi is already a public URL |
| Auth / login | Out of scope for v1 |
| Server-side rendering of maps | Leaflet is browser-only; use `next/dynamic` with `ssr: false` |
