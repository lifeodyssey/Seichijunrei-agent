# Plan 2: Layout Redesign — Perplexity-style + Fullscreen Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the permanent three-column layout with a Perplexity-style inline results model — chat is the primary view, search results open in a slide-over panel, routes go fullscreen. Redesign the input bar (ChatGPT-style), make sidebar collapsible, fix locale switcher sizing, send button contrast, and empty state.

**Architecture:** Current `AppShell.tsx` renders three permanent columns: Sidebar (240px) + Chat (360px) + ResultPanel (flex-1). We remove ResultPanel as a permanent column. Instead, results appear inline in chat as cards. Clicking "View details →" opens a slide-over overlay (520px, from right). Route results go directly to a fullscreen overlay (map hero + timeline sidebar). Sidebar gains a ☰ toggle to collapse/expand. Input bar becomes a rounded card with textarea + circular send button.

**Tech Stack:** React 19 / Next.js 16 / Tailwind / shadcn/ui / react-leaflet / vaul (bottom sheet)

**Dependencies:** Plan 1 (registry fix) should land first so RoutePlannerWizard is wired. Plan 2 can otherwise run in parallel with Plans 3-7.

**Mockup reference:** `.gstack/design-reports/mockups/mockup-b4-slide-then-fullscreen.html`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/components/layout/AppShell.tsx` | Rewrite | Remove three-column, add slide-over + fullscreen overlays, collapsible sidebar |
| `frontend/components/layout/ResultPanel.tsx` | Remove/Repurpose | Replaced by SlideOverPanel + FullscreenOverlay |
| `frontend/components/layout/SlideOverPanel.tsx` | Create | 520px right slide-over for search results |
| `frontend/components/layout/FullscreenOverlay.tsx` | Create | Fullscreen overlay for route results |
| `frontend/components/layout/Sidebar.tsx` | Modify | Add collapse/expand with ☰ toggle, mobile locale switcher |
| `frontend/components/chat/ChatInput.tsx` | Rewrite | ChatGPT-style rounded card, textarea, ↑ circle send button |
| `frontend/components/chat/MessageBubble.tsx` | Modify | Inline result cards (anchor cards become clickable previews) |
| `frontend/components/generative/RoutePlannerWizard.tsx` | Modify | Render inside FullscreenOverlay, fullscreen map + pin popups |
| `frontend/components/generative/PilgrimageGrid.tsx` | Modify | Render inside SlideOverPanel |
| `frontend/components/layout/ResultDrawer.tsx` | Modify | Mobile: vaul bottom sheet wired to new overlay system |
| `frontend/app/globals.css` | Modify | Locale switcher 44px, send button 44px, slide-over/fullscreen transitions |

---

### Task 2 (spec): RoutePlannerWizard fullscreen rewrite

**Scope:** The wizard currently renders as a card. It needs to render inside a fullscreen overlay with Leaflet map (hero, flex-1), numbered markers, polyline, timeline sidebar, and export buttons.

**Files:**
- Modify: `frontend/components/generative/RoutePlannerWizard.tsx`
- Create: `frontend/components/layout/FullscreenOverlay.tsx`

- [ ] **Step 1: Create FullscreenOverlay shell**

Create `frontend/components/layout/FullscreenOverlay.tsx`:

```tsx
"use client";
import { useCallback, useEffect } from "react";

interface FullscreenOverlayProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function FullscreenOverlay({ open, onClose, children }: FullscreenOverlayProps) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)] animate-in fade-in duration-200">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-white/80 backdrop-blur p-2 shadow-md hover:bg-white transition"
        aria-label="Close"
      >
        ✕
      </button>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Install react-leaflet if needed**

```bash
cd frontend && npm ls react-leaflet 2>/dev/null || npm install react-leaflet leaflet @types/leaflet
```

- [ ] **Step 3: Rewrite RoutePlannerWizard with fullscreen map**

Rewrite `frontend/components/generative/RoutePlannerWizard.tsx`. Key structure:

```tsx
"use client";
import dynamic from "next/dynamic";
import { useState, useMemo } from "react";

// Dynamic import to avoid SSR issues with Leaflet
const MapContainer = dynamic(
  () => import("react-leaflet").then(m => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then(m => m.TileLayer),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then(m => m.Marker),
  { ssr: false }
);
const Polyline = dynamic(
  () => import("react-leaflet").then(m => m.Polyline),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then(m => m.Popup),
  { ssr: false }
);
```

Layout inside fullscreen:

```
┌──────────────────────────────────────────────────────────┐
│  Title bar (anime name + location)              [✕]      │
├────────────────────────────────────┬─────────────────────┤
│                                    │ Timeline sidebar    │
│   Leaflet Map (flex-1)             │ 320px, scrollable   │
│   Numbered markers + polyline      │ Stops + transit legs│
│   Pin click → photo popup          │                     │
│                                    │                     │
├────────────────────────────────────┴─────────────────────┤
│  [📍 Google Maps] [🍎 Apple Maps] [📅 .ics]   12 spots │
└──────────────────────────────────────────────────────────┘
```

Key implementation points:
- `MapContainer` with `center` from first stop's lat/lng, `zoom` from data or 13
- Custom numbered `DivIcon` markers: `L.divIcon({ html: '<div class="marker-number">1</div>' })`
- `Polyline` connecting all stops in order
- `Popup` on each marker: stop name + photo thumbnail + dwell time
- Timeline sidebar: `overflow-y-auto max-h-full` list of `TimedStop` entries with transit legs
- Clicking a timeline entry → `map.flyTo(stop.lat, stop.lng, 16)`
- Export bar at bottom: Google Maps, Apple Maps (Task 14), .ics download
- `scrollWheelZoom: true` with `wheelPxPerZoomLevel: 120` (Task 27 — trackpad zoom fix)
- Map container: `touch-action: none` CSS + `e.preventDefault()` on wheel events

- [ ] **Step 4: Add numbered marker CSS to globals.css**

```css
/* Leaflet numbered markers */
.marker-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  font-weight: 600;
  font-size: 14px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.marker-number.active {
  background: oklch(0.5 0.2 30); /* warm accent for selected */
  transform: scale(1.2);
}
```

- [ ] **Step 5: Add Leaflet CSS import**

In `frontend/app/layout.tsx` or in the RoutePlannerWizard dynamic import:

```tsx
import "leaflet/dist/leaflet.css";
```

Or add to `globals.css`:
```css
@import "leaflet/dist/leaflet.css";
```

- [ ] **Step 6: Mobile rendering in vaul bottom sheet**

When viewport < 768px, RoutePlannerWizard renders inside `ResultDrawer` (vaul):
- Map takes full width above (50vh)
- Timeline in the vaul sheet below (draggable)
- Export bar at bottom of sheet

Modify `ResultDrawer.tsx` to accept a `fullscreen` prop that changes snap points to `[0.9, 0.5]`.

- [ ] **Step 7: Verify**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

Expected: no type errors, static export succeeds.

---

### Task 3 (spec): Locale switcher fix — 44px touch targets

**Files:**
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Fix locale button sizing**

In `Sidebar.tsx`, find the locale switcher buttons. Change:

```tsx
// Each locale button should be a pill with min 44px height
<button
  className="px-3 py-2 min-h-[44px] min-w-[44px] rounded-full text-sm font-medium transition
    data-[active=true]:bg-[var(--color-primary)] data-[active=true]:text-white
    hover:bg-[var(--color-primary)]/10"
  data-active={locale === activeLocale}
>
  {label}
</button>
```

- [ ] **Step 2: Mobile locale switcher in header bar**

On mobile (< 768px), the sidebar is hidden. Add locale switcher to the mobile header bar (next to "+ New chat"):

```tsx
// In mobile header (AppShell or Sidebar mobile view)
<div className="flex items-center gap-1 md:hidden">
  {locales.map(({ code, label }) => (
    <button key={code} onClick={() => setLocale(code)}
      className="px-2 py-1 min-h-[44px] rounded-full text-xs ..."
      data-active={code === activeLocale}
    >
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Verify touch targets**

Open in browser at 375px width. All locale buttons should be >= 44px height. Use browser inspector to verify.

---

### Task 4 (spec): Send button sizing and contrast

**Files:**
- Modify: `frontend/components/chat/ChatInput.tsx`

- [ ] **Step 1: Redesign ChatInput as ChatGPT-style card**

The input bar becomes a rounded card with:
- Outer container: `rounded-2xl bg-white border shadow-sm p-3 max-w-[680px] mx-auto`
- Inner: `textarea` (auto-grow, min 1 row, max 6 rows) + circular send button
- Send button: 44px circle, `var(--color-primary)` background when text present, muted when empty
- Arrow icon inside send button (↑)

```tsx
<div className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm p-3 flex items-end gap-2">
  <textarea
    className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed min-h-[24px] max-h-[144px]"
    rows={1}
    placeholder={t("chat.placeholder")}
    value={input}
    onChange={handleChange}
    onKeyDown={handleKeyDown}
  />
  <button
    disabled={!input.trim()}
    className="flex-shrink-0 w-[44px] h-[44px] rounded-full flex items-center justify-center
      transition-colors duration-150
      disabled:bg-gray-200 disabled:text-gray-400
      bg-[var(--color-primary)] text-white hover:opacity-90"
    onClick={handleSend}
  >
    <ArrowUpIcon className="w-5 h-5" />
  </button>
</div>
```

- [ ] **Step 2: Verify send button**

Visually confirm: 44px height, solid primary color when text entered, disabled state when empty.

---

### Task 5 (spec): Empty result panel state → empty chat state

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx` (or wherever the empty chat view renders)

- [ ] **Step 1: Add empty state to chat area**

Since we're removing the permanent ResultPanel, the empty state now lives in the chat area when no messages exist:

```tsx
{messages.length === 0 && (
  <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
    <span className="text-6xl opacity-10 font-display">聖地巡礼</span>
    <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
      {t("chat.empty_hint")}
    </p>
  </div>
)}
```

Add i18n keys:
- `en.json`: `"chat.empty_hint": "Search for anime pilgrimage spots or plan a route"`
- `ja.json`: `"chat.empty_hint": "聖地を検索するか、ルートを計画しましょう"`
- `zh.json`: `"chat.empty_hint": "搜索动漫圣地或规划路线"`

---

### Task 12 (spec): ResultPanel click-to-open only

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx`

- [ ] **Step 1: Remove auto-open logic**

In `AppShell.tsx`, find the `activeMessage` / `activeMessageId` logic. Remove any `latestVisualResponseMessage` fallback or `useEffect` that auto-sets `activeMessageId` when a new visual response arrives.

```tsx
// Before (auto-open):
const activeMessage = selectedVisualMessage ?? latestVisualResponseMessage;

// After (click-to-open only):
const activeMessage = selectedVisualMessage ?? null;
```

Remove the `useEffect` that watches for new visual messages and auto-opens the panel.

- [ ] **Step 2: Verify**

Send a search query. The slide-over panel should NOT open automatically. Only opens when user clicks "◈" anchor or "View details →" in the inline card.

---

### Task 13 (spec): Footer cleanup

**Files:**
- Modify: `frontend/components/auth/LandingPage.tsx` (or wherever footer is)

- [ ] **Step 1: Remove "Internal beta · 2026" text**

Find the footer on the landing page. Replace with `聖地巡礼 beta` or remove entirely.

```tsx
// Before:
<footer>Internal beta · 2026</footer>

// After:
<footer className="text-xs text-[var(--color-text-tertiary)] py-4">
  聖地巡礼
</footer>
```

---

### Task 17 (spec): Result panel animation + skeleton

Since we're replacing ResultPanel with SlideOverPanel, this task is about the slide-over transition.

**Files:**
- Create: `frontend/components/layout/SlideOverPanel.tsx`

- [ ] **Step 1: Create SlideOverPanel**

```tsx
"use client";
import { useCallback, useEffect, useRef } from "react";

interface SlideOverPanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function SlideOverPanel({ open, onClose, children }: SlideOverPanelProps) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, handleEsc]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[520px] max-w-[90vw] bg-[var(--color-bg)]
          shadow-xl border-l border-[var(--color-border)]
          transition-transform duration-200 ease-out
          ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-white/80 p-2 shadow hover:bg-white"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="h-full overflow-y-auto p-6 pt-14">
          {children}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add skeleton loading state**

In the SlideOverPanel, show a skeleton shimmer while content loads:

```tsx
// When children is null/loading
<div className="space-y-4 animate-pulse">
  <div className="h-6 bg-gray-200 rounded w-3/4" />
  <div className="h-48 bg-gray-200 rounded" />
  <div className="h-4 bg-gray-200 rounded w-1/2" />
  <div className="h-4 bg-gray-200 rounded w-2/3" />
</div>
```

---

### Task 27 (spec): Map trackpad scroll/zoom capture

**Files:**
- Modify: `frontend/components/generative/RoutePlannerWizard.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Configure Leaflet scroll zoom in RoutePlannerWizard**

```tsx
<MapContainer
  center={center}
  zoom={13}
  scrollWheelZoom={true}
  wheelPxPerZoomLevel={120}
  className="h-full w-full touch-action-none"
>
```

- [ ] **Step 2: Add CSS to prevent browser zoom on map**

```css
/* Prevent browser zoom on Leaflet map container */
.leaflet-container {
  touch-action: none;
}
```

- [ ] **Step 3: For inline card map previews, disable zoom**

Small map previews in inline cards should have zoom disabled:

```tsx
<MapContainer
  center={center}
  zoom={11}
  scrollWheelZoom={false}
  dragging={false}
  zoomControl={false}
  className="h-[200px] w-full rounded-lg pointer-events-none"
>
```

---

### AppShell integration: Wire it all together

**Files:**
- Rewrite: `frontend/components/layout/AppShell.tsx`

- [ ] **Step 1: Remove three-column layout**

Replace the current grid layout:

```tsx
// Before:
<div className="grid grid-cols-[240px_360px_1fr] h-screen">
  <Sidebar />
  <ChatPanel />
  <ResultPanel />
</div>

// After:
<div className="flex h-screen">
  {sidebarOpen && <Sidebar onCollapse={() => setSidebarOpen(false)} />}
  <main className="flex-1 flex flex-col">
    <MobileHeader onMenuToggle={() => setSidebarOpen(s => !s)} />
    <ChatPanel />
    <ChatInput />
  </main>
  <SlideOverPanel open={slideOverOpen} onClose={() => setSlideOverOpen(false)}>
    {slideOverContent}
  </SlideOverPanel>
  <FullscreenOverlay open={fullscreenOpen} onClose={() => setFullscreenOpen(false)}>
    {fullscreenContent}
  </FullscreenOverlay>
</div>
```

- [ ] **Step 2: Add state management for overlays**

```tsx
const [sidebarOpen, setSidebarOpen] = useState(true);
const [slideOverOpen, setSlideOverOpen] = useState(false);
const [slideOverContent, setSlideOverContent] = useState<React.ReactNode>(null);
const [fullscreenOpen, setFullscreenOpen] = useState(false);
const [fullscreenContent, setFullscreenContent] = useState<React.ReactNode>(null);

// When user clicks search result anchor:
const handleViewSearchDetails = (messageId: string) => {
  setSlideOverContent(<PilgrimageGrid data={...} />);
  setSlideOverOpen(true);
};

// When user clicks route result anchor:
const handleViewRoute = (messageId: string) => {
  setFullscreenContent(<RoutePlannerWizard data={...} />);
  setFullscreenOpen(true);
};
```

- [ ] **Step 3: Add sidebar ☰ toggle**

```tsx
// In Sidebar.tsx header:
<button
  onClick={onCollapse}
  className="p-2 rounded-lg hover:bg-[var(--color-primary)]/5"
  aria-label="Collapse sidebar"
>
  <MenuIcon className="w-5 h-5" />
</button>

// In mobile header (shown when sidebar collapsed):
<button
  onClick={onMenuToggle}
  className="p-2 md:hidden"
  aria-label="Open menu"
>
  <MenuIcon className="w-5 h-5" />
</button>
```

- [ ] **Step 4: Inline result cards in chat**

In `MessageBubble.tsx`, when a bot message has visual data (search results or route), render an inline preview card:

```tsx
// Search result inline card
<div className="mt-3 rounded-xl border bg-white p-4 shadow-sm">
  <div className="flex items-center gap-2">
    <span className="text-lg">◈</span>
    <span className="font-medium">{animeName}</span>
    <span className="text-sm text-gray-500">{count} {t("results")}</span>
  </div>
  <button
    onClick={() => onViewDetails(messageId)}
    className="mt-2 text-sm text-[var(--color-primary)] hover:underline"
  >
    {t("view_details")} →
  </button>
</div>

// Route result inline card
<div className="mt-3 rounded-xl border bg-white p-4 shadow-sm">
  <div className="flex items-center gap-2">
    <span className="text-lg">🗺️</span>
    <span className="font-medium">{routeSummary}</span>
  </div>
  <p className="text-sm text-gray-500 mt-1">{spotCount} spots · {distance} · ~{duration}</p>
  <button
    onClick={() => onViewRoute(messageId)}
    className="mt-2 text-sm text-[var(--color-primary)] hover:underline"
  >
    {t("view_full_route")} →
  </button>
</div>
```

- [ ] **Step 5: Final verification**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run build
# Visual test at 1440px and 375px
```

Expected:
- Chat is centered, max-width 680px
- No permanent right panel
- Sidebar collapses with ☰
- Search results open slide-over on click
- Route results open fullscreen on click
- Locale buttons 44px, send button 44px
- Empty chat shows watermark + hint
- Map trackpad zoom works
- Mobile: vaul bottom sheet for results

---

## Commit Strategy

1. `feat(layout): add SlideOverPanel + FullscreenOverlay components`
2. `feat(layout): rewrite AppShell — remove three-column, add overlay system`
3. `feat(chat): redesign ChatInput — ChatGPT-style card`
4. `feat(layout): collapsible sidebar with ☰ toggle`
5. `feat(route): RoutePlannerWizard fullscreen map with react-leaflet`
6. `fix(ux): locale switcher 44px, send button 44px, empty state hint`
7. `fix(ux): click-to-open only — remove result panel auto-open`
8. `chore(layout): remove old ResultPanel, clean up footer`
