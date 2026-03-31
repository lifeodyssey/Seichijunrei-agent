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

Always dark — no light mode, no media query conditional.

CSS variables (defined in `app/globals.css`):
```css
--color-bg:          #0f0f11
--color-fg:          #f0ece6
--color-card:        #17171a
--color-muted:       #1e1e22
--color-muted-fg:    #7a7270
--color-border:      #272729
--color-primary:     #d4954a
--font-display:      "Shippori Mincho B1", Georgia, serif
--font-body:         system-ui, sans-serif
```

Use CSS variables, not Tailwind color classes, for brand colors.

## API Calls

All API calls in `lib/api.ts` must include the Supabase JWT:
```typescript
const { data: { session } } = await supabase.auth.getSession();
headers: { Authorization: `Bearer ${session?.access_token}` }
```

## Build

Output mode is `output: 'export'` (static site). No server-side Next.js features
(`next/headers`, `cookies()`, Route Handlers with dynamic responses).
<!-- END:nextjs-agent-rules -->
