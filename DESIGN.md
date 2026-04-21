# Design System — Seichijunrei 聖地巡礼

## Product Context
- **What this is:** AI-powered anime pilgrimage search and route planning
- **Who it's for:** Anime fans planning seichi junrei trips (desktop at home + mobile at station)
- **Space/industry:** Anime tourism, pilgrimage planning
- **Project type:** Chat-first web app with map integration
- **Languages:** ja, zh, en (UI follows browser locale)

## Aesthetic Direction
- **Direction:** Editorial/Cinematic — "pilgrimage planning studio"
- **Decoration level:** Intentional — torii logo, film frame corners, real anime screenshots tell the story. No decorative blobs, no gradients on text, no glassmorphism.
- **Mood:** The anticipation before a trip. Recognition of a real place from a beloved anime. Warm but structured, serious about craft.
- **Anti-references:** Generic SaaS dashboards, AI chat assistants with glowing purple gradients, database-first search tools.

## Logo
- Torii gate + film frame corners (SVG)
- Brand vermillion fill on torii, muted-fg for film corners
- Sizes: 28px (collapsed sidebar), 32px (expanded contexts), 36px (welcome hero)
- White fill variant for dark backgrounds (hero overlay)

## Typography

All fonts loaded via `next/font/google`, self-hosted in static export. Zero external requests.

| Role | Font | Weights | Rationale |
|------|------|---------|-----------|
| **Display/Headings** | Shippori Mincho B1 | 400, 600, 700, 800 | Japanese aesthetic, editorial authority. Connects to cultural pilgrimage theme. |
| **Body** | Noto Sans SC + Outfit | 300, 400, 500, 600 | Noto Sans SC for CJK glyphs (consistent rendering). Outfit for Latin/numbers (geometric, clean). |
| **Mono** | IBM Plex Mono | 400 | Coordinates, technical data only. Fallback: SFMono-Regular. |

### Type Scale (4 levels, ~1.4× ratio)
| Level | Size | Font | Weight | Usage |
|-------|------|------|--------|-------|
| 1 | 28px | Shippori Mincho B1 | 700 | Page titles, welcome heading |
| 2 | 20px | Shippori Mincho B1 | 600-700 | Section headers, anime titles, panel headers |
| 3 | 14px | Noto Sans SC / Outfit | 300-500 | Body text, card names, descriptions, buttons |
| 4 | 12px | Noto Sans SC / Outfit | 500 | Labels, badges, meta text, timestamps |

**Rules:**
- Minimum body text: 12px. Never smaller.
- `text-wrap: balance` on headings (prevent orphans)
- `font-variant-numeric: tabular-nums` on time, distance, and count columns
- Loading text ends with `…` (real ellipsis, not `...`)

### Font Loading
```css
--app-font-display: "Shippori Mincho B1", "Hiragino Mincho ProN", Georgia, serif;
--app-font-body: "Noto Sans SC", "Outfit", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif;
--app-font-mono: "IBM Plex Mono", "SFMono-Regular", monospace;
```
All loaded via `next/font` with `display: 'swap'`. Subset to `latin` (CJK loaded on demand by unicode-range).

## Color

**Approach:** Dual accent — brand vermillion for identity, interactive blue for UI controls.

### Brand
| Token | Value | Usage |
|-------|-------|-------|
| `--color-brand` | `oklch(58% 0.19 28)` | Logo, active route pin, branding-only elements |
| `--color-brand-soft` | `oklch(94% 0.02 25)` | Logo background square, brand tint areas |

### Interactive
| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `oklch(60% 0.148 240)` | Buttons, links, selections, checkmarks, active nav |
| `--color-primary-fg` | `oklch(99% 0.004 220)` | Text on primary backgrounds |
| `--color-primary-soft` | `oklch(93% 0.025 240)` | Active nav highlight, selection tint |

### Neutrals (京吹夏季 palette, blue-tinted)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `oklch(98% 0.008 218)` | Page background |
| `--color-fg` | `oklch(20% 0.025 238)` | Primary text |
| `--color-card` | `oklch(95% 0.012 215)` | Card/panel backgrounds, AI bubbles |
| `--color-muted` | `oklch(91% 0.016 218)` | Disabled backgrounds, skeleton base |
| `--color-muted-fg` | `oklch(45% 0.032 228)` | Secondary text, labels, placeholders |
| `--color-border` | `oklch(85% 0.022 222)` | Borders, dividers |

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` / `-fg` | `oklch(88% 0.035 145)` / `oklch(28% 0.09 145)` | Route saved, action completed |
| `--color-warning` / `-fg` | `oklch(90% 0.06 75)` / `oklch(28% 0.09 75)` | Caution states |
| `--color-error` / `-fg` | `oklch(90% 0.04 20)` / `oklch(28% 0.09 20)` | Error states, failed requests |
| `--color-info` / `-fg` | `oklch(88% 0.035 240)` / `oklch(28% 0.08 240)` | Informational hints |
| `--color-walk-bg` / `-fg` | `oklch(92% 0.02 145)` / `oklch(35% 0.06 145)` | Walking segments in timeline |

### Map Pin Colors
| Token | Value | Usage |
|-------|-------|-------|
| Pin blue | `--color-primary` | Current anime pins |
| Pin green | `oklch(55% 0.12 145)` | Other anime (K-On!, etc.) |
| Pin orange | `oklch(55% 0.12 55)` | Other anime (Tamako, etc.) |
| Pin brand | `--color-brand` | Active/highlighted pin |

### Dark Mode
Not supported. Light only. `color-scheme: light` on `<html>`.

## Spacing

**Base unit:** 4px. **Density:** Comfortable.

| Token | Value | Usage |
|-------|-------|-------|
| `2xs` | 4px | Inline gaps, icon margins |
| `xs` | 8px | Chip gaps, card grid gap (compact) |
| `sm` | 12px | Card grid gap (default), filter padding |
| `md` | 16px | Section padding, content margins |
| `lg` | 24px | Major section gaps, content area padding |
| `xl` | 32px | Page-level padding |
| `2xl` | 48px | Section dividers |

## Layout

**Approach:** Hybrid — grid-disciplined for content, creative for welcome hero.

### Sidebar
- Always collapsed: 60px
- Icon-only navigation with hover tooltips
- Items: New Chat, History, Favorites, Settings
- Logo: 44px rounded square with brand-soft background
- No expanded state. No anime context panel. Anime info lives in content header.

### Content Area
- `flex: 1`, no max-width constraint (fills available space)
- Photo grid: `repeat(4, 1fr)` on desktop, `repeat(2, 1fr)` on mobile
- Gap: 12px

### Chat Panel
- **Chat mode** (no results): centered, max-width 640px
- **Popup mode** (results visible): 320×380px floating popup, bottom-right, anchored to chat toggle
- **Mobile**: full-screen overlay

### Breakpoints
| Breakpoint | Behavior |
|-----------|----------|
| Desktop ≥1024px | 60px sidebar + full content + popup chat |
| Tablet 768-1023px | Hamburger menu + full content |
| Mobile <768px | No sidebar, full-width, bottom sheet for results, full-screen chat |

## Border Radius

3-level system. No other values.

| Token | Value | Usage |
|-------|-------|-------|
| `--r-sm` | 4px | Small elements: badges, inline tags, confirm items |
| `--r-md` | 8px | Medium: cards, buttons, chips, inputs, nav items, tooltips |
| `--r-lg` | 12px | Large: frames, panels, modals, logo square, popup chat |

## Motion

**Approach:** Intentional — every animation serves a purpose.

| Token | Value | Usage |
|-------|-------|-------|
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances, popup open, card hover |
| `--ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | Layout transitions, sidebar, screen changes |
| `--duration-fast` | 150ms | Hover states, chip toggle, button press |
| `--duration-base` | 250ms | Screen transitions, popup, detail sheet |
| `--duration-slow` | 400ms | Welcome hero fade, skeleton shimmer cycle |

**Rules:**
- `prefers-reduced-motion: reduce` → disable all animations + transitions
- Animate `transform` and `opacity` only (compositor-friendly)
- Never `transition: all` — list specific properties
- Skeleton shimmer: `background-size: 200%`, linear gradient sweep

## Component Patterns

### Photo Card (`.gc`)
- Aspect ratio: 4:3
- Border: 1px solid --color-border
- Bottom overlay bar: 32px, dark semi-transparent, name + EP badge
- Selected: blue border + 22px checkmark circle top-right
- Hover: translateY(-1px) + border-color change

### Chat Bubble
- User (right): primary bg, white text, radius 14/14/4/14
- AI (left): card bg, fg text, radius 14/14/14/4
- Max-width: 85%

### Chip / Filter
- Height: auto, padding 4px 12px
- Border: 1px solid --color-border
- Active: primary bg, primary-fg text
- Radius: --r-md (8px)

### Button
- Primary: primary bg, primary-fg text, 36px height, radius --r-md
- Ghost: transparent bg, muted-fg text, 36px height
- Outline: transparent bg, primary border + text
- Touch target: minimum 44px
- `touch-action: manipulation` on all buttons

### Timeline Stop
- Time column: 56px, right-aligned, tabular-nums
- Dot column: 24px, 12px dots (16px for first with glow ring)
- Content column: flex-1, min-width 0
- Walk legs: dashed line (opacity .55) + green pill badge
- Active stop: card bg tint (not border-left stripe)

### Popup Chat
- Size: 320×380px, radius --r-lg
- Shadow: `0 8px 32px oklch(20% 0.02 238/.15)`
- Pointer arrow at bottom-right (CSS triangle)
- Header: title + close button
- Body: scrollable messages
- Footer: input + send button

### Map
- Provider: Leaflet + OpenStreetMap tiles (free, no API key)
- Pins: 32-36px circles with number/letter, colored by anime
- Walking polyline between route pins
- Floating popup card on active pin (photo + name + EP)

## Accessibility

- `focus-visible` ring (2px solid --color-primary, 2px offset) on all interactive elements
- All icon buttons: `aria-label`
- Semantic HTML: `<button>` for actions, `<a>` for navigation
- Touch targets: minimum 44px
- Color contrast: muted-fg (45% lightness) on near-white bg exceeds WCAG AA
- `<meta name="theme-color">` matches --color-bg

## Anti-Patterns (Never Do)

- No gradient text (background-clip)
- No border-left > 1px decorative stripes on cards
- No glassmorphism decoration (functional backdrop-filter for chat OK)
- No bounce/elastic animations
- No pure #000 or #fff — use --color-fg and --color-bg
- No hardcoded Tailwind palette colors — use CSS variables
- No 11px or smaller text
- No `transition: all`
- No emoji as interactive icons (use SVG)
- No cards inside cards

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-20 | Logo: Torii + film frame corners | Connects anime (film) + pilgrimage (torii). User chose option A from 4 variants. |
| 2026-04-20 | Dual accent: vermillion brand + blue interactive | Vermillion = torii, blue = trust/interactive. Mixed palette confirmed by user. |
| 2026-04-20 | Chat-first flow | Users describe intent in natural language, AI responds with results. Not a database search tool. |
| 2026-04-21 | Sidebar always collapsed 60px | Eliminates "shape-shifting" between expanded/collapsed. Sidebar = navigation only. |
| 2026-04-21 | Chat popup (not side panel, not bottom sheet) | User chose popup style (like Intercom) over side panel or bottom sheet. Confirmed via mockup comparison. |
| 2026-04-21 | Chat IS search | No separate search page or bar. Chat input is always the way to search. |
| 2026-04-21 | Leaflet + OpenStreetMap for maps | Free, no API key, good enough quality. Real tiles, not gradient blobs. |
| 2026-04-21 | Body font: Noto Sans SC via next/font | Self-hosted, subset, swap. Best CJK rendering. Outfit kept for Latin. |
| 2026-04-21 | All fonts self-hosted via next/font | Zero external requests. Fonts in out/_next/static/media/. |
| 2026-04-21 | Route minimum: 2 spots | Fewer than 2 doesn't make a "route". |
| 2026-04-21 | Favorites: spots + routes | Both can be favorited with ❤️. |
| 2026-04-21 | History = conversation history | Each search = one conversation. History shows past conversations. |
