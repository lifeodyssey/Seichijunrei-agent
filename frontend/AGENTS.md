<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Component Architecture

Three-column layout: `AppShell` (sidebar + chat + result panel).

Key components and their responsibilities:
- `components/layout/AppShell.tsx` — layout root; owns `activeMessageId` state
- `components/layout/ResultPanel.tsx` — right column; renders active result
- `components/layout/ResultDrawer.tsx` — mobile bottom sheet (vaul); wraps ResultPanel
- `components/generative/registry.ts` — `COMPONENT_REGISTRY`; add new components here
- `components/generative/GenerativeUIRenderer.tsx` — registry lookup; entry point for all results
- `components/chat/MessageBubble.tsx` — bot messages: text + `◈` anchor only (no inline results)

**Adding a new result component:** register in `registry.ts` only. No other file changes needed.

## Design System

Light theme — no dark mode toggle. Palette is 京吹夏季 (Kyoto summer, KyoAni-inspired).

CSS variables (defined in `app/globals.css`):
```css
--color-bg:      oklch(98% 0.008 218)   /* near-white */
--color-fg:      oklch(20% 0.025 238)   /* near-black */
--color-card:    oklch(95% 0.012 215)
--color-muted:   oklch(91% 0.016 218)
--color-muted-fg: oklch(54% 0.032 228)
--color-border:  oklch(85% 0.022 222)
--color-primary: oklch(60% 0.148 240)   /* cornflower blue */

--app-font-display: "Shippori Mincho B1", Georgia, serif
--app-font-body:    "Outfit", system-ui, sans-serif
```

Use CSS variables, not Tailwind color classes, for brand colors.

## API Calls

All API calls in `lib/api.ts` must include the Supabase JWT (including SSE via `sendMessageStream()`):
```typescript
const { data: { session } } = await supabase.auth.getSession();
headers: { Authorization: `Bearer ${session?.access_token}` }
```

## Build

Output mode is `output: 'export'` (static site). No server-side Next.js features
(`next/headers`, `cookies()`, Route Handlers with dynamic responses).

`npm run build` writes static output to `out/` (served by the Cloudflare Worker via the `ASSETS` binding).
<!-- END:nextjs-agent-rules -->
